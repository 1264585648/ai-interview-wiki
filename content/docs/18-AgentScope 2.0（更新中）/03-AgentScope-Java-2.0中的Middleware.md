---
title: "✅AgentScope Java 2.0中的Middleware"
---

# ✅AgentScope Java 2.0中的Middleware

**Middleware 是 AgentScope 2.0 的核心扩展机制**——它在 Agent 生命周期的 5 个关键切点上,以"洋葱式包裹"或"流水线变换"的方式,拦截、观察或改写 Agent 的行为,而不需要修改 ReActAgent / HarnessAgent 或 ChatModel 的代码。

它替换了 1.0 里的一整套 Hook(pre_reasoning_hook、pre_acting_hook、post_acting_hook ...)。1.0 的 Hook 只是"点式回调"——在某个时刻被喊一声，拿不到"下一层"，无法观察流式事件，也无法优雅地做"包裹 / 变换 / 短路 / 回退"。**Middleware 直接把 Reactor ****Flux&lt;AgentEvent&gt;**** 作为一等公民,让 Agent 生命周期变成一条可拦截的响应式管道。**

2.0 中 HarnessAgent 的沙箱管理、二层长期记忆、上下文压缩、工具结果外置、异步工具、@路径展开、消息 inbox、PlanMode、SubAgent 派发、OTel tracing……**全部都是通过内置 Middleware 拼装出来的**——用户自定义的 middleware 与它们走的是同一条通路。

有啥用

Middleware 是"横切关注点"的通用容器。以下是它的典型价值场景,分四类:

**观测类**——把 Agent 运行时行为暴露出去

- 全链路 tracing(OTel span 树:invoke_agent → chat → execute_tool)
- 计时、token 计数、成本统计
- 事件流录制/回放,便于回归测试

**改写类**——在不改核心代码前提下改变 Agent 行为

- 动态 system prompt(注入实时上下文、当前时间、用户偏好)
- 消息注入(把 workspace 状态、待办列表、被 @ 的文件展开到 messages)
- 模型/参数回退(主模型报错时切备用模型)
- Tool call 白名单/黑名单/参数改写

**治理类**——把 Agent 纳入企业级管控

- 限速、并发闸门、budget(最多几轮 ReAct、最多几次 model call)
- HITL(Human-in-the-loop):所有工具被拒时立即停机
- 敏感数据脱敏、审计日志
- 图关闭时的 GracefulShutdown 断点续跑

**工程类**——把复杂的"Agent Runtime 能力"抽成可插拔模块

- 二层长期记忆的 Flush / Consolidate
- 对话压缩(context overflow 前先总结)
- 工具大结果外置到 workspace + 占位符
- Sandbox 生命周期、Subagent 调度、Inbox 收信

**这一条是 2.0 最不同于 1.0 的地方**:内置能力和用户能力都用 middleware 表达,可插拔、可关闭、可替换。

怎么用

```text
import io.agentscope.core.ReActAgent;
import io.agentscope.core.middleware.MiddlewareBase;
import io.agentscope.core.tracing.OtelTracingMiddleware;
import java.util.List;

ReActAgent agent = ReActAgent.builder()
        .name("assistant")
        .sysPrompt("You are a helpful assistant.")
        .model(model)
        .toolkit(toolkit)
        .middlewares(List.of(
                new OtelTracingMiddleware(),
                new TimingMiddleware(),
                new RateLimitMiddleware(Duration.ofMillis(200))))
        .build();
```

Builder 上有两个入口(见 ReActAgent.java 第 4032/4043 行):

```text
public Builder middleware(MiddlewareBase middleware);       // 追加单个
public Builder middlewares(List<? extends MiddlewareBase>); // 批量装配
```

HarnessAgent.Builder 继承自 ReActAgent.Builder,同名方法也可用。HarnessAgent 会在 build() 内部先把用户自定义的 middleware 装上,再追加自己内置的 middleware。

实现原理

**顶层接口 ****MiddlewareBase**

io.agentscope.core.middleware.MiddlewareBase 一共 5 个方法,分成两个风格:

```text
public interface MiddlewareBase {

    // ── Onion 洋葱式(4 个,包裹执行) ──
    default Flux<AgentEvent> onAgent      (Agent, RuntimeContext, AgentInput,      Function<AgentInput, Flux<AgentEvent>>       next) { return next.apply(input); }
    default Flux<AgentEvent> onReasoning  (Agent, RuntimeContext, ReasoningInput,  Function<ReasoningInput, Flux<AgentEvent>>   next) { return next.apply(input); }
    default Flux<AgentEvent> onActing     (Agent, RuntimeContext, ActingInput,     Function<ActingInput, Flux<AgentEvent>>      next) { return next.apply(input); }
    default Flux<AgentEvent> onModelCall  (Agent, RuntimeContext, ModelCallInput,  Function<ModelCallInput, Flux<AgentEvent>>   next) { return next.apply(input); }

    // ── Transformer 变换式(1 个,串行接力) ──
    default Mono<String> onSystemPrompt(Agent, RuntimeContext, String currentPrompt) { return Mono.just(currentPrompt); }
}
```

