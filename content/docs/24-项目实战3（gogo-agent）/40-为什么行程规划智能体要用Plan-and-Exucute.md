---
title: "✅为什么行程规划智能体要用Plan-and-Exucute？"
---

# ✅为什么行程规划智能体要用Plan-and-Exucute？

帮一个出差员工规划一趟"上海到杭州，周五去周日回"的行程，听起来简单。但拆开来看，Agent 至少要完成以下事情：查已审批的差旅单获取约束、召回用户历史偏好、查差旅政策拿到报销标准、搜索去程航班/高铁、搜索返程航班/高铁、搜索酒店、对候选做偏好打分、调用规划引擎做笛卡尔积组合排序、归一化打分、政策合规检查、选出代表方案、委托审核子智能体做五维校验、根据审核报告决定是否修复重跑、最终输出 Markdown 方案给用户确认——这是一条典型的**多步骤、有先后依赖、中间可能需要回退修复**的推理链。

纯 ReAct（Reasoning + Acting）

ReAct 的核心循环是：**想一步 → 做一步 → 观察结果 → 再想下一步**。它没有全局计划，每一步都是基于当前状态的局部最优决策。

```text
while not done:
    thought = LLM.reason(observation)
    action = LLM.decide(thought)
    observation = execute(action)
```

**优势**：灵活，适合探索性任务（"帮我查一下杭州天气"），因为不需要提前知道要做几步。

**劣势**：当任务有 10+ 步时，LLM 容易"走着走着忘了要干什么"——它没有一个持久化的任务清单来告诉自己"我已经做完了第 3 步，接下来该做第 4 步"。在行程规划场景下，具体表现为：

- 搜完去程机票后，忘记还要搜返程
- 调完 plan_itinerary 后，忘记还要委托审核
- 审核发现问题后，不知道该修复哪一步

纯规划

先让 LLM 一次性生成完整计划，然后按序机械执行每一步。

plan = LLM.plan(task) for step in plan: execute(step) # 不再推理，直接执行

**优势**：有全局视角，不会遗漏步骤。

**劣势**：太刚性。行程规划的现实是——搜索结果不确定（可能没有直飞航班）、审核可能不通过需要回退、用户可能中途追问。纯规划无法处理这些动态场景，因为执行阶段不做推理。

Plan-and-Execute（gogo-agent 的选择）

| 维度 | 纯 ReAct | 纯规划 | Plan-and-Execute |
| --- | --- | --- | --- |
| 全局视角 | 无，走一步看一步 | 有，但不可变 | 有，且可动态修订 |
| 执行灵活性 | 高 | 低（机械执行） | 高（子任务内仍是 ReAct） |
| 长任务可靠性 | 差（容易遗漏步骤） | 好（但无法应对意外） | 好（计划+回退能力） |
| 用户体验 | 黑盒（不知道做到哪） | 可以展示进度 | 可以展示进度+动态更新 |
| 推理开销 | 每步都思考（可能浪费） | 只规划时思考（执行不推理） | 按阶段动态调整（最经济） |
| 适合的任务类型 | 简单问答、信息查询 | 步骤完全确定的任务 | 复杂多步、需要回退修复的任务 |

Plan-and-Execute 取两者之长：**先制定计划，再逐步执行每个子任务，但每个子任务的执行仍然是 ReAct 式的推理-行动循环**。关键特性：

- 计划是**可变的**——执行过程中可以修改、回退
- 每个子任务的执行**保留推理能力**——不是机械执行
- 计划状态**显式持久化**——Agent 永远知道"我做到哪了"

```text
plan = LLM.plan(task)                    # 阶段一：规划（开启深度思考）
for subtask in plan:
    result = ReAct.execute(subtask)      # 阶段二：执行（关闭深度思考，快速调工具）
    if result.needs_revision:
        plan = LLM.revise(plan, result)  # 可以修订计划
summary = LLM.summarize(results)         # 阶段三：总结（重新开启深度思考）
```

gogo-agent 怎么实现的 Plan-and-Execute

**PlanNotebook：计划的"记事本"**

gogo-agent 基于 AgentScope 框架的 PlanNotebook 组件实现。PlanNotebook 本质上是一个**被注入到 Agent 工具列表里的状态机**——LLM 通过调用特定工具来管理计划：

```text
// ItineraryPlanAgent.java 核心代码
PlanNotebook planNotebook = PlanNotebook.builder()
        .needUserConfirm(false)   // 子任务推进无需用户确认
        .build();

// 注册变化钩子：计划状态变化时实时推送给前端
planNotebook.addChangeHook("plan_progress_notifier",
        (nb, plan) -> progressNotifierHook.sendPlanUpdate(capturedSessionId, plan));

// 把 PlanNotebook 挂载到 Agent
ReActAgent agent = ReActAgent.builder()
        .planNotebook(planNotebook)
        // ...
        .build();
```

PlanNotebook 向 LLM 暴露了这些工具：

