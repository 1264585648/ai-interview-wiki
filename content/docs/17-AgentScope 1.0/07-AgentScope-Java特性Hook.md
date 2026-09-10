---
title: "✅AgentScope Java特性：Hook"
---

# ✅AgentScope Java特性：Hook

就像Spring AI Alibaba一样，ASJ中也提供了完善的Hook机制，Hook 是一个**事件拦截器链**，横跨 ReActAgent 的"推理-行动-总结"全生命周期。他可以说是ASJ的一个基石。很多功能都要基于这个Hook机制来实现。

Hook 机制就是一套**统一事件模型**，允许开发者在 Agent 执行的各个阶段插入自定义逻辑，用于监控、拦截和修改 Agent 行为。所有 Hook 通过实现 Hook 接口来接入系统。

Hook 系统自 2.0.0 起已被标记为 @Deprecated(forRemoval = true)，官方推荐迁移到 MiddlewareBase 中间件系统。但由于大量现有代码和扩展仍依赖 Hook，理解其工作原理仍然非常必要。

Hook机制介绍

**Hook**的接口定义如下：

```text
public interface Hook {
    <T extends HookEvent> Mono<T> onEvent(T event);
    default int priority() { return 100; }
}
```

- **onEvent**：唯一的事件处理入口。泛型 &lt;T extends HookEvent&gt; 意味着传入什么事件类型就返回什么类型——hook 可以**修改事件内容**但不能改变事件类型。返回 Mono&lt;T&gt; 支持异步操作
- **priority()**：数值越小越优先。框架按升序排列 hook，优先级相同则按注册顺序。官方建议分段：0-50 系统级（鉴权/安全）；51-100 高优（验证/预处理）；101-500 业务逻辑；501-1000 低优（日志/监控）。

**HookEvent**是所有Hook事件的基类。

```text
public abstract sealed class HookEvent
        permits PreCallEvent, PostCallEvent, ReasoningEvent, ActingEvent, SummaryEvent, ErrorEvent {

    private final HookEventType type;
    private final Agent agent;
    private final long timestamp;
}
```

- **sealed class**：限定了事件家族的全部成员，编译器能检查 switch 穷举性。你不能随便扩展新事件类型——这是刻意的封闭设计。
- **所有事件共享 ****Agent agent**：任何 hook 随时能拿到当前 Agent 实例（向上转型后访问 getAgentState()、getName()、toolkit 等）。

**HookEventType** 就是具体的事件枚举：

```text
public enum HookEventType {
    PRE_CALL,       // Agent 开始处理前
    POST_CALL,      // Agent 完成处理后
    PRE_REASONING,  // LLM 推理前
    POST_REASONING, // LLM 推理完成后
    REASONING_CHUNK,// 推理流式输出中
    PRE_ACTING,     // 工具执行前
    POST_ACTING,    // 工具执行完成后
    ACTING_CHUNK,   // 工具执行流式输出中
    PRE_SUMMARY,    // 总结生成前（达到最大迭代次数时）
    POST_SUMMARY,   // 总结生成完成后
    SUMMARY_CHUNK,  // 总结流式输出中
    ERROR           // 发生错误时
}
```

以上这些事件都会对应一个事件类，这些事件类都是HookEvent这个类的实现类。

| 事件类 | 时机 | 可修改？ | 关键 setter / 能力 |
| --- | --- | --- | --- |
| **PreCallEvent** | agent.call() 开始 | Yes | setInputMessages<br>setSystemMessage<br>appendSystemContent |
| **PostCallEvent** | agent.call() 结束 | Yes | setFinalMessage |
| **PreReasoningEvent** | 每轮推理前 | Yes | setInputMessages<br>setGenerateOptions<br>appendSystemContent |
| **PostReasoningEvent** | 推理完成 | Yes | setReasoningMessage<br>stopAgent()<br>gotoReasoning(msgs) |
| **ReasoningChunkEvent** | 流式 token 到达 | No | getIncrementalChunk()<br>getAccumulated() |
| **PreActingEvent** | 单个工具执行前 | Yes | setToolUse(ToolUseBlock) |
| **PostActingEvent** | 单个工具执行后 | Yes | setToolResult<br>stopAgent() |
| **ActingChunkEvent** | 工具流式输出 | No | getChunk() |
| **PreSummaryEvent** | 超 maxIters 进入总结前 | Yes | setInputMessages<br>setGenerateOptions |
| **PostSummaryEvent** | 总结完成 | Yes | setSummaryMessage |
| **SummaryChunkEvent** | 总结流式输出 | No | getIncrementalChunk()<br>getAccumulated() |
| **ErrorEvent** | 出错 | No | getError() |

