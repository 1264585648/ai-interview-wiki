---
title: "✅AgentScope初探"
---

# ✅AgentScope初探

AgentScope 是由阿里巴巴团队开源的一个**以开发者为中心、高度灵活的多智能体（Multi-Agent）应用开发框架**。它的核心目标是帮助开发者更轻松地构建基于大语言模型（LLM）的分布式、高容错、多智能体应用。

**AgentScope Java **是一个面向智能体的编程框架，用于构建 LLM 驱动的应用程序。它提供了创建智能体所需的一切：ReAct 推理、工具调用、内存管理、多智能体协作等。

项目地址：[https://github.com/agentscope-ai/agentscope-java](https://github.com/agentscope-ai/agentscope-java)

和Spring AI Alibaba的关系

我们前面介绍过Spring AI Alibaba，它是基于Spring AI的扩展，在Spring AI之上，构建了Graph和Agent能力。提供了ReactAgent的实现。以 `ReactAgent` + `StateGraph` 为核心，提供 ReAct 推理循环、多智能体编排、Checkpoint 持久化、人机协同等生产级能力。

![image.png](assets/e284880ca365.png)

有了Spring ai alibaba 可以大大降低JAVA开发者开发Agent的门槛。Spring AI Alibaba 侧重智能体开发与 Spring 生态的无缝集成，以及阿里云基础大模型和其他开源能力的集成（例如 Qwen 大模型、Higress AI 网关、Nacos 等）。Spring AI Alibaba 的主要目标是向上游的 Spring AI 实现对齐。

同样的，AgentScope Java作为AgentScope的Java版，自然也定位于帮助JAVA开发者降低Agent开发的门槛，所以，基于React 的Agent他也有。但是不同意Spring AI Alibaba中的基于graph编排，AgentScope强调的是Agentic为核心。更适合于用来构建自主型Agent。

AgentScope 因为是阿里云自主研发的 Agent 开发框架，在路线规划、迭代速度、本地化服务上都会更加自主可控。

官方给出的建议是：如果您打算构建面向以 Agentic 为核心设计理念的AI应用，推荐使用 AgentScope-Java 版，如果您打算基于 Workflow 构建 AI 应用，推荐使用 Spring AI Alibaba。

![image.png](assets/5f8d8af3b76a.png)

用AgentScope Java开始Hello World

1、添加依赖

（AgentScope-Java 2.0会有比较大的改动，但是目前还是snapshot，我们先把1.0讲透，然后等他正式版出来之后再讲更新的内容）

**如果没有特殊说明，本章节讲解源码使用的版本均为1.0.12**

```text
<dependency>
    <groupId>io.agentscope</groupId>
    <artifactId>agentscope</artifactId>
    <version>1.0.12</version>
</dependency>

<dependency>
    <groupId>io.agentscope</groupId>
    <artifactId>agentscope-spring-boot-starter</artifactId>
    <version>1.0.12</version>
</dependency>
```

实现一个hello world代码

```text
package cn.hollis.llm.llmentor.agentscope;

import io.agentscope.core.ReActAgent;
import io.agentscope.core.message.Msg;
import io.agentscope.core.model.DashScopeChatModel;
import io.agentscope.core.tool.Tool;
import io.agentscope.core.tool.ToolParam;
import io.agentscope.core.tool.Toolkit;

/**
 * 本示例来自agent scope官网
 */
public class AgentScopeHelloWorld {

    public static void main(String[] args) {
        // 准备工具
        Toolkit toolkit = new Toolkit();
        toolkit.registerTool(new SimpleTools());

        // 创建智能体
        ReActAgent jarvis = ReActAgent.builder()
                .name("Jarvis")
                .sysPrompt("你是一个名为 Jarvis 的助手")
                .model(DashScopeChatModel.builder()
                        .apiKey("sk-0247a4b5f8854f4f9ff5fd284895ba9d")
                        .modelName("qwen3-max")
                        .build())
                .toolkit(toolkit)
                .build();

        // 发送消息
        Msg msg = Msg.builder()
                .textContent("你好！Jarvis，现在几点了？")
                .build();

        Msg response = jarvis.call(msg).block();
        System.out.println(response.getTextContent());
    }
}

// 工具类
class SimpleTools {
    @Tool(name = "get_time", description = "获取当前时间")
    public String getTime(
            @ToolParam(name = "zone", description = "时区，例如：北京") String zone) {
        return java.time.LocalDateTime.now()
                .format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
    }
}
```

相关API介绍：

| API | 说明 |
| --- | --- |
| Toolkit | 管理和封装各种工具（Tools/Functions），并将其注册给大模型，让模型知道“我能做什么”。 |
| ReActAgent | `ReActAgent` 是 AgentScope 中最经典、最常用的智能体实现类。它基于 **ReAct（Reasoning + Acting，推理与行动）** 范式构建。 |
| Msg | 封装对话中的每一条信息，明确“谁说的”以及“说了什么”。 |
| DashScopeChatModel | `DashScopeChatModel` 是 AgentScope-Java 中专门用来对接**阿里云百炼平台（DashScope）大模型**的核心组件。用于指定apikey、modelname等 |

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a06c03274e403000193d1fe
