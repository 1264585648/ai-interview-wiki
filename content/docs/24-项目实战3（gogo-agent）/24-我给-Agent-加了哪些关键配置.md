---
title: "✅我给 Agent 加了哪些关键配置"
---

# ✅我给 Agent 加了哪些关键配置

先看 MasterAgent 构建时的完整配置，后面逐项拆解：

```text
// MasterAgent#build（节选）
ReActAgent agent = ReActAgent.builder()
 .name("MasterAgent")
 .description("智能差旅主智能体....")
 .model(xxModel)                    // ① 模型分层
 .toolkit(toolkit)                          // ⑧ 工具集（含子智能体）
 .toolExecutionContext(masterToolCtx)              // ⑨ 透明上下文注入
 .toolExecutionConfig(ExecutionConfig.builder()     // ③ 工具超时 + 重试
    .timeout(Duration.ofMinutes(TOOL_TIMEOUT_MINUTES))
    .maxAttempts(3)
    .build())
  .memory(AgentMemoryFactory.create(stableModel))     // ⑤ 自动压缩记忆
  .longTermMemory(longTermMemory)            // ⑥ 长期记忆
  .longTermMemoryMode(LongTermMemoryMode.AGENT_CONTROL)
  .hooks(List.of(xxx))   // ⑦ Hook 编排
  .sysPrompt(PromptLoader.load("master-agent-system.md"))// ⑩ 系统提示词
  .maxIters(MAX_ITERATIONS)                              // ② 迭代上限
  .generateOptions(xxx)                      // ④ 上下文缓存
        .build();
```

这些配置分四类目标：**控成本**（①④⑤）、**保稳定**（②③⑦）、**管记忆**（⑤⑥）、**做扩展**（⑧⑨⑩）。下面逐项展开。

1.模型分层：按「贵不贵」分角色

我们没有全局用一个模型，而是在 ModelConfig 里定义了4档，按任务价值挑模型：

2.maxIters：给 ReAct 循环上「保险丝」

ReActAgent 是「推理→调工具→再推理」的循环，不设上限，模型一旦陷入死循环会烧钱烧到超时。我按 Agent 复杂度给了不同上限：

```text
.maxIters(MAX_ITERATIONS)   // MasterAgent=15, Plan=15, Manage/Booking=10, Info=5
```

| Agent | maxIters | 依据 |
| --- | --- | --- |
| MasterAgent / ItineraryPlanAgent | 15 | 要多轮协调子 Agent / 搜比价，步骤最多 |
| ItineraryManageAgent / BookingAgent | 10 | 单域内多步操作 |
| InfoAgent | 5 | 查完就答，无需长链 |

**越靠近纯查询，上限越低**——既是成本闸，也是「跑偏时尽早止损」的兜底。

3.工具执行：超时 + 自动重试（保稳定）

工具会调外部 API/CLI，网络抖动是常态。我给工具执行加了超时与重试策略。基类里沉淀了统一的默认配置：

```text
// BaseSubAgent#getToolConfig —— 子 Agent 通用工具执行策略
public ExecutionConfig getToolConfig() {
    return ExecutionConfig.builder()
            .timeout(Duration.ofMinutes(1))                       // 单次工具最多等 1 分钟
            .maxAttempts(3)                                       // 最多 3 次（含首次）
            .initialBackoff(Duration.ofSeconds(3))                // 首次退避 3 秒
            .retryOn(error -> error instanceof java.io.IOException)// ★ 只对网络类错误重试
            .build();
}
```

4.cacheControl(true)：白嫖百炼隐式缓存

多轮对话里，system prompt 和历史前缀几乎不变，每轮重复计费很亏。开这个开关后，框架会自动给 system messages 与最后一条消息打上 cache_control，命中百炼的隐式缓存，**重复前缀按缓存价计费**：

```text
.generateOptions(GenerateOptions.builder()
        .cacheControl(true)   // 框架自动对 system + 末条消息加 cache_control
        .build())
```

5.memory：自动压缩/卸载，抑制 token 膨胀

多智能体多轮对话，输入 token 会滚雪球。我没有用默认 memory，而是统一用 AgentMemoryFactory 产出一个调优过的 AutoContextMemory：

```text
.memory(AgentMemoryFactory.create(stableModel))   // 用 stableModel 做压缩摘要（不用最贵模型）
```

