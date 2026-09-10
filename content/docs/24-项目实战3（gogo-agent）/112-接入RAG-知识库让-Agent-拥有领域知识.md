---
title: "✅接入RAG 知识库，让 Agent 拥有领域知识"
---

# ✅接入RAG 知识库，让 Agent 拥有领域知识

（本期无视频，内容前面也都讲过，文档再总结一下）

大模型的参数里装着「世界的常识」，但装不下三类东西：

1. **私域知识**：公司的差旅报销制度、住宿超标规则、差旅行为准则——这些从来没进过任何预训练语料。
2. **长尾/时效知识**：某个小众景点的开放时间、某国最新签证政策——模型要么不知道，要么记的是两年前的旧版本。
3. **可追溯的事实**：企业场景里，用户问「差旅制度对超标住宿怎么规定」，你不能让模型自由发挥，必须给出**有出处、可复核**的答案。

硬办法是把所有制度文档塞进 system prompt，但这样既撑爆上下文窗口，又无法按问题动态取用。RAG（Retrieval-Augmented Generation）的思路是：把领域文档切片、向量化、存进向量库；用户提问时先做语义检索取回最相关的几段，再把这几段作为「参考资料」喂给模型生成答案。**模型负责语言组织和推理，知识库负责事实供给**，二者解耦。

gogo-agent 里真正吃到 RAG 红利的是 **InfoAgent（信息查询助手）**：它要回答景点、差旅政策、差旅注意事项、行为准则这类查询。下面这条链路就是它拿到领域知识的完整路径。

所有知识库都在 RagKnowledgeConfig 里以 Spring Bean 的形式装配。它暴露了三个 io.agentscope.core.rag.Knowledge 实例，分别对应两种截然不同的 VDB（向量数据库）策略。

景点库：BailianKnowledge（远程托管索引）

景点数据量大、更新频繁，适合托管在百炼的向量索引服务上，本地不做 embedding、不存向量：

```text
@Bean(name = "attractionKnowledge")
public Knowledge attractionKnowledge() {
    BailianConfig config =
            BailianConfig.builder()
                    .accessKeyId(accessKeyId)
                    .accessKeySecret(accessKeySecret)
                    .workspaceId(workspaceId)     // llm-hs8cun2smw9190xh
                    .build();

    return BailianKnowledge.builder()
            .config(config)
            .indexId(indexId)                     // zcupxosihd —— 百炼上预建好的景点索引
            .build();
}
```

关键点：BailianKnowledge 是**托管型 Knowledge**，切片、embedding、存储、检索全在百炼云端完成。工程侧只持有一个 indexId（zcupxosihd），文档的灌库是在百炼控制台离线做的（对应资源目录里的 tourist_attraction.xlsx）。因此这里没有 addDocuments(...) 调用——托管型知识库的写入不走应用代码。

政策库 / 指南库：SimpleKnowledge + InMemoryStore（本地内存索引）

差旅政策、差旅指南是两份 Word 文档，体量小、随应用发版更新，适合在**启动时**读进来、就地向量化、存到进程内存：

```text
@Bean(name = "corporateTravelPolicyKnowledge")
public Knowledge corporateTravelPolicyKnowledge(
        @Value("classpath:dataset/business_travel_policy.docx") Resource policyResource) {

    // 1) embedding 模型：DashScope text-embedding-v4
    DashScopeTextEmbedding embedding = DashScopeTextEmbedding.builder()
            .modelName("text-embedding-v4")
            .apiKey(apiKey).build();

    // 2) 知识库 = 内存向量库 + embedding 模型
    SimpleKnowledge knowledge = SimpleKnowledge.builder()
            .embeddingStore(InMemoryStore.builder().build())
            .embeddingModel(embedding)
            .build();

    // 3) 读 docx → 切片 → 灌库（block() 阻塞等待，确保 Bean 就绪时数据已就位）
    WordReader reader = new WordReader();
    try {
        File policyFile = policyResource.getFile();
        List<Document> docs = reader.read(ReaderInput.fromPath(policyFile.toPath())).block();
        knowledge.addDocuments(docs).block();
    } catch (Exception e) {
        // 资源缺失或解析失败时主动抛错，提示开发者补齐语料 —— fail-fast
        throw new IllegalStateException(
                "从 classpath 读取 [dataset/business_travel_policy.docx] 失败，"
                + "请确认文件存在于 src/main/resources/dataset/ 目录下。", e);
    }

    return knowledge;
}
```

