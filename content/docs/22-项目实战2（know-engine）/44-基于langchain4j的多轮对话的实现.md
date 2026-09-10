---
title: "✅基于langchain4j的多轮对话的实现"
---

# ✅基于langchain4j的多轮对话的实现

前面我们介绍过LangChain4J的持久化记忆的能力。基于langchain4j的能力，我们扩展一个自定义的DatabaseChatMemoryStore，采用 Redis 缓存 + MySQL 持久化 的两级架构：

```
// DatabaseChatMemoryStore.java
@Component
public class DatabaseChatMemoryStore implements ChatMemoryStore {

    private final ChatMessageService chatMessageService;
    private final StringRedisTemplate stringRedisTemplate;

    private static final String REDIS_KEY_PREFIX = "know-engine:chat-memory:";
    private static final int MAX_MESSAGES = 10;
    private static final long CACHE_TTL_HOURS = 1;
}
```

记忆读取 — getMessages()

```
@Override
public List<ChatMessage> getMessages(Object memoryId) {
    String key = buildKey(memoryId);
    // 1. 优先从 Redis 读取
    String json = stringRedisTemplate.opsForValue().get(key);
    if (json != null && !json.isEmpty()) {
        return new ArrayList<>(ChatMessageDeserializer.messagesFromJson(json));
    }
    // 2. Redis 未命中 → 从 DB 加载
    List<ChatMessage> messages = loadFromDatabase(memoryId.toString());
    // 3. 回写 Redis
    saveToRedis(key, messages);
    return messages;
}
```

写入 — updateMessages()

```
@Override
public void updateMessages(Object memoryId, List<ChatMessage> messages) {
    // 截断保留最近10条 → 写入 Redis
    List<ChatMessage> trimmed = trimMessages(messages);
    saveToRedis(buildKey(memoryId), trimmed);
}
```

但是，在我们的项目中，updateMessages() 只写 Redis，不直接写 DB。

know-engine 采用读写分离策略：

- 读路径：ChatMemoryStore.getMessages() → Redis → DB（只读）
- 写路径：业务层 saveUserMessage() / updateContent()（直接写 DB）

主要是因为我们把消息的最终持久化由业务层的 ChatMessageService.saveUserMessage() 和 updateContent() 负责。目的是这样的话，我们可以控制在过程中更新记忆内容，比如引用的文档、改写后的问题等。

而且。LangChain4j 的 updateMessages() 在一次 LLM 调用中会被调用多次（加用户消息后一次，加AI回复后一次），如果每次都写 DB 会产生不必要的频繁 IO。

不要updateMessages行不行？不行的，因为langchain4j在运行时，会调用这个方法把systemPrompt也放进list中，如果没有实现，那么会导致@SystemPrompt的注解失效。

从 DB 加载 — loadFromDatabase()

```
private List<ChatMessage> loadFromDatabase(String conversationId) {
    List<ChatMessage> dbMessages = chatMessageService.getRecentMessages(conversationId, MAX_MESSAGES);
    List<ChatMessage> messages = new ArrayList<>();
    for (ChatMessage dbMessage : dbMessages) {
        if (dbMessage.getContent() == null || dbMessage.getContent().isEmpty()) {
            continue;  // 过滤空消息（如预创建的 assistant 占位记录）
        }
        if (dbMessage.getType() == ChatMessageType.USER) {
            messages.add(UserMessage.from(dbMessage.getContent()));
        } else if (dbMessage.getType() == ChatMessageType.ASSISTANT) {
            messages.add(AiMessage.from(dbMessage.getContent()));
        }
    }
    return messages;
}
```

缓存失效 — evictCache()

```
public void evictCache(Object memoryId) {
    stringRedisTemplate.delete(buildKey(memoryId));
}
```

对话生命周期

一次用户对话涉及 两个 AiService（意图识别 + RAG 对话），它们共享同一个 DatabaseChatMemoryStore：

```
用户发送消息
    │
    ▼
┌─── ChatController.send() ──────────────────────────────────────────┐
│                                                                    │
│  ① saveUserMessage(conversationId, content) → 用户消息写入DB         │
│  ② saveAssistantMessage(conversationId)     → AI消息写入DB           │
│                                                                    │
│  ③intentRecognitionService.chat(conversationId, content)         │
│     │  AiServices 内部:                                             │
│     │  getMessages() → Redis miss → 从DB加载                        │
│     │  → add SystemMessage + UserMessage → 调LLM → add AiMessage    │
│     │  → updateMessages() → 意图识别结果写入Redis                     │
│     │                                                              │
│  ④ evictCache(conversationId)               → 清 Redis ★       │
│     （隔离意图识别的AI响应，避免污染后续对话记忆）                         │
│                                                                     │
│  ⑤chatApplicationService.doChat()                                 │
│     │  AiServices 内部:                                             │
│     │  getMessages() → Redis miss → 从DB加载(干净的历史)              │
│     │  → 更新改写后的问题、检索到的文本到数据库的UserMessage              │
│     │  → add SystemMessage + UserMessage + RAG上下文                │
│     │  → 流式调LLM → token逐个推送                                    │
│     │  → updateMessages() → 完整记忆写入Redis                         │
│     │                                                               │
│  ⑥ doOnComplete → updateContent(assistantMsgId, fullContent)       │
│     （AI回复持久化到DB，下次对话可从DB加载）                              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

为什么需要删除一次Redis的记忆？

主要目的是为了清除意图识别产生的 AI 响应，避免其作为"历史对话"污染 RAG 对话上下文。这是之前踩过一个坑：

为什么Redis不用list结构而是用String

当前用的是 opsForValue（String）而不是 opsForList（List），主要基于以下考虑：

在 `ChatMemoryStore` 的定义中，`updateMessages(Object memoryId, List<ChatMessage> messages)` 这个方法的第二个参数 `messages`，代表的是 LangChain4j 经过内存管理器（如 `MessageWindowChatMemory`）计算后，**当前这一时刻应该保留的所有有效消息的全集**。

- **举个例子**：假设你的窗口限制是保留最近 3 条消息。当前 Redis 里已经有 `[消息A, 消息B, 消息C]`。
- 当用户发来 `[消息D]` 时，LangChain4j 会在内存中先把 D 加进去，变成 `[A, B, C, D]`，然后发现超出了 3 条的限制，于是它会自动把最早的 A 淘汰掉。
- 此时，LangChain4j 调用 `updateMessages` 传给你的列表是 **[B, C, D]**。
- 它的潜台词是：“存储器，请把这个会话的状态**更新**为 [B, C, D]”。

如果不先删除旧数据，而是直接往 Redis 的 List 里追加（RPUSH），Redis 里的数据就会变成 `[A, B, C, B, C, D]`。

而解决这个问题，两个办法，一个是先从redis中取出内容，去重，然后再保存，还有个办法就是改成先整体删除Redis再更新。（list不支持覆盖保存）

这两个方案都很复杂，还不如直接就保存个json了。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a05eb593fb9180001799a1b
