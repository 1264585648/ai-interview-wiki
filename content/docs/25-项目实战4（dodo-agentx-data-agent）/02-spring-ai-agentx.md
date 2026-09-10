---
title: "✅spring-ai-agentx"
---

# ✅spring-ai-agentx

dodo-agentx 各个功能，底层靠的都是 spring-ai-agentx 框架。那它和 Spring AI 是什么关系、目前有哪些功能特性、后续还会增加什么功能、和 spring-ai-alibaba 的方案有什么不同，针对这些问题，我们来一一介绍一下。

和 Spring AI 是什么关系

Spring AI 提供了与 LLM 交互的基础组件：ChatClient 负责模型调用，ToolCallback 负责工具注册与执行，ChatMemory 负责会话记忆，VectorStore 负责向量检索。spring-ai-agentx 完全基于这些组件构建，不重复造轮子。

但要做真正可用的 Agent，只是有这些基础组件还远远不够。React 推理循环、多轮工具调用、长上下文管理、人机协作、中断恢复、TodoWrite自主规划、ToolSearch减少工具上下文、异常重试......这些能力 Spring AI 并没有提供完整的解决方案。

Spring AI 其实也发现了这部分的问题，推出了 **spring-ai-agent-utils** 试图补充这块，方向没问题，但是整体更新进度已经明显落后了。

agentx 做的就是在 Spring AI 之上，把 ChatClient、ToolCallback、ChatMemory 这些组件编排成一个完整的 Agent 运行时。

和 spring-ai-alibaba 的差异

同样是在 Spring AI 之上构建 Agent 层，spring-ai-alibaba 走的是另一条路——借鉴 LangGraph，把 Agent 建模为一张有向图：每个执行步骤是一个节点，节点之间通过边连接，整体执行状态由 State 统一维护。

Graph 的表达能力很强，适合流程固定、分支明确、需要可视化编排的复杂工作流。但对于偏推理型、需要高度动态决策的 Agent，会有一些工程上的权衡：

- 即使是简单的 ReAct 循环，也得先把执行流程拆成节点、边和状态，再交给 Graph 运行时调度。开发者要按 Graph 的方式组织代码，而不是直接描述执行逻辑。
- 执行过程由 Graph 运行时调度，真正的执行链路分散在节点、边和状态迁移之间，调试和排查问题需要更多上下文。
- 想在推理过程中动态调整逻辑、插入自定义事件、细粒度控制流式输出或扩展生命周期，都得围绕 Graph 的机制来做，没法直接在执行流程里改。

agentx 没有引入 Graph 抽象，而是直接基于 Reactor 的响应式流构建 Agent Runtime。ReAct 循环就是一条响应式流水线，流式输出对应 Flux，工具调用通过响应式组合实现并发，整个执行过程保持线性代码结构，想在哪一步介入都行。

而且响应式模型天然适配 Agent 场景：流式输出、异步工具调用、中间事件推送、执行状态传播，本质上都是异步数据流。

目前有哪些功能特性

响应式驱动

整个 Agent 由 Reactor 响应式流驱动：

```text
用户请求
    │
    ▼
ReactAgent.callForResult() / streamForResult()
    │
    ▼
AgentLoopExecutor —— ReAct 循环引擎
    │
    ├─ 构建消息列表（系统提示 + 记忆 + 历史 + 当前问题）
    ├─ LLM 推理 → Reactor Flux 异步推送事件
    ├─ 判断工具调用 → 并发执行工具
    ├─ 上下文压缩（micro_compact / auto_compact）
    └─ 循环直到无工具调用
    │
    ▼
返回 AgentResult / Flux<AgentStreamEvent>
```

执行流程就是一段线性代码，每一步都可以方便地介入。

这里有一个关键设计：不论是 `callForResult`（同步）还是 `streamForResult`（流式），底层调的都是大模型的流式接口（`stream=true`）。同步调用本质上就是流式的阻塞实现，等所有 chunk 到齐后拼装返回。这样做的好处是底层只需要一套实现，不用维护两套逻辑。而且流式管道天然支持分阶段输出、中途取消、实时推送工具执行状态，灵活性相对更好。

统一入口

agentx 对外只有一个核心类：`ReactAgent`。所有能力通过 Builder 配置组合，一个最简的 Agent 只需要 `chatModel`，其他全是可选：

