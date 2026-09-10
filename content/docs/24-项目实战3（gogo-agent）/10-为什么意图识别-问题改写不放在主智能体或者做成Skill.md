---
title: "✅为什么意图识别/问题改写不放在主智能体或者做成Skill？"
---

# ✅为什么意图识别/问题改写不放在主智能体或者做成Skill？

在 GoGo 智能差旅助手中，意图识别（IntentRecognition）和问题改写（QueryRewriting）被设计为 **Agent 调用流水线的前置阶段**，由 `AgentPipelineService` 统一编排，而非放入 MasterAgent 的工具箱或封装为 Skill。

```text

用户消息
  │
  ├── L1/L2 快速意图识别（规则 + 向量，无 LLM）
  │     ├── 命中 → 跳过改写，直接调度
  │     └── 未命中 → QueryRewritingAgent → IntentRecognitionAgent(L1/L2/L3) → 调度
  │
  └── 调度决策：
        单意图 + 高置信 + 白名单 → 直跳子智能体（跳过 MasterAgent）
        否则 → MasterAgent 路由
```

这一设计并非随意为之，而是经过对行业做法的调研和自身场景特点权衡后的选择。

如果放在 MasterAgent 里会怎样

方案描述

将意图识别和问题改写作为 MasterAgent 推理循环的一部分——要么写在 System Prompt 的指令里让 LLM 自行完成，要么作为 MasterAgent 可调用的 Tool。

存在的问题

| 维度 | 问题 |
| --- | --- |
| **延迟** | 每次请求必须启动 MasterAgent 的 ReAct 循环（加载 context、发起 LLM 推理），即使是「查一下我的差旅单」这种一眼就能看出意图的问题。多耗 1-3 秒。 |
| **成本** | MasterAgent 的上下文窗口本身已经很贵（长期记忆 + 多轮历史 + 子智能体描述 + 工具列表），每次多做一轮 Reasoning 消耗大量输入 token。 |
| **短路不可能** | L1 关键词匹配 &lt;50ms、L2 向量检索 &lt;100ms 就能命中的请求，放进 MasterAgent 后无法短路，必须等完整 LLM 推理。 |
| **单意图直跳失效** | 意图识别结果是流水线做出「是否跳过 MasterAgent」的决策依据。如果意图识别本身在 MasterAgent 内部，就形成了逻辑循环——MasterAgent 无法跳过自己。 |
| **职责膨胀** | MasterAgent 本该聚焦「理解意图后如何路由与协调子智能体」，如果再承担「理解自然语言表达」的职责，System Prompt 变长、Reasoning 负担加重、准确率下降。 |
| **可观测性差** | 意图识别和问题改写是独立的可量化环节（命中率、延迟分布、改写质量），放入 MasterAgent 后混入大模型黑盒，无法单独度量和调优。 |

大多数行业主流框架无一将意图识别放入执行 Agent 内部，原因是**路由决策必须先于执行决策**。

如果做成 Skill 会怎样

将意图识别和问题改写封装为  Skill这样调用，我在最开始写这个项目的时候试过，虽然我知道这样做不行，但是我试了。

存在的问题

| 维度 | 问题 |
| --- | --- |
| **调用前提矛盾** | Skill 是被 Agent 在 ReAct 推理循环中「主动决策调用」的。但意图识别和改写恰恰发生在 Agent 启动之前——是它们的结果决定了「该启动哪个 Agent」。用 Skill 实现等于把「决定谁来干活」的权力交给了「干活的人」自己。 |
| **无法实现条件跳过** | 流水线的核心优化是：L1/L2 命中 → 跳过改写 → 跳过 MasterAgent。Skill 只能在 Agent 循环内被调用，无法影响「Agent 是否启动」这一更高层决策。 |
| **Token 膨胀** | Skill 的输出会回填到 Agent 的 Memory 中参与后续推理。如果意图识别和问题改写的skill被执行过，后续的每一次推理也会把内容都带给LLM，这和写到MasterAgent的提示词中是一样的。<br&gt;而且，意图识别的中间 JSON 对子智能体毫无意义，白白占用上下文窗口。 |
| **Skill被重复调用** | 在主智能体中，有意图识别、问题改写两个skill的话，主智能体通过reasoning决策该调那个，经常会出现一个skill重复调用或者干脆不调用的情况。 |

我们的方案

为了避免上面这些问题，我们的方案是既不把他放到MasterAgent中，也不作为一个skill，甚至不把他们单独搞成Agent（实际上最开始我做了个ReAct，后来干掉了）

这么做有很多好处，我们在后续的章节中逐一展开介绍。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a5a0e3e51b1440001ed91bc
