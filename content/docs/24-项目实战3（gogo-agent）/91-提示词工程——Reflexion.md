---
title: "✅提示词工程——Reflexion"
---

# ✅提示词工程——Reflexion

我最开始再做行程规划智能体的时候，发现经常容易被 LLM"糊弄"过去。你让它规划"上海到杭州两天差旅"，它能写得漂漂亮亮：早班高铁、西湖畔的全季、晚班返程，看起来无懈可击。但真拿到线下去核，你会发现：

- 报价 ¥2560，超出公司差旅政策的 ¥2000 上限 28%——**它没查政策**
- 酒店在西湖景区，离阿里巴巴总部 18km，打车 40 分钟——**它没算路径**
- 商务座往返都排在早高峰，明明可以坐更便宜的车次——**它没做对比**

问题出在哪？不是 LLM 不够聪明，而是**它是一个"生成器"，不是一个"审阅者"**。生成一遍就交卷的模式下，任何一次幻觉、任何一处遗漏，都会直接进入最终答案。让同一个 LLM 边生成边自检？效果很差——**同一颗脑袋、同一段推理，很难发现自己的错**。

工程上更靠谱的做法是把"生成"和"评审"拆成两个独立角色，让 Agent 学会用另一双眼睛看自己的答案。这就是 Reflexion。

Reflexion 出自 Shinn 等人 2023 年论文《Reflexion: Language Agents with Verbal Reinforcement Learning》。原文提出一个三角色框架：

- **Actor**：执行任务、生成候选答案的 Agent
- **Evaluator**：对 Actor 的答案给出评分或反馈
- **Self-Reflection**：基于评分，用自然语言生成"反思笔记"，指导下一轮生成

Reflexion 的精髓在于不用改模型参数，只用自然语言反馈驱动 Agent 迭代。反馈可以来自：

- 另一个 LLM Agent（评审者）
- 环境返回值（工具执行结果、单元测试结果）
- 结构化规则（预算是否超标、日期是否合法）

gogo-agent 里的**行程规划闭环**是 Reflexion 的一个非常纯粹的工程落地。

Plan-Review-Fix 闭环

打开 itinerary-plan-agent-system.md 第 4 条规则，你会看到一整段闭环定义：

```text
4. 多目标方案 + 审核 + 修复闭环（必走，不可跳过）
   1. 收集 candidates
   2. 准备规划参数
   3. 偏好打分
   4. 一次性规划（工具）：调用 plan_itinerary
   5. 批量审核：调 itinerary_review_agent 子智能体
   6. 判断是否修复：若 fail_count > 0 或 warning_count > 0，进入修复
   7. 修复（重跑，禁止 yy）：按审核建议调整输入后重新调用 plan_itinerary
      最多 2 轮修复
```

这就是完整的 Reflexion 结构：

![](assets/337e7a9137ef.png)

三个角色都在 gogo-agent 的源码里有对应实体：

- **Actor** = ItineraryPlanAgent（itineraryPlanAgent，ReActAgent，maxIters=15，strongModelWithThinking）
- **Evaluator** = ItineraryReviewAgent（itineraryReviewAgent，ReActAgent，maxIters=8，stableModel glm-5.1）
- **Self-Reflection** = 由 Actor 在读到 Evaluator 报告后，在同一个 ReAct 循环内完成——本质就是"读反馈→调整参数→重跑工具"

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a68858551b1440001faaa13