```java
ReactAgent agent = ReactAgent.builder()
        .chatModel(chatModel)          // 模型（唯一必填）
        .dataSource(dataSource)        // 传入即自动建表管理会话
        .tools(mergeTools(             // 工具：内置 + @Tool 自定义 + MCP
                FileSystemTools.create(),
                BashTool.create(),
                ToolCallbacks.from(new OrderTool())))
        .deferredTools(config, weatherTools)      // ToolSearch 延迟加载
        .contextPolicy(ContextPolicy.defaults())   // 上下文压缩
        .askUser(true)                            // Human-in-the-Loop
        .thinkingMode(ThinkingMode.REASONING_CONTENT)  // 思考模型适配
        .stageOutputProviders(new RefProvider())       // 分阶段输出
        .subAgent(() -> ReactAgent.builder()           // 子代理
                .name("code-analyzer")...)
        .build();
```

核心能力

当前版本 v1.0.0-M2，框架提供的能力：

| 能力 | 说明 |
| --- | --- |
| **ReAct 执行引擎** | `AgentLoopExecutor`<br>驱动"推理→工具调用→再推理"的循环，同步和流式两条路径 |
| **分层记忆体系** | 短期记忆（JDBC 会话表）+ 会话摘要（向量库，溢出自动压缩）+ 跨会话全局知识（向量库，承担用户画像职能）三层协作 |
| **工具管理** | 内置 FileSystem/Bash/Grep/Python + Spring AI<br>`@Tool`<br>注解 + MCP 协议 + Skills 技能体系（渐进式披露） |
| **ToolSearch 延迟加载** | 工具超过一定数量时，alwaysLoad + deferred 分级管理，LLM 按需通过<br>`tool_search`<br>元工具搜索加载，避免上下文膨胀 |
| **Human-in-the-Loop** | `PauseAdvisor`<br>拦截审批工具和用户输入工具，非阻塞暂停 / 恢复，支持流式 |
| **中断与恢复** | `PauseState`<br>快照持久化到数据库，支持 HITL 暂停和用户主动中断两种场景，可跨进程恢复 |
| **上下文压缩** | 两层策略：micro_compact 每轮自动替换旧工具响应为 JSON 占位符（不调 LLM），auto_compact 超 token 阈值时 LLM 生成结构化摘要 |
| **SubAgent 子代理** | 主 Agent 将任务委派给专门的子 Agent，独立 context window，事件流携带来源标识 |
| **思考模型适配** | 统一适配 DeepSeek/Qwen3 的<br>`reasoning_content`<br>字段和 MiniMax 的<br>`<think/>`<br>标签两种输出格式 |
| **TodoWrite 任务追踪** | 结构化任务列表工具，LLM 自动维护多步骤任务的 pending / in_progress / completed 状态 |
| **分阶段输出** | `StageOutputProvider`<br>SPI，在 Agent 生命周期节点（启动后/工具结束后/完成前）注入引用提取、推荐问题等自定义输出 |
| **TraceAudit 追踪审计** | 记录每轮 LLM 调用的请求/响应/token 用量/耗时，OpenAI 兼容格式便于回放和问题定位 |
| **任务管理与并发控制** | 同会话并发请求拒绝、外部中断正在执行的流式任务 |
| **异常处理与重试** | 透明重试（默认 3 次），流式模式实时推送重试状态事件 |

更多细节可以看源码：

[GitHub - bigchuidw3/spring-ai-agentx: 基于原生 Spring AI 的智能体（Agent）开发框架，提供 ReAct 执行引擎、分层记忆、工具调度、Human-in-the-Loop 等核心能力，形成完整的 Harness Engineering 方案，帮助开发者快速构建 AI Agent，可以快速搭建 Java 版的 Claude Code。](https://github.com/bigchuidw3/spring-ai-agentx)

框架功能会讲什么

本章节将以 DataAgent 为业务驱动，重点介绍以下功能：

| 功能 | 解决的问题 |
| --- | --- |
| **ToolSearch 工具检索** | 解决业务工具数量增长后，工具描述占用大量上下文、模型选择工具困难的问题，介绍工具渐进式披露和动态加载机制<br>文档 |
| **RunnableParams 动态参数** | 通过 RunnableParams 动态覆盖工具参数，精准控制工具行为<br>文档 |
| **TodoWrite 任务管理** | 解决复杂任务执行过程中容易遗漏步骤、执行过程不可见的问题，介绍 Agent 如何维护任务计划以及任务状态如何同步<br>文档 |
| **中断与恢复机制** | 解决长流程任务执行过程中暂停、失败后无法继续的问题，介绍 Agent 状态快照保存以及恢复执行机制<br>文档 |

每个功能会从三个层面展开：

1. **业务场景：为什么需要这个能力，以及它解决了什么实际问题**
2. **框架实现：agentx 底层如何设计和实现该能力**
3. **业务使用：在 DataAgent 中如何接入和使用该能力**

通过这些功能的源码实现分析，帮助开发者不仅了解这些能力的作用，更理解这些能力背后的设计思路和实现原理。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a54c58da7c8ff000107b166