| 位置 | 类型 | 说明 |
| --- | --- | --- |
| `onAgent` | Onion | 包裹一次完整的 reply 流程，覆盖其中所有 ReAct 轮次、工具执行与最终输出 |
| `onReasoning` | Onion | 包裹一轮 ReAct 中的推理步骤（输入组装 → 模型调用 → 流式解码） |
| `onActing` | Onion | 包裹一次工具调用的执行 |
| `onModelCall` | Onion | 包裹一次底层<br>`ChatModel`<br>API 调用，最贴近模型 |
| `onSystemPrompt` | Transformer | 在每次组装 system prompt 时触发；多个 middleware 串行接力，每一个把上一个的输出再做一次变换 |

类别上分为种，**Onion**（洋葱式）、**Transformer**（变换式）

**Onion(洋葱式)**

想象一颗洋葱,你要一层一层往里剥,才能碰到"洋葱心"(核心逻辑)。**每一层皮都能在"往里剥之前"和"剥完回来之后"做点事**。（就像AOP一样）

```text
     ┌─────── mw1 ────────┐
     │                    │
     │   ┌─── mw2 ────┐   │
     │   │            │   │
     │   │  ┌ core ┐  │   │
入 ──┼──►│  │ LLM  │  ├──►│──► 出
     │   │  └──────┘  │   │
     │   │            │   │
     │   └────────────┘   │
     │                    │
     └────────────────────┘
```

执行顺序:

mw1 前置代码 → mw2 前置代码 → core → mw2 后置代码 → mw1 后置代码

**关键特征**:每个 middleware 拿到一个 next 函数,自己决定**什么时候把控制权交给内层**——这就是"包裹"能力的来源。

```text
public Flux<AgentEvent> onModelCall(Agent a, RuntimeContext ctx, ModelCallInput in,Function<ModelCallInput, Flux<AgentEvent>> next) {
    // ↑ 注意这个 next,就是"内层"
    long start = System.nanoTime();          // ← 前置逻辑(剥皮前)
    return next.apply(in)                    // ← 调 next 才进入内层
            .doFinally(sig -> {              // ← 后置逻辑(剥完回来)
                System.out.println("耗时 " + (System.nanoTime() - start) + " ns");
            });
}
```

因为拿到了 next,你可以做很多事:

- **调用前改写输入**:next.apply(newInput)
- **完全不调**:相当于短路,不让 LLM 跑
- **调用后改写输出**:对返回的 Flux 做 map/flatMap
- **异常回退**:next.apply(in).onErrorResume(err -> next.apply(fallbackInput))

AgentScope 2.0 里 onAgent、onReasoning、onActing、onModelCall 这 4 个都是洋葱式,因为它们要"包裹一段执行"。

**Transformer(变换式)**

想象一条流水线,一个字符串从左走到右,**每一站接过上一站的产物,加工一下,再传给下一站**。**没有"内层",只有"上下站"**。

```text
              mw1                mw2                mw3
prompt ──► 加个"当前时间" ──► 加个"用户地址" ──► 加个"todo 列表" ──► final
```

执行顺序:

originalPrompt → mw1.transform() → mw2.transform() → mw3.transform() → final

**关键特征**:每个 middleware **只做一件事——接收 → 变换 → 返回**,拿不到 next,也没得"包裹"。

代码长这样:

```text
public Mono<String> onSystemPrompt(Agent a, RuntimeContext ctx, String currentPrompt) {
    // 注意签名:没有 next!只有当前值 + 返回新值
    return Mono.just(currentPrompt + "\n\n## Now\n" + Instant.now());
}
```

你能做的只有一件事:**基于输入返回一个新输出**。做不到:

- 短路(不能"不返回"——一定要返回 String)
- 环绕(没有 next,没法"调用前后夹逻辑")
- 观察流(输入是 String 不是 Flux)

AgentScope 2.0 里只有 onSystemPrompt 是这种,因为它就是"把 prompt 字符串多次改写"。

何时改哪个 hook

| 需求 | 推荐 hook | 理由 |
| --- | --- | --- |
| 整次 reply 前后打点、请求 ID 落 ctx | onAgent | 天然一次 reply 一次 |
| 想给每一轮 ReAct 都注入内容(比如当前 workspace 状态) | onReasoning | 每轮 reasoning 都会触发 |
| 想在 system prompt 里追加动态内容 | onSystemPrompt | Transformer 接力,天然可累加 |
| 拦模型调用做限速/重试/回退 | onModelCall | 最贴近 LLM,能替换<br>Model<br>实例 |
| 观察/拦截工具执行 | onActing | 只拦 agent 内部工具,external execution 不在此 hook |
| 记录 tracing span | onAgent<br>+<br>onModelCall<br>+<br>onActing | 参考<br>OtelTracingMiddleware |

- onActing **不覆盖** external execution(外部工具执行)——文档 note 明确说明。
- onSystemPrompt 是 Transformer 不是 Onion——你**拿不到 ****next**,只能返回一个 Mono&lt;String&gt;。
- Flux 的 doOnNext / doFinally 只观察不改写;要真的改写事件流用 map / flatMap。

HarnessAgent 内置 Middleware

