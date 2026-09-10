---
title: "✅基于RAG的L2意图识别详解"
---

# ✅基于RAG的L2意图识别详解

L1 规则层已经能短路掉一大半模板化句式，但它有一个天生的死角：**只认预设关键词**。用户不会永远按模板说话。比如：

- "这趟出差垫付的钱帮我弄回来" —— 想报销，但没有"报销/发票"任何一个 L1 触发词
- "帮我找个离客户近点的落脚地方" —— 想搜酒店，但没有"酒店/住宿"
- "明天想坐飞机去上海，有哪些班次可选" —— 想查机票，但用的是"坐飞机"而非"机票/航班"

这些句子在 L1 会直接 miss。如果 miss 之后立刻甩给 L3（完整 LLM 意图识别），就要多付一次大模型推理的延迟和 Token。而这类句子其实**语义高度确定**，只是"表达方式绕开了关键词"——正好是向量语义最擅长的场景。

所以 gogo-agent 在 L1 和 L3 之间插了一层 L2：用向量相似度把"意思明确但说法非模板"的句子接住，命中就短路，省下 L3 那次 LLM 调用。它的定位是**"L1 的语义补充、L3 的成本前置拦截"**——目标延迟 &lt; 100ms（含一次 embedding 网络往返），比 L3 完整 ReAct 推理低一个量级。

![](assets/8e370d1370cf.png)

IntentVectorMatcherTest是我针对L2专门设计的单元测试的类，可以实际运行看看各个case的效果。

L2 的"知识"从哪来

L2 能识别什么，完全取决于库里预置了哪些标准问句。这份语料放在 resources/intent-seed.yml（目前是在代码中维护的，这部分内容也完全可以放到配置文件、nacos、数据库以及直接用第三方知识库，都是可以的。）。按意图 code 分组，每类 3–7 条口语化问句：

```text
# resources/intent-seed.yml（节选）
intent:
  router:
    seed-examples:
      flight_search:
        - "明天想坐飞机去上海，有哪些班次可选"
        - "后天去深圳，早点起飞的有哪些"
        - "从成都回北京，坐飞机下午几点有"
      reimbursement:
        - "这趟出差垫付的钱，帮我弄回来"
        - "出差花的这些单据，帮我整理好交上去"
        - "回来之后这些开销怎么找公司结"
      hotel_search:
        - "这次去上海出差，帮我找个离客户近点的落脚地方"
        - "帮我看看公司附近有没有方便过夜的地方"
```

这份语料**最关键的设计原则写在文件头部注释里**：**刻意剔除所有 L1 能直接命中的说法**。因为 L2 只在 L1 未命中时才被调用——如果种子里放了"帮我查机票"，那这句永远会被 L1 先接走，L2 里那条种子就是纯冗余、白白浪费一次 embedding 计算。所以语料统一用"坐飞机/起飞"代替"机票/航班"、用"铁路"代替"高铁/火车"、用"落脚/过夜的地方"代替"酒店/住宿"、用"垫付的钱/单据"代替"报销/发票"。（实际的工作场景中，这份语聊内容，应该是从日常的对话中提取出来的，有的靠人工提取，有的靠AI自动提取）

语料如何变成可检索的向量库

IntentRouterKnowledgeConfig.java负责把 YAML 语料变成一个可检索的知识库。它一共暴露 4 个 Bean，装配链条如下。

**第一步：绑定 YAML 语料。**

```text
// IntentRouterKnowledgeConfig.java 第 114-130 行
@PostConstruct
void initSeedExamples() {
    categoryExamples.clear();
    Map<String, List<String>> seed = seedExamplesProperties.getSeedExamples();
    if (seed == null || seed.isEmpty()) {
        logger.warn("[INTENT_ROUTER] 未加载到意图种子语料，请检查 intent-seed.yml 是否被正确 import");
        return;
    }
    for (Map.Entry<String, List<String>> entry : seed.entrySet()) {
        IntentCategory category = IntentCategory.fromCode(entry.getKey());   // code → 枚举
        categoryExamples.put(category, List.copyOf(entry.getValue()));
    }
}
```