- **PostReasoningEvent.stopAgent()** —— 调用后 Agent 立即返回当前消息，不执行工具。实现 **human-in-the-loop**：用户可以审查 LLM 打算调什么工具，确认后再 agent.call() 继续。
- **PostReasoningEvent.gotoReasoning(msgs)** —— 跳过 acting 阶段，直接回到下一轮 reasoning。典型用途：StructuredOutputHook 发现 LLM 输出格式不对，构造一条 hint 消息塞进去要求重试。内部有 ToolValidator.validateToolResultMatch 校验——如果原始推理里有 ToolUseBlock，你塞的 msgs 里必须包含对应的 ToolResult，否则抛异常。
- **PostActingEvent.stopAgent()** —— 类似 PostReasoning 的 stop，但触发在工具执行**之后**。适合"执行完了先让人看看结果再继续"的场景。

Hook的生命管理

AgentBase 是所有 Agent 的抽象基类，负责 Hook 的生命周期管理：

```text
public abstract class AgentBase implements StateModule, Agent {

    public AgentBase(String name, String description, boolean checkRunning, List<Hook> hooks) {
        this.agentId = UUID.randomUUID().toString();
        this.name = name;
        this.description = description;
        this.checkRunning = checkRunning;
        this.hooks = new CopyOnWriteArrayList<>(hooks != null ? hooks : List.of());
        this.hooks.addAll(systemHooks);
        sortHooks();
    }

    //获取注册的Hook列表
    protected List<Hook> getSortedHooks() {
        return hooks;
    }


    // 动态添加 Hook
    protected void addHook(Hook hook) { ... }

    // 动态移除 Hook
    protected void removeHook(Hook hook) { ... }

    // 静态方法注册全局 Hook（对所有后续创建的 Agent 生效）
    public static void addSystemHook(Hook hook) { ... }
    public static void removeSystemHook(Hook hook) { ... }

}
```

这里面的getSortedHooks，是后续Hook调度的关键方法。

Hook的调度

Hook的调度，主要在两个地方，一个是AgentBase中，一个是ReActAgent中。

在AgentBase中，主要负责PreCall / PostCall / Error的调度。在ReActAgent中，主要负责 Reasoning / Acting / Summary的调度。

AgentBase中的notifyPreCall：

```text
private Mono<List<Msg>> notifyPreCall(List<Msg> msgs) {
    PreCallEvent event = new PreCallEvent(this, msgs);
    Mono<PreCallEvent> result = Mono.just(event);
    for (Hook hook : getSortedHooks()) {
        result = result.flatMap(hook::onEvent);
    }
    return result.map(PreCallEvent::getInputMessages);
}
```

在call方法中可以看到以下调用过程：

```text
@Override
public final Mono<Msg> call(List<Msg> msgs) {
    return Mono.using(
            this::acquireExecution,
            resource ->
                    TracerRegistry.get()
                            .callAgent(
                                    this,
                                    msgs,
                                    () ->
                                            notifyPreCall(msgs)
                                                    .flatMap(this::doCall)
                                                    .flatMap(this::notifyPostCall)
                                                    .onErrorResume(
                                                            createErrorHandler(
                                                                    msgs.toArray(new Msg[0])))),
            this::releaseExecution,
            true);
}
```

在执行call的过程中（11-13行），他会先调用notifyPreCall、然后再执行doCall（call的核心逻辑），然后会再执行postPreCall。

调用hook的逻辑就是，获取所有的Hooks，然后逐一执行他的onEvent方法。这里面需要注意的是，这个过程其实是不会过滤事件的， 也就是说，所有的hook，不管和当前阶段是否有关，他都会调一把。

```text
for (Hook hook : getSortedHooks()) {
    result = result.flatMap(hook::onEvent);
}
```

ReActAgent中的notifyReasoningChunk

```text
    private Mono<Void> notifyReasoningChunk(Msg chunkMsg, ReasoningContext context) {
        ContentBlock content = chunkMsg.getFirstContentBlock();

        ContentBlock accumulatedContent = null;
        if (content instanceof TextBlock) {
            accumulatedContent = TextBlock.builder().text(context.getAccumulatedText()).build();
        } else if (content instanceof ThinkingBlock) {
            accumulatedContent =
                    ThinkingBlock.builder().thinking(context.getAccumulatedThinking()).build();
        } else if (content instanceof ToolUseBlock tub) {
            // Support streaming ToolUseBlock events
            ToolUseBlock accumulated = context.getAccumulatedToolCall(tub.getId());
            if (accumulated != null) {
                accumulatedContent = accumulated;
            } else {
                // If no accumulated data, use the current chunk directly
                accumulatedContent = tub;
            }
        }

        if (accumulatedContent != null) {
            Msg accumulated =
                    Msg.builder()
                            .id(chunkMsg.getId())
                            .name(chunkMsg.getName())
                            .role(chunkMsg.getRole())
                            .content(accumulatedContent)
                            .build();
            if (context.getChatUsage() != null) {
                accumulated
                        .getMetadata()
                        .put(MessageMetadataKeys.CHAT_USAGE, context.getChatUsage());
            }
            ReasoningChunkEvent event =
                    new ReasoningChunkEvent(
                            this, model.getModelName(), null, chunkMsg, accumulated);
            return Flux.fromIterable(getSortedHooks()).flatMap(hook -> hook.onEvent(event)).then();
        }

        return Mono.empty();
    }
```

