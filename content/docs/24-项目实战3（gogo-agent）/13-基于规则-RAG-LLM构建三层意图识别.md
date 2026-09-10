---
title: "✅基于规则+RAG+LLM构建三层意图识别"
---

# ✅基于规则+RAG+LLM构建三层意图识别

意图识别嘛，把用户的话丢给大模型，让它输出一个分类 JSON 不就行了？能跑，但是实际企业里面用起来，这个"纯 LLM"方案有三个致命成本：

1. **慢**。一次 LLM 分类动辄 300ms～2s，而"你好""查一下审批进度"这种高频、模板化的话，本不该为一句问候付一次大模型的延迟。
2. **贵**。每一句都过一次大模型，token 成本随流量线性增长，其中相当大比例是"闭眼都能判对"的简单意图。
3. **不稳定**。LLM 偶发漂移，同一句话今天判 A 明天判 B，难以回归测试。

gogo-agent 的解法是把意图识别做成一条**短路流水线**：先用最便宜、最快、最确定的手段试，试不出来再逐级升级到更贵但更聪明的手段。这就是"三层"：

| 层 | 手段 | 命中场景 | 目标延迟 | 是否调用大模型 |
| --- | --- | --- | --- | --- |
| **L0** | 规则 | 多意图识别 | &lt; 50ms | 否 |
| **L1** | 规则 / 关键词（正则） | 高频、模板化、表达清晰（"报销""你好""查审批"） | &lt; 50ms | 否 |
| **L2** | 向量相似度（RAG 检索） | 口语化、换了说法但语义清晰（"垫付的钱帮我弄回来"） | &lt; 100ms | 否（只做 embedding） |
| **L3** | LLM 兜底 | 模糊、多意图、跨领域、信息不足 | 数百 ms～数 s | 是 |

设计哲学一句话：**L0/L1 求快、L2 求全、L3 求准**。前两层能拦下的绝不惊动大模型；只有真正含糊的问题才交给 L3。整套机制上线后可以通过日志观察各层命中率，持续把 L3 的流量往 L1/L2 迁。

![](assets/6ce334b5cecb.png)

贯穿三层还有一个关键约束——**三层的输出必须同构**。无论哪层命中，最终都产出同一个 JSON schema（intents / primary_intent / multi_intent / overall_reason），这样下游的调度逻辑（MasterAgent 路由、子智能体直跳）完全不需要知道"这次是第几层判的"。

这个同构就落在 IntentRecognitionResult 上。它是 L1/L2/L3 共同的产物类型，也是下游调度唯一认识的数据结构。

```text
public class IntentRecognitionResult {

    public enum Source { RULE, VECTOR, LLM }              // 哪一层命中（仅用于排障/日志）
    public enum Confidence {
        HIGH, MEDIUM, LOW;
        public String wireValue() { return name().toLowerCase(); } // 序列化为 high/medium/low
        public static Confidence fromWire(String v) { /* high→HIGH, 其余→LOW */ }
    }

    // 单个意图项：类别 + 目标 agent + 置信度 + 理由
    public static class IntentItem {
        private final IntentCategory category;
        private final String targetAgent;
        private final Confidence confidence;
        private final String reason;

        public Map<String, Object> toMap() {
            return Map.of(
                    "intent", getIntent(),                 // 意图 code
                    "target_agent", targetAgent == null ? "" : targetAgent,
                    "confidence", confidence.wireValue(),
                    "reason", reason == null ? "" : reason);
        }
    }

    private final Source source;
    private final List<IntentItem> intents;
    private final IntentCategory primary;
    private final boolean multiIntent;
    private final String overallReason;
    private final Double score;   // L1/L2 命中时的分数（向量相似度等），L3 为 null

    // 便捷工厂：单意图结果（L1/L2 只会产出单意图）
    public static IntentRecognitionResult single(Source source, IntentCategory category,
                                                 Confidence confidence, String reason, Double score) {
        String target = (category == null ? IntentCategory.UNKNOWN : category).getDefaultTargetAgent();
        IntentItem item = new IntentItem(category, target, confidence, reason);
        return new IntentRecognitionResult(source, List.of(item),
                category, false /* multiIntent */, reason, score);
    }

    // 关键：输出与 LLM 同构的 JSON Map，塞进下游 agent 的上下文
    public Map<String, Object> toJsonMap() {
        return Map.of(
                "intents", intents.stream().map(IntentItem::toMap).toList(),
                "primary_intent", getPrimaryIntent(),
                "multi_intent", multiIntent,
                "overall_reason", overallReason);
    }
}
```