corporateTravelGuidelinesKnowledge（差旅指南库）是同一套模板，只是换了 business_travel_guidelines.docx。这里有三个值得学的工程细节：

- **文档摄取（ingestion）三步走**：WordReader.read(ReaderInput.fromPath(...)) 负责解析 Word 并切片成 List&lt;Document&gt;，knowledge.addDocuments(docs) 负责把每片做 embedding 并写入 InMemoryStore。切片、分块策略由 AgentScope 的 Reader 内部完成，业务侧不用操心。
- **.block()**** 的用意**：addDocuments 返回的是 Reactor 的 Mono，这里刻意阻塞。因为是在 Spring Bean 初始化阶段，必须保证 Bean 返回时知识库已经灌好，否则第一个请求会检索到空库。
- **fail-fast**：语料文件缺失时直接抛 IllegalStateException 让应用**起不来**，而不是静默降级。知识库是 InfoAgent 的立身之本，宁可启动就报错，也不要上线后才发现检索永远为空。

**两种 VDB 的取舍**：数据量大、独立于发版生命周期 → 托管（BailianKnowledge）；数据量小、随代码走、要求零外部依赖 → 内存（SimpleKnowledge + InMemoryStore）。gogo-agent 在同一个 Agent 上把两者混用，这正是 AgentScope Knowledge 抽象的价值——上层 Agent 根本不关心底层是云端还是内存。

把知识库挂到 Agent 上：.knowledge() + RAGMode.AGENTIC

三个 Knowledge Bean 通过 @Qualifier 注入进 InfoAgent，再在 build() 里一次性挂到 ReActAgent：

```text
@Configuration("infoAgentConfiguration")
public class InfoAgent extends BaseSubAgent {

    @Autowired @Qualifier("attractionKnowledge")
    protected Knowledge attractionKnowledge;
    @Autowired @Qualifier("corporateTravelPolicyKnowledge")
    protected Knowledge corporateTravelPolicyKnowledge;
    @Autowired @Qualifier("corporateTravelGuidelinesKnowledge")
    protected Knowledge corporateTravelGuidelinesKnowledge;

    @Bean(name = "infoAgent")
    @Scope("prototype")
    public ReActAgent build() {
        Toolkit toolkit = new Toolkit();
        // ... 注册 infoQueryTools / policyTools / 天气 MCP / 签证 MCP ...

        ReActAgent agent = ReActAgent.builder()
                .name("InfoAgent")
                .description("信息查询助手，负责查询差旅政策标准、目的地旅游景点、签证入境政策及通用公共信息")
                .model(stableModel)
                .toolkit(toolkit)
                // 三个知识库链式挂载，支持 fan-out 多库并行检索
                .knowledge(attractionKnowledge)
                .knowledge(corporateTravelPolicyKnowledge)
                .knowledge(corporateTravelGuidelinesKnowledge)
                .ragMode(RAGMode.AGENTIC)          // ← 关键：知识库以「工具」形式暴露
                .maxIters(MAX_ITERATIONS)          // 5
                .sysPrompt(PromptLoader.loadStatic("info-agent-system.md"))
                .build();

        return agent;
    }
}
```

这里最需要理解的是 **RAGMode.AGENTIC** 与另一种模式 GENERIC 的区别：

- **RAGMode.GENERIC****（自动注入）**：框架用一个 Hook 拦截每一轮推理，取最后一条 user 消息当 query，**无条件**先检索、把结果拼进上下文，再让模型回答。好处是简单，坏处是——用户随口问句「谢谢」也会触发一次向量检索，浪费 token 和延迟。
- **RAGMode.AGENTIC****（按需检索）**：框架把每个 Knowledge 包装成一个可调用的 @Tool（检索工具）交给模型。模型在 ReAct 循环里**自己决定**要不要检索、检索哪个库、用什么 query。问「上海有什么景点」它会去查景点库；问「你好」它直接回复不检索。