6.长期记忆

跨会话记住用户的出行偏好，靠长期记忆。它按 userId 隔离（userId 从 TTL 上下文读出）：

```text
.longTermMemory(longTermMemory)                       // 按 userId 构建，跨会话保留偏好
.longTermMemoryMode(LongTermMemoryMode.AGENT_CONTROL) // 由 Agent 自主决定何时读写记忆
```

7. hooks：把横切能力插进生命周期（保稳定 + 可观测）

这是我配置最重的一块。Hook 是挂在 Agent 执行前后/工具前后的回调，我用它把大量横切逻辑从业务里剥离出来。以 BookingAgent 为例，挂了整整一串：

```text
.hooks(List.of(
    dynamicTimeInjectionHook,    // 每轮注入当前时间（且保持 system 前缀稳定，利于缓存）
    new AutoContextHook(),       // 配合 AutoContextMemory 执行压缩/卸载
    cliResultCompressHook,       // CLI 结果去重压缩
    flightApiKeyHook, tuniuApiKeyHook,  // 第三方 API Key 注入
    rghUserIsolationHook,        // 酒店 CLI 按用户隔离本地目录/Token
    skillContentCollapseHook,    // 技能内容折叠
    sessionPersistenceHook,      // 会话持久化
    executionLoggerHook,         // 执行日志（可观测）
    toolCircuitBreakerHook,      // 工具熔断
    progressNotifierHook,        // 进度推送前端
    activeAgentPersistenceHook,  // 记录当前活跃 Agent（continuation 用）
    bookingPersistenceHook,      // 下单结果自动落库
    new PendingToolRecoveryHook()// 工具挂起恢复（Human-in-the-Loop）
))
```

几个关键 Hook 的价值：toolCircuitBreakerHook（熔断，防某个工具反复失败拖垮整体）、PendingToolRecoveryHook（支持工具挂起后等用户回复再续跑，跨节点恢复）、executionLoggerHook+progressNotifierHook（可观测 + 前端进度条）。不同 Agent 按需裁剪——InfoAgent 只挂了 8 个，没有预订相关的 Hook。

8. 工具与技能：并行、Shell 白名单、子智能体即工具

**工具并行**：预订/规划这类需要同时查多个数据源的 Agent 开了并行工具执行：

```text
Toolkit toolkit = new Toolkit(ToolkitConfig.builder().parallel(true).build());
```

**技能 + 受限 Shell**：BookingAgent 挂载 tuniu-cli 技能，并且**用白名单严格限制可执行命令**，防止模型执行任意命令：

```text
skillBox.registerSkill(skillRepository.getSkill("tuniu-cli"));
ShellCommandTool shellTool = new ShellCommandTool(
        null,
        Set.of("tuniu", "env", "bash", "cat", "grep", "date", "which", "ls"),  // ★ 命令白名单
        null);
skillBox.codeExecution().withShell(shellTool).withRead().withWrite().enable();
```

**子智能体即工具**：MasterAgent 把 4 个子 Agent 用 SubAgentProvider 注册成工具，让主模型像调工具一样调度子 Agent（详见「智能体清单」文档）。

9. toolExecutionContext：对 LLM 透明的上下文注入

把 userId/sessionId（从 TTL 读出）注入工具执行上下文，工具方法能直接拿到，但**不出现在 LLM 的 function schema 里**：

```text
.toolExecutionContext(createToolCtx())   // BaseSubAgent: register(AgentSessionContext)
```

既省 token 又防止模型篡改用户身份

10. RAG 知识库：knowledge + RAGMode.AGENTIC

InfoAgent 挂了三个向量知识库，并用「智能体自主检索」模式：

```text
// InfoAgent#build（节选）
.model(stableModel)   // 信息查询用中档模型即可
.knowledge(attractionKnowledge)               // 景点
.knowledge(corporateTravelPolicyKnowledge)    // 差旅政策
.knowledge(corporateTravelGuidelinesKnowledge)// 差旅指南
.ragMode(RAGMode.AGENTIC)   // 由模型自行决定是否检索、检索什么
```

AGENTIC 模式让模型自主判断「这个问题要不要查知识库、查哪个」，而不是每次都盲目检索。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a60bf7dd31fed0001cd231b