| 工具名 | 作用 |
| --- | --- |
| create_plan | 创建一份新计划（含多个子任务） |
| update_subtask_state | 标记子任务为 TODO / IN_PROGRESS / DONE / ABANDONED |
| finish_subtask | 完成当前子任务 |
| revise_current_plan | 修订计划（增删改子任务） |
| finish_plan | 标记整个计划完成 |
| view_subtasks | 查看当前子任务列表和状态 |

这意味着 **LLM 自己决定什么时候建计划、什么时候推进、什么时候修订**——框架不强制，但提供了结构化的"记事本"让 LLM 管理自己的工作流。

**一次典型执行的时序**

结合系统 Prompt 的规则和代码，一次完整的行程规划执行流程如下：

```text
ItineraryPlanAgent 收到任务："规划上海到杭州出差"

[规划阶段 - 深度思考开启]
  LLM 调用 create_plan → 生成计划：
    1. 查询已审批差旅单获取约束条件
    2. 召回用户偏好 + 查询差旅政策  
    3. 搜索去程/返程交通 + 酒店候选
    4. 对候选打偏好分并调用 plan_itinerary 生成方案
    5. 委托审核子智能体做五维审核
    6. 根据审核结果决定是否修复
    7. 输出最终方案

[执行阶段 - 深度思考关闭，快速工具调用]
  子任务1: update_subtask_state(1, IN_PROGRESS)
           → 调用 query_travel_order(status="APPROVED")
           → finish_subtask(1)
  
  子任务2: update_subtask_state(2, IN_PROGRESS) 
           → 调用 retrieve_from_memory 召回偏好
           → 调用 query_travel_policy 查政策
           → finish_subtask(2)
  
  子任务3: update_subtask_state(3, IN_PROGRESS)
           → 调用 load_skill_through_path 加载搜索技能
           → 调用 execute_shell_command 搜机票
           → 调用 execute_shell_command 搜酒店
           → finish_subtask(3)
  
  子任务4: update_subtask_state(4, IN_PROGRESS)
           → LLM 对候选打偏好分（纯推理，无工具调用）
           → 调用 plan_itinerary（确定性计算引擎）
           → finish_subtask(4)
  
  子任务5: update_subtask_state(5, IN_PROGRESS)
           → 调用 itinerary_review_agent 子智能体
           → finish_subtask(5)
  
  子任务6: 审核发现方案2超预算
           → revise_current_plan 添加修复步骤
           → 重新调用 plan_itinerary + 审核
           → finish_subtask(6)
  
  子任务7: finish_plan → 输出 Markdown 方案

[总结阶段 - 深度思考重新开启]
  LLM 整合所有方案 + 审核结果 → 输出最终 Markdown
```

PlanAwareThinkingHook

这是 gogo-agent 最精巧的设计之一。核心逻辑只有一个判断：

```text
public class PlanAwareThinkingHook implements Hook {
    
    private final PlanNotebook planNotebook;
    private final int thinkingBudget;  // 2048 tokens

    @Override
    public <T extends HookEvent> Mono<T> onEvent(T event) {
        switch (event) {
            case PreReasoningEvent e -> handleReasoning(e);
            case PreSummaryEvent e -> enableThinking(e);  // 总结阶段开启
            default -> {}
        }
        return Mono.just(event);
    }

    private void handleReasoning(PreReasoningEvent event) {
        if (isPlanning()) {
            // 规划阶段：保持深度思考（默认行为，什么都不做）
        } else {
            // 执行阶段：关闭思考，快速执行
            disableThinking(event);
        }
    }

    // 判断逻辑极其简单：计划还没创建 = 还在规划阶段
    private boolean isPlanning() {
        return planNotebook.getCurrentPlan() == null;
    }
}
```

**为什么要这样做？**

- **规划阶段需要深度思考**：LLM 需要通盘考虑任务分解策略，这里的推理质量直接决定后续执行效果。开启 thinking（budget=2048）让模型"想清楚再动手"。
- **执行阶段不需要深度思考**：每`个子任务的动作相对明确（查个政策、搜个机票），此时思考是浪费——关闭 thinking 能节省 token 开销并加`快响应速度。
- **总结阶段重新开启**：最终要把多套方案、审核意见、修复历史整合成结构化 Markdown，需要综合推理能力。

这个设计的效果是：**用同一个模型（qwen3.7-max），通过动态调整推理深度，在规划质量和执行效率之间取得平衡**。

ItineraryPlannerTool：确定性计算引擎

审核-修复闭环：计划的动态修订

Plan-and-Execute 的真正威力在于**计划可以被修订**。当审核子智能体发现方案超预算：

```text
ItineraryReviewAgent 返回审核结果：
  - 方案2 ❌ 未通过：总价超预算，去程公务舱超政策标准

ItineraryPlanAgent 判断需要修复：
  → 调用 revise_current_plan：在计划中插入"修复步骤"
  → 从 candidates 中剔除违规选项
  → 重新打分
  → 重新调用 plan_itinerary
  → 重新审核
  → 最多2轮修复
```

如果是纯 ReAct，Agent 此时可能已经"忘了"前面做了什么——因为它没有显式的任务状态。如果是纯规划，它根本没有"修复"这条路径，因为计划是提前固定的。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a5a0c31d31fed0001c74227
