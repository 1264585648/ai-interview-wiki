---
title: "✅信息查询Agent的功能介绍与开发"
---

# ✅信息查询Agent的功能介绍与开发

差旅场景里有一大类请求既不涉及审批流，也不涉及订票出票，只是“查点东西”：

- “我去上海的住宿标准是多少？”
- “北京下周天气怎么样？”
- “杭州最近有什么展会，会不会影响出行？”
- “泰国免签政策是什么？”

这类请求如果全部交给负责行程管理的 ItineraryManageAgent 或负责规划的 ItineraryPlanAgent，会让它们的工具列表和系统提示变得臃肿，且容易在“只读查询”中误触发写操作。gogo-agent 因此拆出一个专门的信息查询子智能体——InfoAgent，职责单一：**只回答、不修改、不决策**。

InfoAgent 不是独立对外暴露的 Agent，也是作为工具被注册在 MasterAgent 中作为工具。MasterAgent 的 LLM 在推理时，如果觉得用户问题是“查信息”，就会调用 info_agent 这个子 Agent 工具，把问题描述透传给它；InfoAgent 内部再用自己的工具和知识库回答，最后把结果返回给 MasterAgent。

哪些意图会被路由到 InfoAgent？在意图分类 IntentCategory 中定义了三类：

```text
// gogo-agent/src/main/java/com/gogo/travel/agent/intent/IntentCategory.java
POLICY_QUERY("policy_query", "InfoAgent", "用户查询差旅政策/餐标/酒店标准/签证入境政策"),
ATTRACTIONS_QUERY("attractions_query", "InfoAgent", "用户查询目的地景点、旅游信息"),
GENERAL_INFO("general_info", "InfoAgent", "天气/地图/交通/目的地新闻等通用信息查询"),
```

InfoAgent 的定位在系统提示中被严格限定：

```text
# gogo-agent/src/main/resources/prompts/info-agent-system.md

你是 GoGo 差旅助手的信息查询助手（InfoAgent），你负责回答用户关于目的地旅游景点、签证入境政策、差旅政策标准以及通用公共信息（天气、交通等）方面的查询。

你的核心职责是：
1. 精准查询：根据用户问题选择合适的工具获取信息。
2. 整合回答：将工具返回的原始数据整理成自然语言，直接回答用户的问题。
3. 补充建议：在结果基础上给出相关的差旅建议或注意事项。

# 禁止行为

- 不得修改、提交、取消任何差旅单/审批。
- 不得代替用户做决策（例如"我帮你订酒店"）。
- 不要反问用户获取不必须的信息；如确实缺少关键参数，直接在回复中向用户提出清晰具体的问题，说明为什么需要这个信息。
```

InfoAgent定义如下：

```text
// gogo-agent/src/main/java/com/gogo/travel/agent/InfoAgent.java
@Configuration("infoAgentConfiguration")
public class InfoAgent extends BaseSubAgent {

    private static final int MAX_ITERATIONS = 5;

    @Autowired
    @Qualifier("attractionKnowledge")
    protected Knowledge attractionKnowledge;

    @Autowired
    @Qualifier("corporateTravelPolicyKnowledge")
    protected Knowledge corporateTravelPolicyKnowledge;

    @Autowired
    @Qualifier("corporateTravelGuidelinesKnowledge")
    protected Knowledge corporateTravelGuidelinesKnowledge;

    @Bean(name = "infoAgent")
    @Scope("prototype")
    public ReActAgent build() {
        Toolkit toolkit = new Toolkit();

        // 把 destinationLiveTools 纳入熔断分组
        toolkit.createToolGroup(TOOL_CIRCUIT_BREAKER_GROUP, TOOL_CIRCUIT_BREAKER_GROUP, true);

        toolkit.registration().tool(policyTools).apply();
        toolkit.registration().tool(destinationLiveTools).group(TOOL_CIRCUIT_BREAKER_GROUP).apply();
        toolkit.registration().mcpClient(weatherMcpClient).enableTools(weatherMcpEnabledTools).apply();
        toolkit.registration().mcpClient(oriznVisaMcpClient).enableTools(oriznMcpEnabledTools).apply();

        ReActAgent agent = ReActAgent.builder()
                .name("InfoAgent")
                .description("信息查询助手，负责查询差旅政策标准、目的地旅游景点、签证入境政策及通用公共信息")
                .model(stableModel)
                .toolkit(toolkit)
                .toolExecutionContext(createToolCtx())
                .memory(AgentMemoryFactory.create(stableModel))
                .hooks(List.of(dynamicTimeInjectionHook, new AutoContextHook(), cliResultCompressHook,
                        toolCircuitBreakerHook, executionLoggerHook, progressNotifierHook,
                        sessionPersistenceHook, new PendingToolRecoveryHook()))
                .sysPrompt(PromptLoader.loadStatic("info-agent-system.md"))
                .maxIters(MAX_ITERATIONS)
                .knowledge(attractionKnowledge)
                .knowledge(corporateTravelPolicyKnowledge)
                .knowledge(corporateTravelGuidelinesKnowledge)
                .toolExecutionConfig(getToolConfig())
                .ragMode(RAGMode.AGENTIC)
                .generateOptions(getGenerateOptions())
                .build();

        return agent;
    }
}
```

几个关键点：

- **继承 ****BaseSubAgent**：复用所有子 Agent 共享的模型、工具、Hook、执行配置等。
- **@Scope("prototype")**：每个用户请求会创建新的 InfoAgent 实例，避免跨会话状态串扰。
- **挂载 3 个 RAG 知识库**：景点、差旅政策、差旅指南。
- **RAGMode.AGENTIC**：AgentScope 不会自动把知识库内容注入到 prompt，而是把 retrieve 作为一个工具暴露给 LLM，由 LLM 自己决定何时检索、检索什么。这让 InfoAgent 在不需要 RAG 的问题（如查天气）上不会浪费检索调用。
- **最多迭代 5 轮**：够用即可，避免推理过长。

InfoAgent 的工具分成三类：

| 工具/来源 | 作用 | 关键方法 |
| --- | --- | --- |
| PolicyTools | 精确差旅政策查询与合规校验 | query_travel_policy、check_travel_policy |
| DestinationLiveTools | 天气、目的地新闻等联网信息 | query_weather、query_destination_news |
| MCP 客户端 | 天气 MCP、Orizn 签证 MCP | 通过配置weatherMcpEnabledTools<br>、oriznMcpEnabledTools动态启用 |

DestinationLiveTools、天气MCP、PolicyTools前面我们介绍过了，签证MCP后面介绍。

差旅政策的双通道支持

景点&差旅指南的RAG支持

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a7b41fcc71a89000199424a
