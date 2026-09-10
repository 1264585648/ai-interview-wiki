---
title: "✅Spring AI 2.0.0 更新了啥？"
---

# ✅Spring AI 2.0.0 更新了啥？

Spring AI 2.0.0 GA 于 2026 年 6 月 12 日正式发布，这是自 1.0 以来最大规模的一次版本升级（但是实际上，相比其他框架，比如agentscope-java还是挺落后的）。从底层 SDK 全面切换到官方实现，到 Tool Calling 架构的可组合式重构，再到 MCP 原生支持的落地——几乎每个核心模块都经历了重新设计。

Spring AI 1.x 在早期快速迭代阶段，采用了自研的 RestClient/WebClient 来对接各家 LLM 厂商的 API。这种做法在功能验证阶段是合理的，但随着 OpenAI、Anthropic 相继发布官方 Java SDK，继续维护自研的 HTTP 层带来了两个问题：一是 SDK 和 API 的 drift（官方新增的功能和参数，Spring AI 总是慢一拍）；二是社区需要同时维护两套序列化、重试、流式处理逻辑。

Spring AI 2.0 的核心设计目标就是**做薄**——在官方 SDK 之上充当适配层，把模型交互、重试、流式处理等关注点交还给 SDK 本身，Spring AI 专注于提供统一的抽象、Advisor 链、可观测性集成等框架层价值。

同时，这次升级也伴随着 Spring Boot 4 / Spring Framework 7 的基线要求，是一次彻底的架构清理。

底层 SDK 全面切换

**OpenAI：从自研 RestClient 到官方 openai-java**

OpenAI 在 2025 年发布了官方 Java SDK openai-java，覆盖了 Chat Completions、Embeddings、Image、Audio、Moderation 等全线能力。Spring AI 2.0 的 M5 milestone 完成了全面切换。

原来的 spring-ai-azure-openai（Azure OpenAI 独立模块）和 spring-ai-openai-sdk 被移除，统一合并到 spring-ai-openai。对于 Azure OpenAI 用户，依赖变更如下：

```text
<!-- BEFORE -->
<dependency>
    <groupId>org.springframework.ai</groupId>
    <artifactId>spring-ai-azure-openai</artifactId>
</dependency>

<!-- AFTER：Azure OpenAI 也使用同一个模块 -->
<dependency>
    <groupId>org.springframework.ai</groupId>
    <artifactId>spring-ai-openai</artifactId>
</dependency>
```

配置前缀从 spring.ai.azure-openai 变为 spring.ai.openai，其余配置项结构不变。框架层 Builder 模式和属性注入大体兼容，旧的 body 配置会自动映射到新的属性结构上。

另外，**Anthropic也切换到官方的anthropic-java，Minimax** 的独立支持被移除，需要通过 Anthropic 兼容接口（设置 baseUrl）来使用。**Vertex AI** 的非 Embedding 模块被移除。**ZhipuAI** 和 **OCI GenAI** 不再由 Spring AI 核心维护，OCI 迁到了 oracle/spring-cloud-oracle。

Tool Calling 的可组合式架构重构

1.x 的 Tool Calling 实现是「内置式」的：ChatModel.call() 内部直接管理工具调用循环（检测到 tool_call → 执行 → 回填结果 → 再次调用模型），这个循环对用户不透明。

2.0 把工具调用循环提升为 Advisor 链的一部分，由 ToolCallingAdvisor 统一管理。这带来两个好处：一是工具调用循环变成了可插拔、可观测、可定制的组件；二是它和 Chat Memory Advisor、RAG Advisor 等处于同一编排模型中，执行顺序通过 getOrder() 明确控制。

ChatClient 在检测到 prompt 中包含工具时，会自动注册 ToolCallingAdvisor。这意味着你不再需要手动配置工具执行循环。

旧的 Function Bean 方式依赖 Bean 名称匹配，在大规模项目中容易出错且缺乏类型安全。新的 ToolCallback 声明是显式的、自描述的，框架可以直接从 Bean 类型发现工具，不再做名称猜测：

```
// BEFORE：声明为 Function Bean，框架按 Bean 名称解析
@Bean
@Description("获取当前天气信息")
Function<WeatherRequest, WeatherResponse> currentWeather() {
    return request -> weatherService.getWeather(request.city());
}

// AFTER：显式声明为 ToolCallback Bean
@Bean
ToolCallback currentWeather() {
    return FunctionToolCallback.builder("currentWeather", weatherService::getWeather)
        .description("获取当前天气信息")
        .inputType(WeatherRequest.class)
        .build();
}
```