意图分类的"字典"：IntentCategory

在讲三层之前，先看清楚"意图"到底有哪些、每种意图该路由到哪个子智能体。这是整个体系的公共词表，L1/L2/L3 都引用它。

```text
public enum IntentCategory {
    // code（路由 JSON 用的标识） / defaultTargetAgent（目标子智能体 bean 名） / description（中文说明）
    TRAVEL_APPLICATION("travel_application", "ItineraryManageAgent", "用户要提交新的差旅申请/出差审批"),
    TRAVEL_CANCEL     ("travel_cancel",      "ItineraryManageAgent", "用户要取消出差申请或审批单"),
    TRAVEL_MODIFY     ("travel_modify",      "ItineraryManageAgent", "用户要修改差旅申请信息"),
    APPROVAL_QUERY    ("approval_query",     "ItineraryManageAgent", "用户查询审批进度/状态/结果"),
    TRAVEL_ORDER_QUERY("travel_order_query", "ItineraryManageAgent", "用户查询已有差旅单详情/状态"),
    ITINERARY_PLANNING("itinerary_planning", "ItineraryPlanAgent",   "用户要求规划行程、做方案"),
    FLIGHT_SEARCH     ("flight_search",      "ItineraryPlanAgent",   "用户要查航班"),
    TRAIN_SEARCH      ("train_search",       "ItineraryPlanAgent",   "用户要查火车"),
    HOTEL_SEARCH      ("hotel_search",       "ItineraryPlanAgent",   "用户要查酒店"),
    BOOKING           ("booking",            "BookingAgent",         "用户要预订/改签/取消已选方案"),
    REIMBURSEMENT     ("reimbursement",      "ReimbursementAgent",   "用户要报销、识别发票、生成报销单"),
    POLICY_QUERY      ("policy_query",       "InfoAgent",            "用户查询差旅政策/餐标/酒店标准/签证入境政策"),
    ATTRACTIONS_QUERY ("attractions_query",  "InfoAgent",            "用户查询目的地景点、旅游信息"),
    GENERAL_INFO      ("general_info",       "InfoAgent",            "天气/地图/交通/目的地新闻等通用信息查询"),
    GREETING          ("greeting",           "MasterAgent",          "用户打招呼、寒暄"),
    UNKNOWN           ("unknown",            "MasterAgent",          "无法明确分类或信息严重不足");

    // 根据 code 反查枚举；查不到一律返回 UNKNOWN（对未知输入保持健壮）
    public static IntentCategory fromCode(String code) {
        if (code == null || code.isBlank()) return UNKNOWN;
        for (IntentCategory c : values()) {
            if (c.code.equals(code)) return c;
        }
        return UNKNOWN;
    }
}
```

这里有三个值得注意的设计：

一是**每个意图自带 ****defaultTargetAgent**，意图识别的产物天然携带"该去哪"，路由层无需再维护一张 intent → agent 映射表。16 个意图收敛到 5 个子智能体：差旅单管理（ItineraryManageAgent）、行程规划（ItineraryPlanAgent）、预订（BookingAgent）、报销（ReimbursementAgent）、信息问答（InfoAgent），外加兜底的 MasterAgent。

二是**枚举与 L3 的系统提示词一一对应**。prompts/intent-recognition-agent-system.md 里定义的意图类别，和这个枚举严格对齐——这样 L3 LLM 吐出来的 code，用 fromCode() 一定能落到某个枚举上，落不上就是 UNKNOWN，绝不会抛异常。

