---
title: "✅常用的Agent开发框架"
---

# ✅常用的Agent开发框架

Agent开发不一定需要自己纯手撸（当然，我们后面会有很多章节介绍如何手撸，但是目的是让大家更好的理解），其实有很多成熟的框架可以用的。

Python常用的Agent框架

**LangChain&**LangGraph

LangChain是最流行的 LLM 应用开发框架之一，支持 Agent 构建、工具调用、记忆、链式推理等。

LangGraph 是 LangChain 团队推出的一个用于构建 状态化（stateful）、多参与者（multi-actor）、循环式（cyclic）智能体工作流 的库。它基于 有向图（Directed Graph） 模型，允许开发者以声明式方式定义复杂的 Agent 执行流程，特别适合需要规划、反思、协作或人类干预的高级应用场景。

在我们的文档中也有介绍：

LangChain/LangGraph中提供了很多Agent的实现，比如ReAct、Plan-and-Execute等等agent架构，可以开箱即用。

这里面有一些示例：[https://github.com/langchain-ai/langgraph/tree/main/examples](https://github.com/langchain-ai/langgraph/tree/main/examples)

**AutoGen**

支持多智能体协作，可定义多个具有不同角色和能力的 Agent 进行对话与任务协作。

**AutoGen 是由微软（Microsoft）开发的一个开源框架，一般用来简化构建多智能体（Multi-Agent）系统和复杂 LLM（大语言模型）工作流的过程。**它通过提供可组合、可对话的智能体（Agent）抽象，使得开发者能够轻松地创建能协作完成任务的 AI 系统。

下面也有介绍：

**CrewAI**

**CrewAI** 是一个专为构建 **多智能体（Multi-Agent）协作系统** 而设计的开源 Python 框架，其核心理念是：**通过角色驱动（Role-Driven）的方式，让多个具备不同技能和目标的 AI Agent 协同完成复杂任务**。

它受到 Microsoft **AutoGen** 的启发，但提供了更简洁、更高层次的 API，特别适合构建如“市场分析团队”、“内容创作流水线”、“软件开发小组”等场景。

- GitHub:<br>[https://github.com/joaomdmoura/crewAI](https://github.com/joaomdmoura/crewAI)
- 官网 & 文档:<br>[https://www.crewai.com/](https://www.crewai.com/)
- 示例库:<br>[https://github.com/joaomdmoura/crewAI-examples](https://github.com/joaomdmoura/crewAI-examples)

Java常用的Agent框架

LangChain4j&Spring AI

LangChain4j和Spring AI都没有直接提供Agent的支持，只是提供了Agent的基本能力，比如记忆、工具调用等等，需要自己通过底层的API来实现。

比如我们这门课中有几个手撸Agent的实现，就是通过Spring AI来做的。

Spring AI Alibaba

Spring AI Alibaba 提供了基于 `ReactAgent` 的生产级 Agent 实现。

可以直接构建一个agent，并通过Agent内置的模型、工具、记忆、钩子等功能实现一个智能体。

这部分在我们的课程中会重点介绍，详见：

AgentScope

AgentScope 和Spring AI Alibaba一样，也是阿里开源的。用于构建 LLM 驱动的应用程序。它提供了创建智能体所需的一切：ReAct 推理、工具调用、内存管理、多智能体协作等。

他也提供了Java版的支持：AgentScope-Java

[https://java.agentscope.io/zh/intro.html](https://java.agentscope.io/zh/intro.html)

他的功能比Spring AI Alibaba中的agent更强大一些，除了支持钩子、工具、记忆等等之外，还集成了长期记忆、多模态、结构化输出、MCP、RAG等等。是一个比较强大的生产级AI智能体构建工具。

这个东西刚出来没多久，本来在我的课程中还没有（因为我准备这个课的时候，他还没推出），但是现在还挺火的，也有很多落地应用了，我们会找个单独的章节介绍下他怎么用。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/698053d0d31fed0001072fea
