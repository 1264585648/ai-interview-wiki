---
title: "✅AgentScope Java中ReactAgent的实现原理"
---

# ✅AgentScope Java中ReactAgent的实现原理

ReAct 的论文核心思想就一句话：**让 LLM 交替"思考(Reasoning)"和"行动(Acting)"，直到得出最终答案**。落到工程里要解决五个问题：

1. **怎么把 LLM 决定的工具调用真正执行掉**（reasoning → acting）
2. **怎么把工具结果再喂回 LLM**（acting → reasoning）
3. **什么时候停**（max_iters / 没有 tool_use / HITL stop / 完成）
4. **流式输出怎么保证既能展示给用户、又能在结束时拼成完整 Msg**
5. **任意一步暂停或崩溃后，下次能从中间状态恢复**

ReActAgent 的所有复杂度都是在回答这五个问题。

Builder装配

要了解ReActAgent的实现原理，需要从他的build方法讲起：

```java
public ReActAgent build() {
    Toolkit agentToolkit = this.toolkit.copy();        // ① 深拷贝，防 Agent 间互相污染

    if (enableMetaTool)               agentToolkit.registerMetaTool();
    if (enablePendingToolRecovery)    hooks.add(new PendingToolRecoveryHook());
    if (longTermMemory != null)       configureLongTermMemory(agentToolkit);
    if (!knowledgeBases.isEmpty())    configureRAG(agentToolkit);
    if (planNotebook != null)         configurePlan(agentToolkit);
    if (skillBox != null)             configureSkillBox(agentToolkit);

    return new ReActAgent(this, agentToolkit);
}
```

ReActAgent 自己**不持有工具**——所有工具都注册在 Toolkit 上，Agent 只是引用。**Toolkit 深拷贝**是关键。同一个 Toolkit 注册到多个 Agent 时，每个 Agent 拿到的是独立副本——这样 RAG/SkillBox 等子系统给 Agent A 注册的工具不会污染 Agent B。这是后面 RAG/SkillBox 能"自动注入工具"的安全前提。

**置顺序也有意为之**：

- LongTermMemory 优先，因为 STATIC_CONTROL 模式会装 StaticLongTermMemoryHook，要早于其他 hook 拿到 PreReasoningEvent；
- RAG 在 GENERIC 模式下也是装 GenericRAGHook，同样进 hooks 列表；AGENTIC 模式则注册 retrieve_knowledge 工具进 toolkit；
- SkillBox 注册 SkillHook 同时把 skills 当工具暴露；
- 它们都通过 **同一个**入口（toolkit + hook list）把能力插到 ReAct 主循环里——意味着所有"扩展能力"对主循环是**透明**的。

PendingToolRecoveryHook 在最早期注册（priority=10），所以 PreCallEvent 时它**第一个**跑，能在用户 hook 之前补救悬空的 ToolUse。

call()

AgentBase.call(List&lt;Msg&gt;) 是 final 的：

```java
public final Mono<Msg> call(List<Msg> msgs) {
    return Mono.using(
        this::acquireExecution,                          // ① 占执行权
        resource -> TracerRegistry.get().callAgent(
            this, msgs,
            () -> notifyPreCall(msgs)                    // ② PreCallEvent
                  .flatMap(this::doCall)                 // ③ 子类实现
                  .flatMap(this::notifyPostCall)         // ④ PostCallEvent
                  .onErrorResume(createErrorHandler(...))// ⑤ 兜底 handleInterrupt
        ),
        this::releaseExecution,                          // ⑥ 释放
        true);
}
```

这条链定义了 **所有 Agent** 的统一行为契约。ReActAgent.doCall 拿到的是 PreCall hook **可能修改后**的 input messages（hook 可以改写、可以注入新消息），返回的 Msg 又会被 PostCall hook 包一层（可以全局改写最终回答）。

核心逻辑在ReActAgent.doCall方法中实现。

doCall()

doCall进来之后，有四个分支：

```java
@Override
protected Mono<Msg> doCall(List<Msg> msgs) {
    Set<String> pendingIds = getPendingToolUseIds();

    if (pendingIds.isEmpty()) {                   // 分支 ①
        addToMemory(msgs);
        return executeIteration(0);
    }

    if (msgs == null || msgs.isEmpty()) {         // 分支 ②
        return acting(0);                        
    }

    List<ToolResultBlock> providedResults = ...;
    if (!providedResults.isEmpty()) {             // 分支 ③
        validateAndAddToolResults(msgs, pendingIds);
        return hasPendingToolUse() ? acting(0) : executeIteration(0);
    }

    throw new IllegalStateException(              // 分支 ④
        "Pending tool calls exist without results...");
}
```

