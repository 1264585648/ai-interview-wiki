---
title: "✅AgentScope Java进阶：Plan-and-Execute"
---

# ✅AgentScope Java进阶：Plan-and-Execute

经典的 plan-and-execute 范式有两种：

**双 Agent 模型**（LangGraph）：Planner 跑一次出 plan → Executor 逐步执行 → 完不成再回 Planner 重规划。优点是职责清晰，缺点是状态在两个 Agent 之间穿梭、prompt 上下文冗长。

**单 Agent 自驱模型**（ASJ）：同一个 ReActAgent 既能调"规划工具"又能调"执行工具"——LLM 自己决定什么时候建计划、什么时候推进、什么时候改、什么时候收尾。框架只做两件事：

- 把"plan 是什么、当前进度、下一步该做什么"以 &lt;system-hint&gt; 形式塞进每一轮的输入消息；
- 提供一组安全的、有状态校验的工具让 LLM 操作 plan。

ASJ 选了后者。代价是 prompt 工程要更精细（hint 必须根据状态动态生成），收益是**统一了 ReAct 主循环——没有任何特殊"plan 阶段"和"execute 阶段"，所有动作都还是 reasoning↔acting**。

在ASJ中，Plan-and-Execute最简单的用法只有一行：

```text
ReActAgent agent = ReActAgent.builder()
    .name("Assistant").model(model).toolkit(toolkit)
    .enablePlan() 
    .build();
```

复杂一点的话，可以自定义一些配置：

```text
PlanNotebook nb = PlanNotebook.builder()
    .planToHint(new DefaultPlanToHint())// 默认；可换成你自己的 prompt 模板
    .storage(new InMemoryPlanStorage())  // 默认；生产可换 DB 实现
    .maxSubtasks(10)   // null=不限
    .needUserConfirm(true)  / 默认 true：plan 创建后必须等用户说"go"
    .keyPrefix("mainPlan")    // 同 session 内多个 PlanNotebook 共存
    .build();

ReActAgent agent = ReActAgent.builder().planNotebook(nb).build();
```

build() 的运行，最终会走到 configurePlan(agentToolkit)：

```text
private void configurePlan(Toolkit agentToolkit) {
    // ① 注册10个工具
    agentToolkit.registerTool(planNotebook);   
    Hook planHintHook = new Hook() {
        public <T extends HookEvent> Mono<T> onEvent(T event) {
            if (event instanceof PreReasoningEvent e) {
                // ② 每轮 reasoning 前生成 hint
                return planNotebook.getCurrentHint() 
                    .map(hintMsg -> {
                        List<Msg> modified = new ArrayList<>(e.getInputMessages());
                        //追加到 input 末尾
                        modified.add(hintMsg);              
                        e.setInputMessages(modified);
                        return (T) e;
                    })
                    .defaultIfEmpty(event);
            }
            return Mono.just(event);
        }
    };
    hooks.add(planHintHook);
}
```

上面提到10个工具（定义在PlanNoteBook中），按照职责可以分为四组：

Plan**生命周期组（4 个）**

| 工具 | 作用 |
| --- | --- |
| create_plan(name, description,expected_outcome, subtasks) | 创建新 plan |
| finish_plan(state, outcome) | 完成或放弃 plan |
| view_historical_plans() | 列出历史 plans |
| recover_historical_plan(plan_id) | 恢复历史 plan |

**结构修改组（2 个）**

| 工具 | 作用 |
| --- | --- |
| update_plan_info(name?, description?, expected_outcome?) | 改 plan 元数据，三个字段可选 |
| revise_current_plan(subtask_idx, action, subtask) | 通过添加、修改或删除子任务来修订当前计划 |

**子任务执行组（3 个）**

| 工具 | 作用 |
| --- | --- |
| update_subtask_state(idx, state) | 状态机推进 |
| finish_subtask(idx, outcome) | 完成子任务 |
| view_subtasks(indexes) | 查看子任务详情 |

**状态查询组（1 个）**

| 工具 | 作用 |
| --- | --- |
| get_subtask_count() | 返回 total/done/in_progress/todo/abandoned 五元统计 |

工具注册之后，会调用PlanNotebook.getCurrentHint() ，这个方法调 DefaultPlanToHint的generateHint(currentPlan, this)方法生成提示词。DefaultPlanToHint 根据**当前 plan 的状态**生成五种不同的 prompt：

- **NO_PLAN**：用户提了个问题，你判断要不要建计划——如果是简单问题直接答，复杂任务才 create_plan。
- **AT_THE_BEGINNING**：plan 刚建好，所有子任务 TODO——下一步把第 0 个子任务置 IN_PROGRESS 开干。
- **WHEN_A_SUBTASK_IN_PROGRESS**：有一个子任务正在执行——继续推进、用 finish_subtask 收尾、或必要时改 plan。
- **WHEN_NO_SUBTASK_IN_PROGRESS**：前几个完成了但当前没活跃——把下一个置 IN_PROGRESS。
- **AT_THE_END**：全部子任务结束——调 finish_plan 总结收尾。

prompt 末尾还会拼接 RULE_COMMON（语言一致性、用户可能直接改 plan、不要私自改 plan）和 RULE_WAIT_FOR_CONFIRMATION（如果 needUserConfirm=true）等"系统级规则"。

整段 hint 包在 &lt;system-hint&gt;...&lt;/system-hint&gt; 标签里，作为一条 USER 角色消息追加到 inputMessages 末尾。LLM 在每一轮 reasoning 都能看到plan 当前进展，从而做出与全局目标一致的决策——这就是单 Agent 模型省掉 Executor 的根因。

