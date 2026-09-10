---
title: "✅虚拟线程+flash模型生成对话标题摘要"
---

# ✅虚拟线程+flash模型生成对话标题摘要

在知识库对话系统中，当用户发起新会话时，需要为会话生成一个简洁的标题以便后续识别和管理。由于标题生成依赖 LLM 调用，耗时较长（通常 500ms-2s），为了不阻塞主对话流程，采用**异步生成**策略。

同步流程（主线程）

```java

// 1. 生成临时标题（快速、本地计算）
String tempTitle = content.substring(0, Math.min(content.length(), 20));

// 2. 创建会话（DB 写入）
finalConversationId = chatConversationService.createConversation(userId, tempTitle);

// 3. 触发异步标题生成（不等待）
Thread.ofVirtual().name("title-summary-" + finalConversationId).start(() -> { ... });

// 4. 继续主流程：保存消息、启动流式对话
return knowEngineApplicationService.streamingChat(...);
```

**关键设计点**：

- 临时标题截取前 20 字符，保证用户可立即看到会话
- 异步任务启动后立即返回，不阻塞 SSE 流式响应

异步流程（虚拟线程）

```java

Thread.ofVirtual().name("title-summary-" + finalConversationId).start(() -> {
    try {
        // 1. 构建轻量级模型实例
        OpenAiChatModel titleChatModel = OpenAiChatModel.builder()
                .apiKey(chatModelApiKey)
                .modelName("qwen3.5-flash")          // 轻量级模型，快速响应
                .temperature(0.7)                     // 适度创造性
                .baseUrl(chatModelBaseUrl)
                .customParameters(Map.of("enable_thinking", false))  // 关闭思考链，加速响应
                .build();
        
        // 2. 创建 AI Service 代理
        TitleSummaryService titleSummaryService = AiServices.builder(TitleSummaryService.class)
                .chatModel(titleChatModel)
                .build();
        
        // 3. 调用 LLM 生成标题
        String aiTitle = titleSummaryService.generateTitle(content);
        
        // 4. 更新数据库
        chatConversationService.updateTitle(finalConversationId, aiTitle);
        
    } catch (Exception e) {
        // 5. 容错：失败时保留临时标题，不影响主流程
        log.warn("异步标题生成失败, 保留临时标题: conversationId={}", finalConversationId, e);
    }
});
```

TitleSummaryService 接口定义

```java

public interface TitleSummaryService {

    @SystemMessage("你是一个对话标题生成助手。根据用户的第一句话，生成一个简洁的中文会话标题，要求：不超过20个字，不加引号，直接输出标题内容。")
    @UserMessage("请根据以下用户问题生成会话标题：{{it}}")
    String generateTitle(String userQuestion);
}
```

**Prompt 设计说明**：

- `SystemMessage`：设定角色和约束条件（字数限制、格式要求）
- `UserMessage`：传入用户原始问题，`{{it}}` 为 LangChain4j 占位符
- 要求直接输出标题内容，避免模型返回多余解释

为什么选择虚拟线程？

| 方案 | 优点 | 缺点 | 适用场景 |
| --- | --- | --- | --- |
| **虚拟线程**<br>（当前方案） | 轻量、自动调度、代码简洁、无需线程池管理 | 需要 JDK 21+ | IO 密集型异步任务 |
| 平台线程 | 成熟稳定 | 资源占用高，大量任务时内存压力大 | 计算密集型任务 |
| @Async + 线程池 | Spring 集成好 | 需要配置线程池，代码侵入性稍高 | Spring 生态内统一异步管理 |
| CompletableFuture | 函数式编程，可组合 | 代码相对复杂 | 需要链式异步操作 |

为什么选择 qwen3.5-flash？

| 模型 | 响应速度 | 生成质量 | 成本 | 适用场景 |
| --- | --- | --- | --- | --- |
| **qwen3.5-flash** | 极快（&lt;1s） | 良好 | 低 | 简单摘要、标题生成 |
| qwen3.5 | 快（1-2s） | 优秀 | 中 | 通用对话 |
| qwen-max | 较慢（2-5s） | 最佳 | 高 | 复杂推理 |

**选择理由**：

1. 标题生成是简单任务，不需要复杂推理能力
2. flash 模型响应速度快，用户体验好
3. 成本低，适合高频调用场景
4. 关闭 `enable_thinking` 进一步加速响应

优化措施

1. **模型参数优化**：`enable_thinking=false` 关闭思考链，减少 token 消耗和响应时间
2. **temperature=0.7**：平衡创造性和确定性，避免过度发散
3. **独立模型实例**：异步流程单独构建轻量级模型，不影响主对话模型配置

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69de3a86d31fed000150f97d