三是 **fromCode**** 的兜底语义**：任何不认识的 code 都归 UNKNOWN → MasterAgent。这让"新加意图但 LLM 提前学会了""LLM 手滑输出错别字"这类情况都能安全降级，而不是让流水线崩掉。

L1：规则 / 关键词匹配（求快）

L1 是最外层的过滤网，目标是用**纯内存正则**在 50ms 内拦下所有"闭眼可判"的高频表达。核心是 IntentRuleMatcher。

L2：向量相似度 / RAG（求全）

L3：LLM 兜底 + 三层编排

编排器：IntentRecognitionRouter（L1 → L2）

IntentRecognitionRouter 负责把 L1、L2 串成短路流水线，并**不**自己调 L3——L3 由调用方在拿到 empty 时兜底。

```text
@Component
public class IntentRecognitionRouter {

    private static final long L1_TARGET_MS = 50;   // 软目标，仅用于日志告警
    private static final long L2_TARGET_MS = 100;

    @Autowired private IntentRuleMatcher ruleMatcher;
    @Autowired private IntentVectorMatcher vectorMatcher;

    public Optional<IntentRecognitionResult> route(String question) {
        if (question == null || question.isBlank()) return Optional.empty();
        String normalized = question.trim();

        // -------- L1 --------
        long l1Start = System.nanoTime();
        Optional<IntentRecognitionResult> ruleHit = ruleMatcher.match(normalized);
        long l1Ms = (System.nanoTime() - l1Start) / 1_000_000L;
        if (ruleHit.isPresent()) {
            logResult("L1", l1Ms, ruleHit.get(), true);
            warnIfSlow("L1", l1Ms, L1_TARGET_MS);   // 超过 50ms 打告警
            return ruleHit;                          // 命中即短路
        }

        // -------- L2 --------
        long l2Start = System.nanoTime();
        Optional<IntentRecognitionResult> vectorHit;
        try {
            vectorHit = vectorMatcher.match(normalized);
        } catch (Exception e) {
            vectorHit = Optional.empty();            // L2 异常 → 降级 L3
            logger.warn("[INTENT_ROUTER] L2 异常，降级到 L3: {}", e.getMessage());
        }
        long l2Ms = (System.nanoTime() - l2Start) / 1_000_000L;
        if (vectorHit.isPresent()) {
            logResult("L2", l2Ms, vectorHit.get(), true);
            warnIfSlow("L2", l2Ms, L2_TARGET_MS);
            return vectorHit;
        }

        // L1/L2 都没命中 → 返回 empty，调用方负责 L3 兜底
        logger.info("[INTENT_ROUTER] L1/L2 miss, will fall through to L3 (q='{}', L1={}ms, L2={}ms)",
                truncate(normalized), l1Ms, l2Ms);
        return Optional.empty();
    }
}
```

它做的事很纯粹：**依次试 L1、L2，命中即短路返回；每层都埋点计时**（超过软目标就打 warn，方便上线后监控 embedding/规则的性能退化）；都没命中就返回 empty，把"是否升级到 L3"的决定权交给调用方。这种"编排器不管 L3"的设计，是为了让 L3（要调大模型、要挂 Hook、要走 AgentScope 的 Agent 生命周期）留在真正的 Agent 里，编排器保持轻量、可单测。

智能体：IntentRecognitionAgent（L1-L2-L3）

IntentRecognitionAgent 继承 AgentScope 的 AgentBase，把"三层短路 + L3 LLM"封装成一个标准 Agent。它同时扮演"工厂配置"和"Agent 实现"两个角色：