internalToolExecutionEnabled 的移除

1.x 中，ToolCallingChatOptions 有一个 internalToolExecutionEnabled 开关来控制模型内部是否自动执行工具（我们在做react的时候设置过这个参数）。2.0 中这个属性被完全移除——工具执行现在严格由 ToolCallingAdvisor 管理，或者由用户手动控制循环。

```text
// BEFORE：通过 options 控制内部工具执行
ChatResponse response = chatModel.call(prompt,
    OpenAiChatOptions.builder()
        .internalToolExecutionEnabled(true)  // 已移除
        .build());

// AFTER：工具执行由 ToolCallingAdvisor 自动管理

ToolCallingAdvisor advisor = ToolCallingAdvisor.builder()
    .toolExecutionEligibilityChecker(response -> {
        // 只有在模型没有返回 stop 信号，且确实有工具调用时才继续
        return response != null
            && response.hasToolCalls()
            && !"stop".equals(response.getResult()
                .getMetadata().getFinishReason());
    })
    .build();

String result = chatClient.prompt()
    .advisors(advisor)
    .tools(myTools)
    .user("查询并分析销售数据")
    .call()
    .content();
```

ChatClient 与 Options API 的变化

chatClient的Options 改成需要传 Builder 而非构建好的实例。

```text
// BEFORE：传入已 build 的 options
chatClient.prompt()
    .options(AnthropicChatOptions.builder().maxTokens(100).build())
    .user("Hello")
    .call();

// AFTER：传入 builder 本身，框架会在适当时机 build
chatClient.prompt()
    .options(AnthropicChatOptions.builder().maxTokens(100))
    .user("Hello")
    .call();
```

这样做的原因是框架需要在调用链内部对 options 做合并和覆盖操作（比如合并默认值和 prompt 级配置），传入 Builder 比传入不可变实例更灵活。

配置文件中，也为了更加扁平化，去掉了 .options 这一层级前缀：

```text
# BEFORE
spring.ai.openai.chat.options.model: gpt-4o
spring.ai.openai.embedding.options.model: text-embedding-3-small

# AFTER
spring.ai.openai.chat.model: gpt-4o
spring.ai.openai.embedding.model: text-embedding-3-small
```

还有就是，Spring AI 1.x 会强制设置 temperature=0.7 作为默认值。2.0 取消了这个行为，改为使用各 provider 的原生默认值（OpenAI 默认 1.0，Anthropic 默认 1.0）。如果你的业务对温度敏感，升级后需要显式设置。

Chat Memory的变化

ChatMemory.DEFAULT_CONVERSATION_ID 和 .conversationId() builder 方法被移除。这是一个正确的设计决策——在真实的多用户系统中，使用默认 ID 几乎总是错误的：

```text
// BEFORE：可以使用默认 conversation ID
chatClient.prompt()
    .user("Hello")
    .call();

// AFTER：必须在调用时传入 conversation ID
chatClient.prompt()
    .user("Hello")
    .advisors(a -> a.param(ChatMemory.CONVERSATION_ID, "session-abc-123"))
    .call()
    .content();
```

**PromptChatMemoryAdvisor 被移除**

PromptChatMemoryAdvisor 把对话历史注入 system prompt 中，这在长对话场景下容易超出上下文窗口限制。2.0 统一使用 MessageChatMemoryAdvisor，它以消息列表的形式维护对话历史，更贴合 Chat Completions API 的原生设计：

```text
ChatMemory chatMemory = new InMemoryChatMemory();

ChatClient chatClient = ChatClient.builder(chatModel)
    .defaultAdvisors(
        MessageChatMemoryAdvisor.builder(chatMemory).build()
    )
    .build();

String response = chatClient.prompt()
    .advisors(a -> a.param(ChatMemory.CONVERSATION_ID, "user-session-42"))
    .user("上次我们聊到哪里了？")
    .call()
    .content();
```

**DBC Chat Memory 的 schema 变更**

新增 sequence_id 列来保证消息排序的确定性（之前依赖插入顺序，在并发场景下不可靠）。升级时需要执行 schema 迁移。

MongoDB Chat Memory 修正了消息排序为时间正序（从旧到新），如果你的代码中有 Collections.reverse() 等 workaround，升级后需要移除。

MCP原生支持

Spring AI 2.0 将 MCP 的支持从外部社区仓库（org.springaicommunity.mcp）收编为核心模块，这意味着 MCP 注解、Transport 层、Server 端校验等都成为了框架一等公民。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a48bdecc71a8900016a66be