| 内置 Middleware | Hook | 作用 | 开关 |
| --- | --- | --- | --- |
| SandboxLifecycleMiddleware | onAgent | 沙箱容器申请/释放/快照生命周期 | 有沙箱配置时自动 |
| AgentTraceMiddleware | onAgent | 全链路 tracing + 事件记录 | .agentTracingLog(true) |
| WorkspaceContextMiddleware | onReasoning | 把 workspace 状态渲染成 markdown 注入消息 | .disableWorkspaceContext() |
| AtPathExpansionMiddleware | onReasoning | 展开用户消息里的<br>@/path/to/file | .disableAtPathExpansion() |
| MemoryFlushMiddleware | onReasoning | 二层记忆 Layer1:daily ledger append | .disableMemoryHooks() |
| MemoryMaintenanceMiddleware | onReasoning | 二层记忆 Layer2:MEMORY.md consolidation | .disableMemoryHooks() |
| CompactionMiddleware | onReasoning | 对话压缩(阈值触发 summary) | .disableCompaction() |
| ToolResultEvictionMiddleware | onReasoning | 大工具结果外置到 workspace + 占位符 | .disableToolResultEviction() |
| InboxMiddleware | onReasoning | 从 MessageBus 拉待投递消息 | 有 messageBus 时自动 |
| SubagentsMiddleware/DynamicSubagentsMiddleware | onActing | 子 agent 注册/派发 | .disableSubagents() |
| AsyncToolMiddleware | onActing | 异步工具执行登记与超时 | 有 asyncToolTimeout 时自动 |
| PlanModeMiddleware | onAgent | PlanMode 只读设计阶段的生命周期 +&lt;system-reminder&gt;注入 | .planMode(true) |
| SkillCuratorMiddleware/SkillUsageMiddleware/HarnessSkillMiddleware | onReasoning/onSystemPrompt | Skill 匹配、注入、使用统计 | 与 skill 配置相关 |
| HarnessRuntimeMiddleware | onAgent | 把 harness runtime 注入 ctx | 默认开 |

示例

```text
package cn.hollis.llm.llmentor.agentscope2.demo;

import io.agentscope.core.agent.Agent;
import io.agentscope.core.agent.RuntimeContext;
import io.agentscope.core.event.AgentEvent;
import io.agentscope.core.middleware.MiddlewareBase;
import io.agentscope.core.middleware.ModelCallInput;
import io.agentscope.core.model.Model;
import io.agentscope.extensions.model.dashscope.DashScopeChatModel;
import io.agentscope.extensions.model.dashscope.formatter.DashScopeChatFormatter;
import io.agentscope.harness.agent.HarnessAgent;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Function;

public class MiddlewareDemo {

    /**
     * 1) 计时:onModelCall 拿到每次 LLM 调用耗时
     */
    static class Timing implements MiddlewareBase {
        @Override
        public Flux<AgentEvent> onModelCall(Agent a, RuntimeContext ctx, ModelCallInput in,
                                            Function<ModelCallInput, Flux<AgentEvent>> next) {
            long start = System.nanoTime();
            return next.apply(in).doFinally(sig ->
                    System.out.printf("[timing] %s %dms%n",
                            a.getName(), (System.nanoTime() - start) / 1_000_000));
        }
    }

    /**
     * 2) 限速:两次模型调用之间强制最小间隔
     */
    static class RateLimit implements MiddlewareBase {
        private final long minIntervalMs;
        private final AtomicLong lastCall = new AtomicLong(0);

        RateLimit(Duration d) {
            this.minIntervalMs = d.toMillis();
        }

        @Override
        public Flux<AgentEvent> onModelCall(Agent a, RuntimeContext ctx, ModelCallInput in,
                                            Function<ModelCallInput, Flux<AgentEvent>> next) {
            long now = System.currentTimeMillis();
            long wait = minIntervalMs - (now - lastCall.get());
            Mono<Void> delay = wait > 0
                    ? Mono.delay(Duration.ofMillis(wait)).then()
                    : Mono.empty();
            return delay.thenMany(next.apply(in))
                    .doOnSubscribe(s -> lastCall.set(System.currentTimeMillis()));
        }
    }

    /**
     * 3) 动态 system prompt:把当前时间注入
     */
    static class DynamicPrompt implements MiddlewareBase {
        @Override
        public Mono<String> onSystemPrompt(Agent a, RuntimeContext ctx, String current) {
            return Mono.just(current + "\n\n## Now\n" + java.time.Instant.now());
        }
    }

    public static void main(String[] args) {

        Model model = DashScopeChatModel.builder()
                .apiKey("sk-fa5d4336bd26444cad9982ab43543bf3")
                .modelName("qwen-plus")
                .stream(true)
                .formatter(new DashScopeChatFormatter())
                .build();

        HarnessAgent agent = HarnessAgent.builder()
                .name("assistant")
                .model(model)
                .middlewares(List.of(
                        new Timing(),
                        new RateLimit(Duration.ofMillis(300)),
                        new DynamicPrompt()))
                .build();

        agent.call("北京现在几点?").block();
    }
}
```

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a61b9793fb9180001d1c2b0
