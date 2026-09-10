---
title: "✅Harness工程——行程规划的执行闭环"
---

# ✅Harness工程——行程规划的执行闭环

差旅行程规划看似只是"搜几趟航班 + 选家酒店"，但实际场景远比这复杂：去程与返程组合爆炸（10 去 × 4 酒店 × 10 返 = 400 方案），政策合规必须逐条核验，偏好打分带有强主观性，一次 plan 几乎不可能首轮全 pass——如果 Agent 只是"搜→生成→展示"，低质量甚至违规方案就会直达用户。

因此 gogo-agent 对 ItineraryPlanAgent 建立了一条**必走不可跳过的七步结构化流水线**：从搜索候选、到 LLM 偏好打分、到客观计算引擎组合排序、到委托子智能体五维审核、到根据审核报告判断是否修复、到修复后重跑（最多 2 轮）、再到最终输出 + 强制停止等待用户确认。整条闭环由提示词规则硬约束 + 代码级护栏联合保证——任何一步缺失都可能导致虚构方案、token 爆炸或用户无法感知进度。

这其实就是在做**执行闭环，**是Harness工程中非常重要的一环: 实现“规划-执行-观察-反思”的完整循环。系统会将复杂任务拆解为可验证的步骤，并在每一步观察结果，引导模型进行自我纠正，而不是让它“一锤子买卖”。

Plan Execute Relection

我们之前在Agent相关章节中，介绍过Plan-and-Execute以及Relection这两种Agent架构。在我们的gogo agent中，我们把他们做了个结合，用了一种**Plan-Execute-Reflect**架构。