**第二步：装配 embedding 模型。** 一个独立的 text-embedding-v4 实例，1024 维，与 RAG 景点/政策库的 embedding 隔离，互不干扰：

```text
// 第 62-73 行
@Bean(name = "intentRouterEmbeddingModel")
public EmbeddingModel intentRouterEmbeddingModel() {
    if (apiKey == null || apiKey.isBlank()) {
        throw new IllegalStateException("意图路由向量库要求配置 agentscope.dashscope.api-key（或 DASHSCOPE_API_KEY 环境变量）。");
    }
    return DashScopeTextEmbedding.builder()
            .modelName("text-embedding-v4")
            .dimensions(EMBEDDING_DIM)          // EMBEDDING_DIM = 1024
            .apiKey(apiKey)
            .build();
}
```

**第三步：建库 + 启动即灌数据。** 用 InMemoryStore（1024 维）+ SimpleKnowledge，在 Bean 初始化时就把全部种子问句 embedding 并写入。注意 .block()——这是**同步阻塞**等待所有 embedding 算完，确保应用起来时库已就绪，不会出现"启动了但库还空着"的窗口：

```text
// 第 75-88 行
@Bean(name = "intentRouterKnowledge")
public Knowledge intentRouterKnowledge(EmbeddingModel intentRouterEmbeddingModel) {
    InMemoryStore store = InMemoryStore.builder().dimensions(EMBEDDING_DIM).build();
    SimpleKnowledge knowledge = SimpleKnowledge.builder()
            .embeddingModel(intentRouterEmbeddingModel)
            .embeddingStore(store)
            .build();

    List<Document> docs = buildSeedDocuments();
    knowledge.addDocuments(docs).block();       // 阻塞等待 embedding 完成
    logger.info("[INTENT_ROUTER] 意图路由向量库启动完成，预填充样本数={}", docs.size());
    return knowledge;
}
```

每条种子问句被包装成一个 Document，问句原文作为 content（会被 embedding），意图信息塞进 payload（不参与 embedding，只在命中后回读）：

```text
// buildSeedDocuments()，第 132-158 行（核心循环）
Map<String, Object> payload = new HashMap<>();
payload.put("intent", category.getCode());                    // 命中后回读这个 → 意图 code
payload.put("target_agent", category.getDefaultTargetAgent()); // 目标子智能体
payload.put("confidence", IntentRecognitionConfidenceSeed.HIGH); // "high"（种子固定高置信）

DocumentMetadata metadata = DocumentMetadata.builder()
        .content(TextBlock.builder().text(example).build())   // 问句原文，会被向量化
        .docId("intent-" + category.getCode())
        .chunkId(String.valueOf(chunkSeq++))
        .payload(payload)
        .build();
docs.add(new Document(metadata));
```

**第四步：装配 matcher。** 最后把知识库注入向量匹配器：

```text
// 第 109-112 行
@Bean(name = "intentVectorMatcher")
public IntentVectorMatcher intentVectorMatcher(Knowledge intentRouterKnowledge) {
    return new IntentVectorMatcher(intentRouterKnowledge);
}
```

运行期检索

IntentVectorMatcher.java 是 L2 的运行期主角。核心就一个方法 match()，逻辑是"检索 top-2 → 过两道闸门 → 出结果"。

先看两个阈值常量：

```text
public static final double DEFAULT_SCORE_THRESHOLD = 0.75;   // top-1 命中的最低相似度
public static final double DEFAULT_SCORE_MARGIN = 0.05;      // top-1 与 top-2 的最小分差
private static final int TOP_K = 2;                          // 取前 2 条：1 判命中、2 判歧义
```

match() 主体流程：

![](assets/d3dd074a6df7.png)

对应的代码：