```text
@Component("intentRecognitionAgent")
@Scope("prototype")   // 每个 session 拿独立实例，中断状态互不污染
public class IntentRecognitionAgent extends AgentBase {

    private final Model strongModel;  // L3 用的大模型
    private final IntentRecognitionRouter router; // L1/L2 编排器

    public IntentRecognitionAgent(@Qualifier("strongModel") Model strongModel,IntentRecognitionRouter router,/* 各类 Hook … */) {
        super(NAME, "差旅对话意图识别与路由决策（L1/L2/L3 三层）", true,
                List.of(executionLoggerHook, progressNotifierHook,
                        sessionPersistenceHook, activeAgentPersistenceHook));
        this.strongModel = strongModel;
        this.router = router;
    }

    @Override
    protected Mono<Msg> doCall(List<Msg> msgs) {
        String question = extractLatestUserText(msgs);
        if (question != null && !question.isBlank()) {
            Optional<IntentRecognitionResult> hit = router.route(question); // 先试 L1/L2
            if (hit.isPresent()) {
                // L1/L2 命中：直接把统一结果序列化成 JSON 返回，完全绕过大模型
                String json = JSON.toJSONString(hit.get().toJsonMap());
                return Mono.just(Msg.builder().name(NAME).role(MsgRole.ASSISTANT)
                        .content(TextBlock.builder().text(json).build()).build());
            }
        }
        // L1/L2 未命中 → L3 LLM 兜底
        return callLlmFallback(msgs);
    }

    // L3：意图识别是"单轮、无工具、maxIters=1"，不必套 ReActAgent，直接 Model.stream 一次
    private Mono<Msg> callLlmFallback(List<Msg> msgs) {
        List<Msg> messages = new ArrayList<>();
        messages.add(Msg.builder().role(MsgRole.SYSTEM).name("system")
                .content(TextBlock.builder()
                        .text(PromptLoader.load("intent-recognition-agent-system.md")) // 分类提示词
                        .build())
                .build());
        if (msgs != null) messages.addAll(msgs);
        return Mono.fromCallable(() -> strongModel.stream(messages, null, null).collectList().block())
                .map(responses -> Msg.builder().name(NAME).role(MsgRole.ASSISTANT)
                        .content(TextBlock.builder().text(extractText(responses)).build()).build());
    }
}
```

三个设计亮点：

**其一，L3 不套 ****ReActAgent****。**

**其二，****@Scope("prototype")****。** 每个会话拿到独立的 Agent 实例，避免并发会话之间的中断状态互相污染。

**其三，****doCall**** 里再次调用 ****router.route()****。** 你可能疑惑：编排器只做 L1/L2，那 Agent 的 doCall 岂不是又把 L1/L2 走了一遍？是的——但这是有意的分层：编排器可以被"快路径"单独调用，而 Agent 是"完整路径"的入口，它先复用编排器试 L1/L2，不中才落 L3。主要是因为如果L1/L2不命中，我们会走问题改写，问题改写后的问题，很大概率能重新命中L1/L2，所以这里的Agent中要把L1/L2在走一遍。（这个流程后面讲）

L3 的分类提示词：intent-recognition-agent-system.md

L3 的"聪明"全靠这份系统提示词。它给大模型定了几条硬规矩：

- **输出严格 JSON、禁止任何自然语言解释、禁止调用工具**，schema 与 toJsonMap() 完全一致（这是三层同构的另一半保障）。
- **target_agent**** 必须是 camelCase 的 Spring bean 名**（itineraryManageAgent、infoAgent…），因为下游会直接 context.getBean(target_agent)，命名错了就路由失败。
- **多意图要全部识别并按依赖顺序排列**（如"先申请后规划、先规划后预订"），并在 primary_intent 里点出最紧迫的那个。
- **reason****/****overall_reason**** 面向用户展示，严禁泄露内部名词**（工具函数名、bean 名、字段名、文件路径），必须用自然中文描述分类理由。
- **低置信度处理**：拿不准就标 low 或直接 unknown → masterAgent，交给 MasterAgent 追问确认。

提示词里还带了两个 few-shot 示例（单意图差旅申请、多意图"审批通过后规划+订酒店"），把输出格式钉死。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a5a07dcc71a8900017abd55
