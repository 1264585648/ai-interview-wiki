---
title: "Langchain & LlamaIndex & LangGraph & AutoGen"
---

# Langchain & LlamaIndex & LangGraph & AutoGen

LangChain、LlamaIndex、AutoGen 和 LangGraph 都是当前构建 LLM 应用的主流python框架。

- **LlamaIndex**：专注“**如何让 LLM 高效读你的数据**”；
- **LangChain**：提供“**搭积木式 LLM 应用开发套件**”；
- **AutoGen**：实现“**多个 AI 角色像团队一样合作**”；
- **LangGraph**：解决“**复杂、带循环和分支的 LLM 流程怎么写**”。

典型适用场景

| **框架** | **一句话总结** | **最适合的场景** |
| --- | --- | --- |
| **LangChain** | “万能胶水”——快速拼接 LLM、工具、记忆 | - 快速搭建聊天机器人<br>- 调用外部工具（搜索、API）<br>- 简单 RAG 应用<br>- 教学/原型验证 |
| **LlamaIndex** | “数据专家”——让你的数据被 LLM 高效读懂 | - 构建企业知识库问答系统<br>- 处理 PDF/Word/数据库等私有数据<br>- 需要高性能、精准检索的 RAG<br>- 结构化数据（如 Pandas DataFrame）查询 |
| **AutoGen** | “AI 团队”——多个智能体自动分工合作 | - 自动编程（写+测+修）<br>- 多角色模拟（产品经理+工程师+测试）<br>- 自主任务分解与协作<br>- 需要 AI “团队”完成复杂目标 |
| **LangGraph** | “流程导演”——精确控制复杂、循环、可中断的 LLM 工作流 | - 需要人工审核介入的工作流（如：AI起草 → 人审核 → AI修改）<br>- 带循环的决策系统（如：反复调研 → 总结 → 验证）<br>- 可中断、可恢复的长流程<br>- 需要精确控制执行路径的复杂 Agent |

开发者如何选择？

1. **你的核心需求是“让 LLM 回答基于私有文档的问题”？**

- → **优先选 LlamaIndex**（RAG 性能和灵活性最佳）
- → 若需快速集成到现有 LangChain 项目，也可用 LangChain + LlamaIndex 组合

1. **你需要多个 AI 角色自动协作完成任务（如写代码、做研究）？**

- → **选 AutoGen**

1. **你的流程包含“循环、条件分支、人工干预点”？**

- → **选 LangGraph**（它是 LangChain 的“升级版工作流引擎”）

1. **你只是想快速做一个聊天机器人或简单工具调用？**

- → **选 LangChain**（生态最成熟，教程最多）

1. **你不确定，想先试试？**

- → 从 **LangChain** 入手，它最通用；
- 若发现 RAG 效果不好 → 引入 **LlamaIndex**；
- 若需要多 AI 协作 → 引入 **AutoGen**；
- 若流程太复杂无法用 Chain 表达 → 迁移到 **LangGraph**。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69664423d31fed0001f06d55