把Hook注册到ReActAgent

想要把Hook注册到ReActAgent中也很简单，支持一次性注册多个Hook，也支持一次性注册单个Hook：

```
ReActAgent agent = ReActAgent.builder()
        .name("Assistant")
        .model(model)
        .toolkit(toolkit)
        .hooks(List.of(
                new LoggingHook(),
                new HighPriorityHook(),
                new PromptEnhancingHook()
        ))
        .build();
```

```
ReActAgent agent = ReActAgent.builder()
        .name("Assistant")
        .model(model)
        .toolkit(toolkit)
        .hook(new LoggingHook())
        .build();
```

内置Hook

在ASJ中，也有一些内置Hook可以直接用使用，或者说不是开发者使用，而是ASJ中的其他功能和机制依赖这些Hook实现。

**StreamingHook — 流式事件转发**

将 Agent 内部事件转换为 Event 对象并推送到 FluxSink，用于 AgentBase.stream() 方法的实现。它会拦截 PostReasoningEvent、ReasoningChunkEvent、PostActingEvent、ActingChunkEvent、PostSummaryEvent、SummaryChunkEvent，并根据 StreamOptions 的配置决定是否将事件发射出去。

**特点**：

- 由框架在调用 stream() 时自动创建和注册
- 调用结束后自动从 Hook 列表中移除
- 支持增量模式和累积模式

**StructuredOutputHook — 结构化输出控制**

确保模型在结构化输出模式下正确调用 generate_response 工具。

**工作流程**：

1. PreReasoningEvent：在 TOOL_CHOICE 模式下，强制设置 tool_choice 为 generate_response
2. PostReasoningEvent：检查模型是否调用了目标工具，如果没有则添加提醒消息并重新推理（最多重试 3 次）
3. PostActingEvent：当 generate_response 成功完成后，调用 stopAgent()
4. PostCallEvent：压缩记忆上下文，移除中间结构化输出相关消息

**SkillHook — 技能目录注入**

在 PreReasoningEvent 时将技能目录提示词注入到系统消息中。

```text
public class SkillHook implements Hook {
    public static final int SKILL_HOOK_PRIORITY = 85;

    @Override
    public <T extends HookEvent> Mono<T> onEvent(T event) {
        // Inject skill prompts
        if (event instanceof PreReasoningEvent preReasoningEvent) {
        
        }

        return Mono.just(event);
    }
}
```

这个是ASJ中Skill的实现重要Hook

**StaticLongTermMemoryHook — 静态长期记忆**

实现 STATIC_CONTROL 模式的长期记忆自动管理。

**工作流程**：

1. PreCallEvent：提取最后一条用户消息作为查询，从长期记忆中检索相关内容，将结果包装在 &lt;long_term_memory&gt; 标签中注入到消息列表末尾
2. PostCallEvent：将对话记录异步保存到长期记忆

这个是ASJ中长期记忆的实现重要Hook

**GenericRAGHook — 通用 RAG 检索**

在每次推理前自动从知识库检索相关知识并注入到提示中。

**工作流程**：

1. PreCallEvent：提取最后一条用户消息作为查询
2. 调用 knowledge.retrieve(query, config) 检索相关文档
3. 将检索结果格式化为 &lt;retrieved_knowledge&gt; 标签包裹的内容，作为用户消息追加到输入列表

这个是ASJ中RAG的实现重要Hook

自定义Hook

如果内置的Hook不满足诉求，可以自定义一个Hook，只需要实现Hook接口，然后把他注册到ReActAgent中就好了，如：

```text
import io.agentscope.core.hook.Hook;
import io.agentscope.core.hook.HookEvent;
import io.agentscope.core.hook.PreCallEvent;
import io.agentscope.core.hook.PostCallEvent;
import reactor.core.publisher.Mono;

public class LoggingHook implements Hook {

    @Override
    public <T extends HookEvent> Mono<T> onEvent(T event) {
        return switch (event) {
            case PreCallEvent e -> {
                System.out.println("[Hook] Agent " + e.getAgent().getName() + " starting...");
                yield Mono.just(event);
            }
            case PostCallEvent e -> {
                System.out.println("[Hook] Agent " + e.getAgent().getName() + " finished.");
                yield Mono.just(event);
            }
            default -> Mono.just(event);  // 其他事件直接透传
        };
    }
}
```

还可以通过设计优先级调整执行顺序：

```text
public class AuthHook implements Hook {
    @Override
    public int priority() {
        return 10;  // 高优先级，在其他 Hook 之前执行
    }

    @Override
    public <T extends HookEvent> Mono<T> onEvent(T event) {
        if (event instanceof PreActingEvent e) {
            // 在工具执行前注入认证信息
            ToolUseBlock toolUse = e.getToolUse();
            // 修改 toolUse ...
            e.setToolUse(toolUse);
        }
        return Mono.just(event);
    }
}
```

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a2bb13d3fb9180001a01149
