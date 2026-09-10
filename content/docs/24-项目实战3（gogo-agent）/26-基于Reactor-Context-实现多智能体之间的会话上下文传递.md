---
title: "✅基于Reactor Context 实现多智能体之间的会话上下文传递"
---

# ✅基于Reactor Context 实现多智能体之间的会话上下文传递

本项目的会话上下文有两个核心字段：

- `userId`：由 Sa-Token 从 Token 解析得到，服务端权威，前端无法伪造；
- `sessionId`：由前端以 URL 路径参数传入，标识一次对话会话。

它们在 `ChatController` 入口处一次性确定，之后需要下沉到：

1. 各个 Agent 的；
2. 各个工具方法（做数据权限校验）；
3. 各个 Hook（会话持久化、进度推送、活跃 Agent 记录、用户隔离等）。

难点在于**整条执行链是响应式（Reactor）异步的**：Web 请求线程只负责组装与订阅，真正的 Agent 推理、工具执行、模型流式回调分散在 `boundedElastic` 线程池以及 DashScope SDK 自建的 HTTP 回调线程上。传统的 `ThreadLocal` 在这种拓扑下完全不可用。

于是我们采用contextWrite方式来写入sessionId和userId

```text
agent.call(inputMessages)
.contextWrite(Context.of("sessionId", sessionId, "userId", userId));
```

这就是利用Reactor Context 来做参数传递。

Reactor Context 的原理

在响应式编程（如 Project Reactor）中，**Reactor Context** 是一个在操作符之间传播的键值对存储（Key/Value Store）。它通常被用来传递与业务数据流正交的上下文信息，例如链路追踪（Tracing）数据或安全令牌（Security Tokens）。它有以下几个特点：

**Context 绑定在「订阅」上，不绑定在「线程」上。**

这是它区别于 ThreadLocal 的根本。一次 `subscribe()`  产生一个订阅（Subscription），该订阅持有一份 Context。无论执行过程中经历多少次 publishOn / subscribeOn 线程切换，Context 都跟着订阅走，不会丢。

**Context 不可变（immutable）。**

Context.of(...)、context.put(...) 都返回新实例。这保证了并发订阅之间天然隔离——两个用户的请求各自持有独立 Context，不存在互相污染的可能。

**数据向下流，Context 向上流。**

在 Reactor 的流水线中，同时存在两个相反的方向：

- **数据流（Data Flow）**：从上游流向下游。就像工厂里的原材料，从第一道工序开始，一步步往下游传递，最后变成成品。
- **控制流（Control Flow）**：从下游流向上游。就像工厂的“开工指令”或“需求单”。只有当最下游的消费者（Subscriber）说“我需要数据”时，这个请求才会逆着流水线，一层层往上游传递，告诉上游“可以开始生产了”。

**Context 就是跟着这个“控制流”一起，从下游往上游传递的。**

在写代码时，这个机制体现为：写入 Context 的操作（`contextWrite`），必须放在读取操作（`deferContextual`）的下面（即更靠近下游的位置）。

```
Mono.just("Hello")
    // 1. 上游：读取 Context
    .flatMap(word -> Mono.deferContextual(ctx -> 
        Mono.just(word + ", " + ctx.get("user"))
    ))
    // 2. 下游：写入 Context（必须放在读取操作的下方）
    .contextWrite(ctx -> ctx.put("user", "Alice"));
```

**`contextWrite`**** 作用于「上游」。**

```java
mono.contextWrite(Context.of("userId", "u_001"))
```

它拦截向上传递的订阅信号，把 Context 修改后再继续往上游传。所以 contextWrite 影响的是**它之前（上游）** 的所有算子，而不是它之后的。

当最下游的 `subscribe()` 触发时，订阅信号会**逆流而上**。它会先经过 `contextWrite`，把 "userid" 写入 Context，然后继续往上走到 `deferContextual`，此时上游的操作符就能读到这个 Context 了。

**多个 ****`contextWrite`**** 时，越靠近数据源的越后生效（内层覆盖外层）。**

```java
Mono<Msg> m = agent.call(msgs)
        .contextWrite(Context.of("k", "A"));   // 内层，靠近数据源

m.contextWrite(Context.of("k", "B"))            // 外层，靠近 subscribe
 .subscribe();
```

