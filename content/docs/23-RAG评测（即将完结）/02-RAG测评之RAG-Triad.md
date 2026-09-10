---
title: "✅RAG测评之RAG Triad"
---

# ✅RAG测评之RAG Triad

![image.png](assets/3a1acb317b3a.png)

前面说过了，RAG系统中三个要素，分别是**问题、答案以及检索资料**。所以，我们需要有一套方法论来针对问题和答案、问题和检索资料、检索资料和答案之间的组合做全面评估。

RAG Triad（RAG 三元组）是一套专门用于评估 RAG（检索增强生成）应用质量的核心方法论。（由TruLens提出）

它**不需要人工标注的标准答案（Ground-truth）**，而是通过分析 RAG 流程中三个最关键元素——**用户提问（Query）、检索到的上下文（Context）和模型生成的回答（Response）**——之间的两两关系，来对系统进行全方位的自动化体检。

![image.png](assets/eb32b978ba62.png)

根据评估对象的不同，可以分为以下三个核心的评估指标：

- 检索资料（Context）和用户问题（Query）——**上下文相关性（Context Relevance）**
- 模型生成的回答 (Response) 与 检索到的资料 (Context)——**忠实度 / 依据性（Faithfulness / Groundedness）**
- 模型生成的回答 (Response) 与 用户提问 (Query)——**答案相关性（Answer Relevance）**

上下文相关性（Context Relevance）

- **评估关系**：`检索到的材料 (Context)` 与 `用户提问 (Query)`
- **核心作用**：衡量检索器“找资料”的精准度。它检测召回的文档片段中，有多少是真正能支持回答用户问题的。
- **低分意味着**：检索器捞回了大量与问题无关的噪声内容。这些冗余信息不仅浪费计算资源，还可能干扰大模型，导致最终回答质量下降。

忠实度 / 依据性（Faithfulness / Groundedness）

- **评估关系**：`模型生成的回答 (Response)` 与 `检索到的材料 (Context)`
- **核心作用**：衡量大模型“写答案”的老实程度，即是否严格基于检索到的资料来作答。
- **低分意味着**：模型出现了“幻觉”（Hallucination）。即生成的回答中包含了一些检索资料中完全不存在，甚至与资料相矛盾的信息。

*注：在部分评估框架（如 TruLens）中称为 Groundedness，在 RAGAS 或 DeepEval 中常被称为 Faithfulness，两者本质相同。*

答案相关性（Answer Relevance）

- **评估关系**：`模型生成的回答 (Response)` 与 `用户提问 (Query)`
- **核心作用**：衡量最终回答是否准确、完整地解决了用户的原始诉求。
- **低分意味着**：答非所问。例如用户问了“A在哪里，它的首都是什么？”，模型只回答了“A在哪里”，虽然信息正确且基于上下文，但没有完整回答问题，得分就会较低。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a0c2311d31fed00017b4440
