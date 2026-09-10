---
title: "✅为什么单独搞一个BookingAgent？"
---

# ✅为什么单独搞一个BookingAgent？

我们为什么要单独搞一个BookingAgent，直接把他和PlanAgent放一起不就行了么，反正都要调用tuniu cli。

一开始我确实是这么干的，但是后来我把他拆开了。

职责不同

**因为「规划」和「预订」是两种性质截然不同的操作**：规划是可反复试错、无副作用的「读+算」，预订是不可逆、有真金白银副作用的「写」。把有副作用、需要强前置门禁、需要最小权限的「下单」关进一个专职 Agent，本质是**用架构边界去承载安全边界**——而不是靠一个大提示词去约束一个「既能搜方案又能随手下单」的全能 Agent。

强制门禁需要独立提示词来死守

预订agent还有一条**不可绕过的红线**——必须先有审批通过的差旅单。这条规则写在 BookingAgent 专属的 system prompt 里，作为「核心前提」：

```text
审批检查（强制，不可跳过）：执行预订前，必须调用 query_travel_order(user_id, status="APPROVED")：
  - 若存在 APPROVED 订单：可执行预订。
  - 若不存在：直接拒绝预订，告知用户"差旅单尚未通过审批，无法执行预订..."，
    不得以任何理由绕过此检查。
防止重复预订：执行下单前，先调用 query_booking_record 检查是否已存在相同行程的预订记录。
```

这种「强前置校验 + 明确拒绝话术」的红线，只有在一个**任务单一、上下文纯净**的专职 Agent 里才守得住。如果把它塞进一个还要同时兼顾搜索、比价、审核、闲聊的巨型提示词里，规则会被大量其它指令稀释，模型遵守率显著下降。拆分让「预订必须先过审批」这条铁律，始终处在 Agent 注意力的最中心。

上下文干净

从用户的动线来看，大多数用户会在规划之后进行预定。如果用同一个智能体，规划阶段产生的**海量中间上下文**——多条候选航班/酒店的搜索原文、比价表、审核子 Agent 的往返报告、ItineraryPlannerTool 的排序明细——全部沉淀在规划 Agent 自己的 memory 里，那么虽然在预定时只关心选择的具体方案，但是历史的msg也需要全都给LLM传一遍。

如果拆分开，预订 Agent 每一轮的输入，只需要「用户确认的那个方案 + 审批单状态 + 下单结果」这么一小撮，干净~。

工具集与 Hook 各自定制，互不干扰

两个 Agent 装配的工具、Hook、记忆机制差异很大，各自围绕本职优化：

| 维度 | ItineraryPlanAgent（规划） | BookingAgent（预订） |
| --- | --- | --- |
| 核心工具 | ItineraryPlannerTool<br>（比价排序）、<br>destinationLiveTools<br>、天气/签证 MCP | BookingWriteTools<br>（cancel_booking）、<br>apiKeyTools |
| 特色机制 | PlanNotebook+PlanAwareThinkingHook、SearchResultCaptureHook<br>（任务清单+深度思考推进） | BookingPersistenceHook<br>（下单成功自动落库 + 推送支付事件） |
| 子智能体 | 挂了<br>itinerary_review_agent<br>（方案审核） | 无 |
| Shell 白名单 | 宽（含 curl/npm/node/rgh） | 窄（仅 tuniu 等 8 项） |
| maxIters | 30（要多轮搜比价审） | 10（下单步骤相对短） |

尤其 BookingPersistenceHook 是预订独有的关键横切能力——它在下单成功后自动把订单落库并给前端推支付事件，同时做「同平台+类型+外部单号已存在则不重复落库」的幂等。这类逻辑只对「写」有意义，挂在规划 Agent 上纯属噪音。**拆分让每个 Agent 的 Hook 链都精准、无冗余。**

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a5b4889a7c8ff00010e983a