```text
// IntentVectorMatcher.java 第 89-153 行（节选核心）
public Optional<IntentRecognitionResult> match(String text) {
    if (text == null || text.isBlank()) return Optional.empty();
    String normalized = text.trim();

    RetrieveConfig config = RetrieveConfig.builder()
            .limit(TOP_K)
            .scoreThreshold(0.0)   // ★ 底层不过滤，拿回原始分，阈值/margin 由本类自己判
            .build();

    List<Document> docs;
    try {
        docs = knowledge.retrieve(normalized, config).block();
    } catch (Exception e) {
        // 任何 embedding/检索失败都视为未命中，让 L3 兜底；不阻塞主流程
        logger.warn("[INTENT_ROUTER] L2 向量检索失败，降级到 L3: {}", e.getMessage());
        return Optional.empty();
    }
    if (docs == null || docs.isEmpty()) return Optional.empty();

    // —— 闸门一：top-1 阈值 ——
    Document top = docs.get(0);
    Double score = top.getScore();
    if (score == null || score < scoreThreshold) {           // < 0.75 直接放行 L3
        return Optional.empty();
    }
    Object intentCode = top.getPayloadValue("intent");
    if (intentCode == null) return Optional.empty();

    // —— 闸门二：top-1/top-2 歧义 margin ——
    if (docs.size() >= 2) {
        Document second = docs.get(1);
        Double secondScore = second.getScore();
        Object secondIntent = second.getPayloadValue("intent");
        if (secondScore != null && secondIntent != null
                && !intentCode.toString().equals(secondIntent.toString())   // 两者意图不同
                && score - secondScore < scoreMargin) {                     // 且分差 < 0.05
            logger.info("[INTENT_ROUTER] L2 意图歧义：top1={}... 放行到 L3", ...);
            return Optional.empty();   // 在两个意图间摇摆 → 交 L3
        }
    }

    IntentCategory category = IntentCategory.fromCode(intentCode.toString());
    ConfidenceFromScore conf = classify(score);              // 分数 → 置信度分级
    return Optional.of(IntentRecognitionResult.single(
            IntentRecognitionResult.Source.VECTOR,
            category,
            conf.confidence,
            "L2 向量命中：相似度=" + String.format("%.3f", score)
                    + "，匹配样本「" + top.getMetadata().getContentText() + "」",
            score));
}
```

这里有三处设计值得停下来看：

**（1）为什么 ****RetrieveConfig**** 的 ****scoreThreshold**** 传 0.0？** 因为我们要**自己**掌控阈值和 margin 判定，而不是让底层库过滤。传 0.0 意思是"底层别筛，把 top-2 连同原始相似度分都给我"，这样才能在本类里拿到 top-2 的分去做歧义校验。

**（2）闸门一：top-1 阈值 0.75。** 最像的那条种子如果相似度都不到 0.75，说明这句话跟库里任何标准问句都不够像，L2 不敢认，放行给 L3。0.75 偏保守，是"宁可漏判交给 L3、也不误判乱路由"的取舍。

**（3）闸门二：歧义 margin 0.05。** 这是 L2 最精妙的一道闸门，专门防"多意图复合句被吞成单意图"。当 top-1 和 top-2 **属于不同意图**、而且**分差小于 0.05**时，说明这句话的向量同时贴近两个意图的种子（复合句的典型表现，例如"帮我订去北京的机票再找个住的地方"会同时接近机票和酒店两类种子），此时强行取 top-1 就会丢掉另一半意图。所以 L2 主动弃权，放行到 L3 让大模型判定 multi_intent=true。

反过来，如果 top-1 和 top-2 **是同一个意图**（哪怕分差很小），就不构成歧义，正常命中——这正好体现在测试 shouldHitWhenTopTwoShareSameIntent：两条都是 POLICY_QUERY（0.80/0.79），分差 0.01 但同意图，照样命中。

命中后，分数还要经过 classify()映射成置信度分级：

```text
private static ConfidenceFromScore classify(double score) {
    if (score >= 0.85) return new ConfidenceFromScore(Confidence.HIGH);    // 很像
    if (score >= 0.75) return new ConfidenceFromScore(Confidence.MEDIUM);  // 够阈值但一般
    return new ConfidenceFromScore(Confidence.LOW);                        // 理论上到不了
}
```

注意 L2 命中给的是 **HIGH 或 MEDIUM**，而 L1 命中恒为 HIGH。这个差异在下游是有意义的——L1 是确定性规则、可信度最高；L2 是语义近似、只有相似度 ≥ 0.85 才敢标 HIGH。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a699c513fb9180001d8f61d