**是否持续追加？**

不会！因为configurePlan的流程是：

1. **每次 ReAct 循环推理前**，会调用 prepareMessages() 重新构建消息列表（`sysPrompt` + `memory.getMessages()`）
2. 然后触发 `PreReasoningEvent`，plan hint hook 在 event 的 `inputMessages` 末尾**临时追加**一条 hint 消息
3. 这个修改后的消息列表**只用于当次 LLM 调用**，不会写回 memory（**修改的是 event 的临时副本，不是 memory**）

Demo

```java
import io.agentscope.core.ReActAgent;
import io.agentscope.core.formatter.dashscope.DashScopeChatFormatter;
import io.agentscope.core.memory.InMemoryMemory;
import io.agentscope.core.message.*;
import io.agentscope.core.model.DashScopeChatModel;
import io.agentscope.core.plan.PlanNotebook;
import io.agentscope.core.tool.*;
import reactor.core.publisher.Mono;
import java.util.HashMap;
import java.util.Map;

public class PlanExecuteDemo {

    static Map<String, String> files = new HashMap<>();

    @Tool(name = "write_file", description = "Write content to a file")
    public Mono<String> write(@ToolParam(name = "name") String n,
                              @ToolParam(name = "content") String c) {
        files.put(n, c);
        return Mono.just("Saved " + n);
    }

    @Tool(name = "read_file", description = "Read content from a file")
    public Mono<String> read(@ToolParam(name = "name") String n) {
        return Mono.just(files.getOrDefault(n, "(not found)"));
    }

    @Tool(name = "calc", description = "Evaluate a simple math expression like 10*5")
    public Mono<String> calc(@ToolParam(name = "expr") String e) {
        String[] parts = e.split("\\*");
        return Mono.just(e + " = " + (Integer.parseInt(parts[0].trim())
                                    * Integer.parseInt(parts[1].trim())));
    }

    public static void main(String[] args) {
        Toolkit toolkit = new Toolkit();
        toolkit.registerTool(new PlanExecuteDemo());

        PlanNotebook nb = PlanNotebook.builder()
                .maxSubtasks(8)
                .needUserConfirm(false)        // demo 直接执行，不等 "yes"
                .build();

        nb.addChangeHook("log", (notebook, plan) -> {
            if (plan != null) {
                System.out.println("\n>>> Plan changed:\n" + plan.toMarkdown(false));
            }
        });

        ReActAgent agent = ReActAgent.builder()
                .name("Planner")
                .sysPrompt("You break down complex tasks into a plan and execute step by step.")
                .model(DashScopeChatModel.builder()
                        .apiKey(System.getenv("DASHSCOPE_API_KEY"))
                        .modelName("qwen-plus")
                        .stream(true)
                        .formatter(new DashScopeChatFormatter()).build())
                .toolkit(toolkit)
                .memory(new InMemoryMemory())
                .maxIters(50)
                .planNotebook(nb)
                .build();

        Msg user = Msg.builder().role(MsgRole.USER).content(TextBlock.builder().text(
            "Calculate 10*5, save the result to result.txt, then read it back to verify. " +
            "This is a multi-step task, please plan first."
        ).build()).build();

        Msg resp = agent.call(user).block();
        System.out.println("\nFinal: " + resp.getTextContent());
    }
}
```

输出结果：

```
>>> Plan changed:
# Calculate and Verify Result
**Description**: Calculate 10*5, save the result to result.txt, then read it back to verify the calculation was correct.
**Expected Outcome**: The file result.txt contains the value '50' and this value is confirmed when read back.
**State**: todo
**Created At**: 2026-06-26 00:34:21
## Subtasks
- [ ] Calculate 10*5
- [ ] Save result to result.txt
- [ ] Read result.txt


>>> Plan changed:
# Calculate and Verify Result
**Description**: Calculate 10*5, save the result to result.txt, then read it back to verify the calculation was correct.
**Expected Outcome**: The file result.txt contains the value '50' and this value is confirmed when read back.
**State**: todo
**Created At**: 2026-06-26 00:34:21
## Subtasks
- [ ] [WIP] Calculate 10*5
- [ ] Save result to result.txt
- [ ] Read result.txt


>>> Plan changed:
# Calculate and Verify Result
**Description**: Calculate 10*5, save the result to result.txt, then read it back to verify the calculation was correct.
**Expected Outcome**: The file result.txt contains the value '50' and this value is confirmed when read back.
**State**: todo
**Created At**: 2026-06-26 00:34:21
## Subtasks
- [x] Calculate 10*5
- [ ] [WIP] Save result to result.txt
- [ ] Read result.txt


>>> Plan changed:
# Calculate and Verify Result
**Description**: Calculate 10*5, save the result to result.txt, then read it back to verify the calculation was correct.
**Expected Outcome**: The file result.txt contains the value '50' and this value is confirmed when read back.
**State**: todo
**Created At**: 2026-06-26 00:34:21
## Subtasks
- [x] Calculate 10*5
- [x] Save result to result.txt
- [ ] [WIP] Read result.txt


>>> Plan changed:
# Calculate and Verify Result
**Description**: Calculate 10*5, save the result to result.txt, then read it back to verify the calculation was correct.
**Expected Outcome**: The file result.txt contains the value '50' and this value is confirmed when read back.
**State**: todo
**Created At**: 2026-06-26 00:34:21
## Subtasks
- [x] Calculate 10*5
- [x] Save result to result.txt
- [x] Read result.txt
```

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a06c87aa7c8ff0001bdf2f9
