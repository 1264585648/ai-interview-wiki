---
title: "✅LangChain4J中实现持久化记忆"
---

# ✅LangChain4J中实现持久化记忆

我们之前也介绍过LangChain4j中的记忆，但是也是介绍的基于内存短期记忆，利用LangChain4j也能做持久化的记忆，但是官方没给现成的实现，只能靠我们自己实现。

在LangChain4j中，有一个内置的ChatMemoryStore接口，可以用它来扩展实现内存记忆。

这个接口中定义了删、改、查等接口：

```text
public interface ChatMemoryStore {


    List<ChatMessage> getMessages(Object memoryId);

   
    void updateMessages(Object memoryId, List<ChatMessage> messages);

    void deleteMessages(Object memoryId);
}
```

有了它之后，就可以自己扩展，使用MySQL或者Redis等其他数据库来做保存了。如：

```
@Component
public class RedisChatMemoryStore implements ChatMemoryStore {

    private final RedisTemplate<String, String> redisTemplate;

    public RedisChatMemoryStore(RedisTemplate<String, String> redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    @Override
    public List<ChatMessage> getMessages(Object memoryId) {
        String key = buildKey(memoryId);
        String json = redisTemplate.opsForValue().get(key);

        if (json == null || json.isEmpty()) {
            return Collections.emptyList();
        }

        return ChatMessageDeserializer.messagesFromJson(json);
    }

    @Override
    public void updateMessages(Object memoryId, List<ChatMessage> messages) {
        String key = buildKey(memoryId);
        String json = ChatMessageSerializer.messagesToJson(messages);
        redisTemplate.opsForValue().set(key, json);
    }

    @Override
    public void deleteMessages(Object memoryId) {
        redisTemplate.delete(buildKey(memoryId));
    }

    private String buildKey(Object memoryId) {
        return "langchain4j:chat-memory:" + memoryId;
    }
}
```

使用方法同样是构造一个MessageWindowChatMemory，把这个RedisChatMemoryStore设置进去就行了。和Spring AI差不多。（应该是Spring AI参考了LangChain4j，只不过自己做了些实现的扩展，更好用了）

```
langChainMemoryAiService = AiServices.builder(LangChainMemoryAiService.class)
                .chatModel(chatModel)
                .chatMemoryProvider(memoryId -> MessageWindowChatMemory.builder().id(memoryId).maxMessages(10).chatMemoryStore(redisChatMemoryStore).build())
                .build();
```

总的来说，就是LangChain4j 通过三层抽象实现多轮对话记忆：

```
┌───────────────────────────────────────────────────────┐
│                    AiServices                         │
│  (代理层：自动管理消息的 add / messages 生命周期)          │
└────────────────────────┬──────────────────────────────┘
                         │ 使用
┌────────────────────────▼──────────────────────────────┐
│              ChatMemory (接口)                         │
│  实现类：MessageWindowChatMemory                        │
│  职责：控制记忆窗口大小、消息淘汰策略                       │
│  核心方法：add(message) / messages()                    │
└────────────────────────┬──────────────────────────────┘
                         │ 委托持久化
┌────────────────────────▼──────────────────────────────┐
│            ChatMemoryStore (接口)                      │
│  职责：消息的存储和读取（持久化层）                         │
│  核心方法：getMessages() / updateMessages()             │
└───────────────────────────────────────────────────────┘
```

LangChain4j 的 AiServices 在每次 LLM 调用时，内部执行以下流程：

```
// 伪代码：AiServices 内部对 ChatMemory 的操作
List<ChatMessage> history = chatMemoryStore.getMessages(memoryId); // 1. 加载历史
history.add(systemMessage);   // 2. 加入 SystemMessage
history.add(userMessage);     // 3. 加入当前用户消息
chatMemoryStore.updateMessages(memoryId, history); // 4. 持久化（含新用户消息）

AiMessage response = llm.chat(history);  // 5. 调用 LLM

history.add(response);        // 6. 加入 AI 回复
chatMemoryStore.updateMessages(memoryId, history); // 7. 再次持久化（含 AI 回复）
```

这意味着 ChatMemoryStore 的实现必须保证：

- getMessages() 返回的列表在同一次调用内可变且一致
- updateMessages() 需要真正保存状态，否则下一次请求会丢失历史

通过 chatMemoryProvider 可以实现多会话隔离：

```
.chatMemoryProvider(memoryId -> MessageWindowChatMemory.builder()
        .id(memoryId)                              // memoryId = conversationId
        .maxMessages(10)                           // 滑动窗口：最多保留10条
        .chatMemoryStore(databaseChatMemoryStore)  // 持久化委托
        .build())
```

配合 AiService 接口上的 @MemoryId 注解：

```
@AiService
public interface LangChainMemoryAiService {

    String chatMemory(@MemoryId String memoryId, @UserMessage String userMessage);
}
```

LangChain4j 会自动将 conversationId 作为 memoryId 传递给 ChatMemoryStore，实现每个会话独立记忆。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6982e63c51b14400012ffdda
