---
title: "✅初识LangChain4j"
---

# ✅初识LangChain4j

LangChain

LangChain是一个强大的开源框架，专门用于开发基于大语言模型(LLMs)的应用程序。它的主要目标是简化LLM应用程序的开发流程，提供了一套完整的工具和组件，使开发者能够更容易地构建复杂的AI应用。

LangChain 类似于数据库领域的 JDBC，通过统一接口连接不同 LLM（如 GPT-4、ChatGLM）与外部工具（数据库、API），实现“模型-数据-业务”的解耦。

![](assets/fe9e07bda0e4.png)

我们在使用LLM的时候，需要用到很多技术配合，比如提示词、记忆、外部存储（如RAG）等等，并且我们还会做一些链式调用、Agent开发等等， 这些都可以借助LangChain框架实现。

LangChain官方推出了Python版和JS版本的，在Python中使用起来非常方便，但是Java开发者使用并不是很方便，而LangChain4j就是一个Java版的LangChain框架。

LangChain4J

之前我们介绍过Spring AI，其实LangChain4J的作用和Spring AI差不多，就是让我们在Java代码中可以更方便的做大模型应用开发，更好的用上我们之前讲过的提示词工程、提示词模板、对话记忆、结构化输出，以及实现RAG、Agent、MCP等功能的。所以Spring AI中有的东西，LangChain4J也几乎都有的。

LangChain4j整体为开发者提供了两种层次的抽象接口：

1.低层次：提供了如下Basics（大模型、提示词模版、模型记忆等）和RAG（向量模型、向量数据库、文本载入分割工具）两类低层次接口，开发者从而能够灵活的实现这些接口并根据自己的需求进行组合，定制化自己的大模型应用。

2.高层次：为了让Java开发者可以更加关注业务逻辑而不是这些底层实现，LangChain4J提供了两个高层次的API：

- Chains：包括Chains和AI Services两种类别，Chains源于Langchain，相当于将低层次模块组合起来，形成一些固定的处理流程，并协调它们之间的交互。
- AI Service：AI Services是LangChain4J为 Java 量身定制的解决方案，和Spring Data JPA类似，只需要显示的定义接口，并且可以自定义的加入Memory、Tools或者RAG，具体调用逻辑实现由LangChain4j代理完成。

![](assets/ec8fecdd46e4.png)

接入LangChain4J

首先我们需要引入langchain4j的依赖，主要包括两个，一个是langchain4j的核心包依赖，还有一个是langchain4j-open-ai-spring-boot-starter，这是一个langchain4j的starter，这里面初始化了一些bean的定义。

```text
<dependency>
    <groupId>dev.langchain4j</groupId>
    <artifactId>langchain4j</artifactId>
    <version>1.8.0</version>
</dependency>

<dependency>
    <groupId>dev.langchain4j</groupId>
    <artifactId>langchain4j-open-ai-spring-boot-starter</artifactId>
    <version>1.8.0-beta15</version>
</dependency>
```

接着，增加一些变量的配置，在applicaiton.properties文件中：

```text
langchain4j.open-ai.chat-model.api-key={YOUR_KEY}
langchain4j.open-ai.chat-model.model-name=qwen-max-latest
langchain4j.open-ai.chat-model.base-url=https://dashscope.aliyuncs.com/compatible-mode/v1
langchain4j.open-ai.chat-model.log-requests=true
langchain4j.open-ai.chat-model.log-responses=true
```

log-requests=true和log-responses=true，是用于日志打印的，开启他，方便查看和模型交互的提示词和响应。

接着，就可以在代码中使用langchain做AI的调用了，如：

```text
@RestController
@RequestMapping("/langchain")
public class LangChainController {

    @Autowired
    OpenAiChatModel chatModel;

    @RequestMapping("/hello")
    public String hello() {
        return chatModel.chat("你好,你是谁？");
    }
}
```

这里我们注入一个OpenAiChatModel，然后直接调用他的chat方法，传入用户提示词即可对话。大模型的回复如下：

![](assets/185ec0c60c88.png)

这个OpenAiChatModel就是在langchain4j-open-ai-spring-boot-starter中定义的，会自动读取`langchain4j.open-ai` 的相关配置。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/697dbdae74e403000124818a