订阅信号从 `subscribe()` 出发，先经过外层（写入 `k=B`），再经过内层（覆盖为 `k=A`），最后到达 `agent.call()`。因此 Agent 执行期间读到的是 `k=A`。

写入和读取方式

Reactor Context的写入方式可以通过contextWrite进行：

```text
agent.call(inputMessages)
.contextWrite(Context.of("sessionId", sessionId, "userId", userId));
```

我们的代码中，有6 处 `contextWrite`

| 位置 | 场景 |
| --- | --- |
| `AgentPipelineService:155` | `executeFullPipeline`完整流水线 |
| `AgentPipelineService:268` | `executeFromIntentRecognition`从意图识别开始 |
| `AgentPipelineService:305` | `executeMasterAgentDirectly`直连主智能体 |
| `AgentPipelineService:592` | `dispatchSubAgentDirectly`高置信直跳子 Agent（已废弃） |
| `ChatAgentExecutor:148` | continuation 直连子 Agent（无 Pipeline 包裹） |
| `ChatAgentExecutor:258` | `resume`恢复 ask_user 暂停的 Agent |

在上面的方式写入之后，在需要读取对应参数的地方，按照以下方式即可读取，比如我们的各个Hook中：

```java
Mono.deferContextual(ctx -> {
    String userId = ctx.getOrDefault("userId", null);
    // ...
    return Mono.just(result);
})
```

如SessionPersistenceHook、AbstractShellApiKeyHook、BookingPersistenceHook等。

为什么能在「主智能体 ↔ 子智能体」之间传递

本项目的子智能体是以 `SubAgentTool` 形式注册到 MasterAgent 的 Toolkit 上的（见 `MasterAgent#build` 的 `toolkit.registration().subAgent(...)`）。

当 MasterAgent 决定调用 `itinerary_manage_agent` 时，框架的执行路径是：

![](assets/7adb4225a625.png)

这一整条链上没有任何一处裸 .subscribe() 或 .block()。 全是 flatMap / Flux.concat / mergeSequential / map / subscribeOn / timeout / retry——这些都只是算子，不开启新订阅。特别是 subscribeOn 只改变订阅信号在哪个线程上执行，不影响 Context。

所以 Context 能一路流到子 Agent。

为什么能在「智能体 ↔ Hook」之间传递

这一层取决于框架**在哪里订阅** `Hook#onEvent` 返回的 Mono。AgentScope 1.0.12 有两套截然不同的写法，必须区分对待。

**主链事件：可靠（****`flatMap`**** 组合）**

`ReActAgent#notifyHooks`（源码 L905-911）：

```java

private <T extends HookEvent> Mono<T> notifyHooks(T event) {
    Mono<T> result = Mono.just(event);
    for (Hook hook : getSortedHooks()) {
        result = result.flatMap(hook::onEvent);   // ← Hook 的 Mono 被组合进主链
    }
    return result;
}
```

Hook 返回的 Mono 通过 `flatMap` 挂在 Agent 的主执行链上，与主链共享同一次订阅。因此 Hook 内 `Mono.deferContextual` 读到的就是主链的 Context。

走这条路径的事件（**Context 可靠**）：

- `PreCallEvent` / `PostCallEvent`
- `PreReasoningEvent` / `PostReasoningEvent`
- `PreActingEvent` / `PostActingEvent`
- `PreSummaryEvent` / `PostSummaryEvent`

**流式 chunk 事件：不可靠（裸 ****`subscribe()`****）**

```java

// ReActAgent:487，位于 model.stream(...).doOnNext(...) 内部
notifyReasoningChunk(msg, context).subscribe();

// ReActAgent:580
toolkit.setInternalChunkCallback(
        (toolUse, chunk) -> notifyActingChunk(toolUse, chunk).subscribe());

// ReActAgent:770
notifySummaryChunk(streamedMessage, ctx, generateOptions).subscribe();
```

这三处是**裸订阅**。这时候它们开启的是全新订阅，Context 为 `Context.empty()`。

走这条路径的事件（**Context 必然为空**）：

- `ReasoningChunkEvent`
- `ActingChunkEvent`
- `SummaryChunkEvent`

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a758d4d51b14400010724fa