- **分支 ①** 是最常见路径：memory 干净，把用户消息入 memory，从 iteration 0 开始 reasoning。
- **分支 ②** 是 HITL 恢复路径：用户上次暂停，这次空 call 进来 → 直接进 acting 把那批 pending ToolUse 跑掉。
- **分支 ③** 是用户主动注入 ToolResult 路径：典型场景是 ToolSuspendException 抛出后用户填表回填、或者用户想"伪造一个工具失败回复"让模型重新规划。validateAndAddToolResults 严格校验：ID 必须匹配 pending、不能重复、部分回填时不能夹带文本。
- **分支 ④** 兜底：进入这里说明 PendingToolRecoveryHook 被关掉而用户也没自己处理——直接报错而非"假装没看见"。

reasoning()

剥掉 reactor 噪音，逻辑大致是：

```java
private Mono<Msg> reasoning(int iter, boolean ignoreMaxIters) {
    if (!ignoreMaxIters && iter >= maxIters) return summarizing();

    ReasoningContext context = new ReasoningContext(getName());
    return checkInterruptedAsync()     
        // PreReasoning                     
        .then(notifyPreReasoningEvent(prepareMessages()))   
        .flatMapMany(event ->
            model.stream(event.getInputMessages(),
                         toolkit.getToolSchemas(),
                         options)
                 .concatMap(c -> checkInterruptedAsync().thenReturn(c)))  
        .doOnNext(chunk -> {                                
            List<Msg> chunkMsgs = context.processChunk(chunk);
            for (Msg m : chunkMsgs) notifyReasoningChunk(m, context).subscribe();
        })
        .then(Mono.defer(() -> Mono.justOrEmpty(context.buildFinalMessage())))
     
        .onErrorResume(InterruptedException.class, ...)     
        //  PostReasoning
        .flatMap(this::notifyPostReasoning)                 
        .flatMap(event -> {
            Msg msg = event.getReasoningMessage();
            // 先保存进 memory
            if (msg != null) memory.addMessage(msg);        
			// HITL stop
            if (event.isStopRequested())                    
                return Mono.just(msg.withGenerateReason(REASONING_STOP_REQUESTED));
			// gotoReasoning（重新思考）
            if (event.isGotoReasoningRequested()) {         
                event.getGotoReasoningMsgs().forEach(memory::addMessage);
				//    递归，且 ignoreMaxIters=true
                return reasoning(iter + 1, true);           
            }
			// 结束
            if (isFinished(msg)) return Mono.just(msg);     
			// 进入 acting
            return checkInterruptedAsync().then(acting(iter));  
        });
}
```

acting()

```java
private Mono<Msg> acting(int iter) {
    // 只针对需要做工具调用的执行，否则继续reasoning
    List<ToolUseBlock> pendingToolCalls = extractPendingToolCalls();   

    if (pendingToolCalls.isEmpty()) return executeIteration(iter + 1);

    toolkit.setInternalChunkCallback(                                  
        (toolUse, chunk) -> notifyActingChunk(toolUse, chunk).subscribe());
    
    // PreActing per-tool
    return notifyPreActingHooks(pendingToolCalls)      
        // 执行工具调用
        .flatMap(this::executeToolCalls)                               
        .flatMap(results -> {
            var success = results.stream().filter(e -> !e.getValue().isSuspended()).toList();
            var pending = results.stream().filter(e ->  e.getValue().isSuspended()).toList();

			... ... 

            return Flux.fromIterable(success)
                .concatMap(this::notifyPostActingHook)       
                .last()                                                
                .flatMap(event -> {
                    //  HITL stop on acting
                    if (event.isStopRequested())                       
                        return Mono.just(event.getToolResultMsg()
.withGenerateReason(ACTING_STOP_REQUESTED));
					
                    if (!pending.isEmpty())                            
                        return Mono.just(buildSuspendedMsg(pending));
					// 进入下一轮reasoning
                    return executeIteration(iter + 1);                 
                });
        });
}
```

迭代终止与 summarizing()

ReAct 循环靠以下条件之一终止：

- isFinished(msg) 为 true（reasoning 没产生任何 ToolUseBlock）→ 直接返回 reasoning msg；
- event.isStopRequested()（PostReasoning 或 PostActing 的 stopAgent）→ 返回携带 _STOP_REQUESTED 的 msg；
- 工具 throw ToolSuspendException → buildSuspendedMsg 返回 TOOL_SUSPENDED；
- iter >= maxIters → 进入 summarizing()；
- 中断 → 走 onErrorResume + handleInterrupt。

summarizing() 是**强制收尾**机制：

```text
protected Mono<Msg> summarizing() {
    List<Msg> messageList = prepareSummaryMessages();       // memory + 一条强制 USER 提示
    return notifyPreSummaryHook(messageList, opts)
        .flatMap(e -> streamAndAccumulateSummary(e.getInputMessages(), e.getEffectiveGenerateOptions())
            .flatMap(msg -> notifyPostSummaryHook(msg, opts)
                .map(post -> {
                    Msg finalMsg = post.getSummaryMessage()
                            .withGenerateReason(GenerateReason.MAX_ITERATIONS);
                    memory.addMessage(finalMsg);
                    return finalMsg;
                })))
        .onErrorResume(this::handleSummaryError);
}
```

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a06ca3051b14400019d0dfe
