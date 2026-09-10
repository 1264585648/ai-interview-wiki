---
title: "✅Workflow VS Agent"
---

# ✅Workflow VS Agent

很多人都会拿Workflow和Agent对比，因为他们的目的是一样的，就是借助AI的能力来实现特定的功能，同时需要赋予AI使用工具、记忆等能力。

**那他们有什么区别呢？**

这里众说纷纭，我比较认可Anthropic在 《Building Effective Agents》 中给出的说法：

"Agent" can be defined in several ways. Some customers define agents as fully autonomous systems that operate independently over extended periods, using various tools to accomplish complex tasks. Others use the term to describe more prescriptive implementations that follow predefined workflows. At Anthropic, we categorize all these variations as agentic systems, but draw an important architectural distinction between workflows and agents:Workflows are systems where LLMs and tools are orchestrated through predefined code paths.Agents, on the other hand, are systems where LLMs dynamically direct their own processes and tool usage, maintaining control over how they accomplish tasks.

他们的主要说法是，Workflow 是确定性的、可预测的，适合结构化任务；Agent 是自主的、适应性的，适合开放性任务。虽然技术实现不同，但Workflow和Agent都属于更广义的 Agentic Systems（智能体系统） —— 即“利用 LLM 的推理能力来完成多步骤任务”的系统。

还记得前面我们介绍Agent的时候提到过，基于系统的控制方式，可以将Agent分为两类：Workflow Agent / 编排型智能体、Autonomous Agent / 自主型智能体。

|  | **Workflow Agent（编排型）** | **Autonomous Agent（自主型）** |
| --- | --- | --- |
| **控制方式** | 预定义流程编排（显式流程） | LLM动态决策（隐式推理） |
| **路径确定性** | 高（可预测） | 低（可能发散） |
| **开发难度** | 中（需设计流程） | 高（需处理不确定性） |
| **可靠性** | 高（适合生产） | 中（可能“跑偏”） |
| **灵活性** | 有限（受限于流程） | 极高（可应对未知） |
| **典型框架** | **LangGraph、Dify、N8N、Spring AI Alibaba** | **AutoGen** |
| **是否需要人类干预** | 少（流程稳定） | 可能需要（防止失控） |

而这种编排型智能体，其实就是我们说的AI Workflow了。

**所以，不管是Workflow也好、Agent也好，都是实现智能体系统的一种方式，只不过一种是偏提前预定义好流程做编排的形式，一种是基于LLM做动态决策的形式。**

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69882cedd31fed00010e241a