关于这种架构，OpenSearch曾经定义过：[https://docs.opensearch.org/latest/ml-commons-plugin/agents-tools/agents/plan-execute-reflect/?spm=5176.28103460.0.0.96a02988aluIVV](https://docs.opensearch.org/latest/ml-commons-plugin/agents-tools/agents/plan-execute-reflect/?spm=5176.28103460.0.0.96a02988aluIVV)

Plan-Execute-Reflect Agent的工作分为三个阶段：

• **规划（Planning）** —— 规划器 LLM 利用可用工具生成初始的分步计划。

• **执行（Execution）** —— 使用对话代理和可用工具按顺序依次执行每个步骤。

• **重新评估（Re-evaluation）** —— 在执行每个步骤后，规划器 LLM 利用中间结果重新评估计划。LLM 可以根据新上下文动态调整计划，跳过、添加或更改步骤。

以上思想我们把他用在了我们的行程规划+审核过程中。**即我们的PlanAgent负责规划和执行，ReviewAgent（后来改成了工具编排）负责反思。**

![](assets/751ab4465bad.png)

这个执行的流程首先在提示词中就有所体现（itinerary-plan-agent-system.md）：

```text
**多目标方案 + 审核 + 修复闭环（必走，不可跳过）**，方案设计统一使用 `plan_itinerary` 工具（你先对候选打偏好分，工具算完客观分并合成排序）：
   1. **收集 candidates**：
      - **懒加载搜索技能（重要）**：搜索类 skill（如 `tuniu-cli`）必须**在本步骤开始时**才通过 `load_skill_through_path` 加载，**严禁**在最初查审批单/常驻地/偏好/政策那一批调用里提前加载。原因：技能正文加载后若长时间不用会被上下文折叠，等到真正搜索时说明已丢失，导致搜错命令或工具名。
      - 加载技能后**立即连续执行搜索命令**，中途不要插入 `create_plan`、子任务状态变更（`update_subtask_state`/`finish_subtask`）等与搜索无关的调用，确保技能说明在使用时仍在上下文内。
      - 使用搜索类 skill 搜去程/返程交通 + 酒店候选，整理为 `candidates = { transport_options: [...], hotel_options: [...] }`。**去程与返程交通都要放进 `transport_options` 同一个列表**，并务必正确填写每条的 `direction`（`outbound`=去程 / `return`=返程）与 `origin`/`destination`：去程 `origin`=出发地、`destination`=目的地；返程 `origin`=目的地、`destination`=出发地（工具依据 `direction` 拆分并配对返程，方向填反或缺失会导致返程交通无法正确生成）。每条交通/酒店都要有唯一 `id`（如 `T1`/`H1`）。
   2. **准备规划参数**：直接把以下字段作为 `plan_itinerary` 的独立参数传入：`origin`/`destination`/`departure_date`/`return_date`（来自审批单或上下文，日期为 `YYYY-MM-DD`）、`preferences`（描述用户偏好的自由文本，须来自 `retrieve_from_memory`，无则留空）、`policy`（`query_travel_policy` 透传的政策 JSON，无则留空）、`candidates`（上一步的候选 JSON）。三维权重（时间/价格/偏好）由后端固定，无需也无法传入。
   3. **偏好打分**：对 `candidates` 的**每一条交通、每一间酒店**结合 `preferences` 自由文本打 0–100 偏好分并写 1–3 条中文理由，组装成 `scores` JSON：`{ "transport_scores": { "T1": {"score": 40, "basis": ["..."]}, ... }, "hotel_scores": { "H1": {"score": 70, "basis": ["..."]}, ... } }`，key 必须与 `candidates` 里的 id 完全一致。**偏好分只能依据 `retrieve_from_memory` 的真实偏好，不得编造。** 打分心法（示例，非硬规则，按 `preferences` 灵活判断）：
      - 舱位/座位：命中用户偏好舱位（如“商务座/头等舱”）给高分，越接近越高；明显低于偏好（如二等座）给低分。
      - 舒适度、直飞/直达、可退改、时段（早/中/晚出发）、品牌、离目的地距离、含早餐等，都按 `preferences` 文本权重折算进这一个分数里。
      - 交通与酒店分开独立打分；`preferences` 为空时统一给中性分，`basis` 写“无偏好设置，使用中性分”。
   4. **一次性规划（工具）**：调用 `plan_itinerary`，传入上面的 `origin`/`destination`/`departure_date`/`return_date`/`candidates`/`scores`（以及可选的 `preferences`/`policy`）。读工具返回的 `ok`/`result_file` 确认成功；若返回 `ok:false`，把 `error` 原样告知用户并停止。
   5. **批量审核**：调 `itinerary_review_agent` 子智能体，它会**自动读取上一步的规划结果并做五维审核**，返回审核报告（含每方案的 `overall_status`/`issues`/`suggestions` 与整体 `summary`、`best_proposal_id`）。
   6. **判断是否修复**：若 `summary.fail_count > 0` 或 `summary.warning_count > 0`，进入修复；否则进入规则 5。
   7. **修复（重跑，禁止 yy）**：修复方式是**按审核建议调整输入后重新调用 `plan_itinerary`**：从 `candidates` 中剔除导致失败的选项（如超预算酒店、超政策舱位），重新打分后重复第 2–5 步。最多 2 轮修复。**严禁跳过工具、直接在文案里虚构“修复版”方案——每一个“修复版”都必须是某次真实 `plan_itinerary` 重跑并经 `itinerary_review_agent` 审核后的结果。**
```

以上一共分了7个步骤。

**Step 1: 收集 candidates**——加载搜索技能（tuniu-cli），搜索去程/返程交通 + 酒店候选，整理为结构化 JSON。

**Step 2: 准备规划参数**——从审批单或上下文提取 origin/destination/departure_date/return_date，加上从长期记忆召回的 preferences 和 policy。

**Step 3: 偏好打分**——LLM 对每一条交通、每一间酒店打 0-100 偏好分并写中文理由，组装成 scores JSON。提示词约束"偏好分只能依据 retrieve_from_memory 的真实偏好，不得编造"。

**Step 4: 调用 plan_itinerary 工具**——将上述参数一次性传入客观计算引擎。该 Tool 在内存中完成去×住×返笛卡尔积、过滤非法组合（返程早于去程到达）、算总价/总耗时并 min-max 归一化、按 (去+住+返)/3 合成偏好分、按三维权重（时间 0.3 / 价格 0.2 / 偏好 0.5）算综合分，选出 4 类代表方案（时间最短 / 价格最低 / 最符合偏好 / 综合最佳），存入 Redis 后返回摘要。

**Step 5: 委托 itinerary_review_agent 做五维审核**——该子智能体自动读取上一步存入 Redis 的规划结果，进行完整性 / 时间合理性 / 出发目的地核实 / 预算合规性 / 路径合理性五维结构化审核，返回每方案的 overall_status / issues / suggestions 与整体 summary（含 fail_count、warning_count、best_proposal_id）。

**Step 6: 判断是否需要修复**——若 summary.fail_count > 0 或 summary.warning_count > 0，进入修复流程。

**Step 7: 修复（最多 2 轮）**——从 candidates 中剔除导致失败的选项（如超预算酒店、超政策舱位），重新打分后重复 Step 2-5。提示词的关键约束：

"最多 2 轮修复。**严禁跳过工具、直接在文案里虚构"修复版"方案——每一个"修复版"都必须是某次真实 plan_itinerary 重跑并经 itinerary_review_agent 审核后的结果。**"

这是针对 LLM "幻觉修复"问题的硬性防线：如果 LLM 发现方案有问题，它不能自己编一个"看起来正确"的版本，必须重新走工具链验证。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a6883a03fb9180001d7ec29