gogo-agent 选 AGENTIC，因为 InfoAgent 同时挂了三个库外加天气/签证 MCP 工具，让模型自主路由「这个问题该查哪个库、还是该调哪个工具」，远比无脑全量检索精准。这也是为什么它的 system prompt 里要专门写一段「RAG 说明」教模型什么时候该检索：

```
## RAG 说明
景点信息、差旅政策、差旅注意事项、差旅行为准则等已接入 RAG 知识库。
用户咨询相关问题时，需要先通过知识库检索后回答。
```

更进一步，system prompt 还定义了「政策查询双通道」的路由规则，这是本工程 RAG 设计里最精彩的一笔：

| 用户问题特征 | 走哪条通道 | 为什么 |
| --- | --- | --- |
| "差旅制度里关于超标住宿是怎么规定的？" | **RAG 知识库**<br>（语义检索） | 问的是通用规则，答案在文档里，适合向量召回 |
| "<br>**我**<br>去上海的住宿标准是多少？" | **PolicyTools.query_travel_policy**<br>**工具** | 要跟用户身份绑定的<br>**精确数字**<br>，必须查结构化系统，不能靠语义召回 |
| "我订的这个酒店超标吗？" | **PolicyTools.check_travel_policy**<br>**工具** | 要做实时合规校验，是计算不是检索 |

这背后的设计哲学是：**RAG 擅长「语义模糊、答案在非结构化文档里」的问题；确定性工具擅长「精确、结构化、需与身份/实时状态绑定」的问题。** 两者冲突时（比如「我的差旅标准」既像政策问题又要精确数字），prompt 明确规定以工具结果为准。并且反复叮嘱模型：**召回内容是参考，不要复述为权威标准；召回为空就说「暂未收录」，绝不编造**——这是企业级 RAG 防幻觉的红线。

同一套 RAG 抽象还被复用在「意图路由」上

io.agentscope.core.rag.* 在 gogo-agent 里不只服务领域知识，还被巧妙复用在**三层意图识别**的 L2 层（向量相似度路由）。IntentRouterKnowledgeConfig 用同样的 SimpleKnowledge + InMemoryStore + text-embedding-v4，只不过灌进去的不是政策文档，而是每类意图的代表问句：

```text
@Bean(name = "intentRouterKnowledge")
public Knowledge intentRouterKnowledge(EmbeddingModel intentRouterEmbeddingModel) {
    InMemoryStore store = InMemoryStore.builder().dimensions(1024).build();
    SimpleKnowledge knowledge = SimpleKnowledge.builder()
            .embeddingModel(intentRouterEmbeddingModel)
            .embeddingStore(store)
            .build();
    List<Document> docs = buildSeedDocuments();   // 15 类意图的种子问句
    knowledge.addDocuments(docs).block();
    return knowledge;
}
```

运行期 IntentVectorMatcher.match() 拿用户问句做 Top-1 检索，相似度 ≥ 0.75 就直接判定意图，省掉一次完整的 LLM 推理：

```text
RetrieveConfig config = RetrieveConfig.builder()
        .limit(1)                 // 只取 top1
        .scoreThreshold(0.0)      // 先不过滤，自己拿原始 score 判阈值
        .build();
List<Document> docs = knowledge.retrieve(normalized, config).block();
// ... score >= 0.75 命中，从 payload 里取出 intent 分类 ...
```

一个知识库抽象、两种用途（领域知识检索 + 意图分类），这说明 RAG 的本质是「语义检索」，凡是能转化成「找最相似的那条」的问题，都能套用同一套基础设施。这里也顺带演示了 RetrieveConfig 的用法：limit 控制 Top-K，scoreThreshold 控制相似度过滤门槛。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a5a07f53fb9180001cb12f6
