---
title: "✅AgentScope Java特性：多轮会话&会话持久化"
---

# ✅AgentScope Java特性：多轮会话&会话持久化

AgentScope Java 的多轮会话由两个核心机制协作完成：**Memory**（短期会话记忆）负责维护当前对话上下文，**Session**（会话持久化）负责将状态保存/恢复到外部存储。两者结合实现了"跨请求的连续对话"和"跨重启的会话恢复"。

多轮会话的核心：Memory

AgentScope Java 中的 Memory 接口扮演"短期记忆"角色。每次用户发送消息调用 agent.call(msg) 时，框架自动完成以下流程：

1. 将用户消息加入 Memory（addToMemory(msgs)）
2. 构造完整消息列表传给 LLM（System Prompt + 历史消息 + 当前输入）
3. 将 LLM 的回复也加入 Memory
4. 如果触发工具调用，工具结果同样加入 Memory
5. 循环直到 LLM 决定结束（无工具调用或达到 maxIters）

因此只要 Agent 实例不被销毁，多轮对话天然支持——Memory 中持续积累所有历史消息。

```text
public interface Memory extends StateModule {
    void addMessage(Msg message);     // 添加消息
    List<Msg> getMessages();          // 获取全部历史消息
    void deleteMessage(int index);    // 删除指定位置消息
    void clear();                     // 清空所有消息
}
```

架提供的默认实现是 InMemoryMemory，基于 CopyOnWriteArrayList 实现线程安全的消息存储。

```
package cn.hollis.llm.llmentor.agentscope.demo;

import io.agentscope.core.ReActAgent;
import io.agentscope.core.memory.InMemoryMemory;
import io.agentscope.core.message.Msg;
import io.agentscope.core.message.MsgRole;
import io.agentscope.core.message.TextBlock;
import io.agentscope.core.model.DashScopeChatModel;
import io.agentscope.core.formatter.dashscope.DashScopeChatFormatter;

public class MultiTurnChatDemo {

    public static void main(String[] args) {
        String apiKey = "sk-e4902ea9d4164c1fa9d88ca86b2645c8";

        // 创建 Memory（负责维护会话历史）
        InMemoryMemory memory = new InMemoryMemory();

        // 创建 Agent
        ReActAgent agent = ReActAgent.builder()
                .name("Assistant")
                .sysPrompt("You are a helpful AI assistant. Remember what the user tells you.")
                .model(DashScopeChatModel.builder()
                        .apiKey(apiKey)
                        .modelName("qwen-max")
                        .build())
                .memory(memory)   // 注入 Memory
                .build();

        // === 第1轮 ===
        Msg msg1 = Msg.builder()
                .role(MsgRole.USER)
                .content(TextBlock.builder().text("My name is Hollis and I'm a software engineer.").build())
                .build();
        Msg reply1 = agent.call(msg1).block();
        System.out.println("Agent: " + reply1.getTextContent());

        // === 第2轮（Agent 能记住第1轮信息）===
        Msg msg2 = Msg.builder()
                .role(MsgRole.USER)
                .content(TextBlock.builder().text("What's my name and what do I do?").build())
                .build();
        Msg reply2 = agent.call(msg2).block();
        System.out.println("Agent: " + reply2.getTextContent());
        // Agent 会回答: "Your name is Hollis and you're a software engineer."

        // 查看 Memory 中的完整对话历史
        System.out.println("Total messages in memory: " + memory.getMessages().size());
        // 输出: 4（user1 + assistant1 + user2 + assistant2）
    }
}
```

会话持久化：Session 体系

当 JVM 重启、或需要在集群场景中多个实例间共享会话状态时，需要将 Memory 等组件的状态持久化。

在model scope中，持久化需要靠Session。纯靠memory是不行的。Session接口中提供了Session的CURD的相关方法的定义。

![image.png](assets/31f4b2b6cf96.png)

在agent scope中，提供了一些默认的session实现：

![image.png](assets/67c3e462379d.png)

包括基于Redis、MySQL以及JSON文件存储的持久化方案。

第一次对话，记忆持久化保存：

```text
package cn.hollis.llm.llmentor.agentscope.demo;

import io.agentscope.core.ReActAgent;
import io.agentscope.core.memory.InMemoryMemory;
import io.agentscope.core.message.Msg;
import io.agentscope.core.message.MsgRole;
import io.agentscope.core.message.TextBlock;
import io.agentscope.core.model.DashScopeChatModel;
import io.agentscope.core.session.JsonSession;
import io.agentscope.core.session.Session;

import java.nio.file.Path;
import java.nio.file.Paths;

public class PersistentChatDemo {

    public static void main(String[] args) {
        String apiKey = "sk-e4902ea9d4164c1fa9d88ca86b2645c8";
        String sessionId = "user_hollis_session";

        // 1. 创建 Session（JSON文件持久化）
        Path sessionPath = Paths.get(System.getProperty("user.home"),
                ".agentscope", "examples", "sessions");
        Session session = new JsonSession(sessionPath);

        // 2. 创建 Agent 组件
        InMemoryMemory memory = new InMemoryMemory();

        ReActAgent agent = ReActAgent.builder()
                .name("Assistant")
                .sysPrompt("You are a helpful AI assistant with persistent memory. ")
                .model(DashScopeChatModel.builder()
                        .apiKey(apiKey)
                        .modelName("qwen-max")
                        .build())
                .memory(memory)
                .build();

        // 3. 如果之前有保存的会话，加载它（恢复历史上下文）
        boolean resumed = agent.loadIfExists(session, sessionId);
        if (resumed) {
            System.out.println("Session restored! " + memory.getMessages().size() + " messages loaded.");
        } else {
            System.out.println("New session started.");
        }

        // 4. 发送新消息（延续之前的对话上下文）
        Msg userMsg = Msg.builder()
                .role(MsgRole.USER)
                .content(TextBlock.builder().text("My name is Hollis and I'm a software engineer.").build())
                .build();

        Msg response = agent.call(userMsg).block();
        System.out.println("Agent: " + response.getTextContent());

        // 5. 保存会话（下次启动时可恢复）
        agent.saveTo(session, sessionId);
        System.out.println("Session saved. Messages in memory: " + memory.getMessages().size());
    }
}
```

运行之后，可以看到保存下来的记忆文件：

```
~/.agentscope/sessions/       # 默认存储目录（可自定义）
  └── user_hollis_session/    # 每个 SessionKey 一个子目录
      ├── agent_meta.json     # Agent 元数据
      ├── memory_messages.jsonl  # 消息列表（JSONL 格式，增量追加）
      ├── memory_messages.hash # hash 文件（变更检测，避免不必要的全量重写）
      └── toolkit_activeGroups.json  # Toolkit 状态
```

![image.png](assets/9183c8d7387b.png)

然后修改一下对话内容：

```text
Msg userMsg = Msg.builder()
        .role(MsgRole.USER)
        .content(TextBlock.builder().text("What's my name and what do I do?").build())
        .build();
```

输出结果：

```
Session restored! 2 messages loaded.
Agent: Your name is Hollis, and you're a software engineer. Is there anything specific about your work or projects that you'd like to share or discuss?
Session saved. Messages in memory: 4
```

agentScope中还有一个SessionManager ，他提供了更简洁的链式 API：

```text
package cn.hollis.llm.llmentor.agentscope.demo;

import io.agentscope.core.ReActAgent;
import io.agentscope.core.memory.InMemoryMemory;
import io.agentscope.core.message.Msg;
import io.agentscope.core.message.MsgRole;
import io.agentscope.core.message.TextBlock;
import io.agentscope.core.model.DashScopeChatModel;
import io.agentscope.core.session.JsonSession;
import io.agentscope.core.session.Session;
import io.agentscope.core.session.SessionManager;

import java.nio.file.Path;
import java.nio.file.Paths;

public class SessionManagerChatDemo {

    public static void main(String[] args) {
        String apiKey = "sk-e4902ea9d4164c1fa9d88ca86b2645c8";
        String sessionId = "user_hollis_session";

        // 1. 创建 Session（JSON文件持久化）
        Path sessionPath = Paths.get(System.getProperty("user.home"),
                ".agentscope", "examples", "sessions");
        Session session = new JsonSession(sessionPath);

        // 2. 创建 Agent 组件
        InMemoryMemory memory = new InMemoryMemory();

        ReActAgent agent = ReActAgent.builder()
                .name("Assistant")
                .sysPrompt("You are a helpful AI assistant with persistent memory. ")
                .model(DashScopeChatModel.builder()
                        .apiKey(apiKey)
                        .modelName("qwen-max")
                        .build())
                .memory(memory)
                .build();

        // === 加载会话 ===
        SessionManager sessionManager = SessionManager.forSessionId(sessionId)
                .withSession(new JsonSession(Path.of("sessions")))
                .addComponent(agent);

        sessionManager.loadIfExists();  // 存在则加载，不存在则什么都不做

        // 4. 发送新消息（延续之前的对话上下文）
        Msg userMsg = Msg.builder()
                .role(MsgRole.USER)
                .content(TextBlock.builder().text("What's my name and what do I do?").build())
                .build();

        Msg response = agent.call(userMsg).block();
        System.out.println("Agent: " + response.getTextContent());

        // 5. 保存会话（下次启动时可恢复）
        sessionManager.saveSession();
        System.out.println("Session saved. Messages in memory: " + memory.getMessages().size());
    }
}
```

**StatePersistence——精细控制持久化范围**

默认情况下 Agent 的 saveTo/loadFrom 会自动管理所有组件。如果你想自己管理某些组件的状态，可以通过 StatePersistence 配置：

```text
import io.agentscope.core.state.StatePersistence;

// 默认：管理所有组件
ReActAgent agent1 = ReActAgent.builder()
        .name("assistant")
        .model(model)
        .memory(memory)
        .build(); // statePersistence 默认 = StatePersistence.all()

// 只管理 Memory（Toolkit 和 PlanNotebook 由用户自行管理）
ReActAgent agent2 = ReActAgent.builder()
        .name("assistant")
        .model(model)
        .memory(memory)
        .statePersistence(StatePersistence.memoryOnly())
        .build();

// 完全不管理（用户自行管理所有状态）
ReActAgent agent3 = ReActAgent.builder()
        .name("assistant")
        .model(model)
        .statePersistence(StatePersistence.none())
        .build();

// 自定义：管理 Memory 和 Toolkit，但不管理 PlanNotebook
ReActAgent agent4 = ReActAgent.builder()
        .name("assistant")
        .model(model)
        .memory(memory)
        .statePersistence(StatePersistence.builder()
                .memoryManaged(true)
                .toolkitManaged(true)
                .planNotebookManaged(false)
                .statefulToolsManaged(false)
                .build())
        .build();
```

StatePersistence中包含四个组件，分别对应 ReActAgent 内部的四个核心模块：

**Memory（对话记忆）**

就是上面讲的 InMemoryMemory，存储当前会话的所有消息列表（用户输入、LLM 回复、工具调用结果等）。持久化时以 JSONL 格式保存为 memory_messages.jsonl，恢复时重新加载到内存中，实现跨重启的多轮对话延续。

**Toolkit（工具集）**

Agent 可用的工具注册表。Toolkit 内部支持"工具分组"（Tool Groups），通过 activeGroups 控制当前激活哪些工具组。持久化时保存的是 toolkit_activeGroups——即哪些工具组处于激活状态。这样恢复会话后，Agent 仍然只使用之前激活的那组工具，而不是全部重置。

**PlanNotebook（计划笔记本）**

Agent 的任务规划/执行跟踪模块。当 Agent 处理复杂多步任务时，PlanNotebook 记录计划步骤、执行状态、中间结果等。持久化后，恢复会话时 Agent 能知道"上次执行到哪一步了"，继续未完成的计划，而不是从头开始。

**StatefulTools（有状态工具）**

某些工具本身是有状态的——比如一个"购物车工具"可能维护了当前购物车内容，一个"文件编辑工具"可能记录了当前打开的文件和光标位置。这类工具实现了 StateModule 接口，可以自行定义如何 save/load 状态。statefulToolsManaged = true 时，Agent 的 saveTo/loadFrom 会自动遍历所有有状态工具并保存/恢复它们的状态。

**这四个分别是"聊了什么"、"能用什么工具"、"计划执行到哪了"、"工具自身的内部状态"。****StatePersistence**** 让你选择性地决定哪些需要框架自动管理持久化，哪些你自己来控。**

为什么要区分Memory和Session

第一次学这个玩意的时候，肯定会有疑问，agentscope为什么把memory和session分开，不能像spring ai alibaba一样直接用memory的机制么？为什么还要开发者手动调用session的维护？

其实是，AgentScope 的 Agent 状态远比"消息列表"复杂得多，而且在 ReAct 循环中对持久化时机有严格的控制需求。

Agent 的"状态"不只是消息。Spring AI Alibaba 的 ChatMemory 面向的是简单的"一问一答"对话模式，状态 ≈ 消息列表，把持久化做进 Memory 实现里是自然的。

但 AgentScope 的 ReActAgent 一次 call() 可能经历 5-10 轮内部推理+工具调用循环，它的完整状态包括：

- 消息历史（Memory）
- 当前激活的工具组（Toolkit activeGroups）
- 多步计划的执行进度（PlanNotebook）
- 有状态工具的内部数据（StatefulTools）
- Agent 元数据（sysPrompt 可能被动态修改）

如果像 Spring AI 一样把持久化耦合进 Memory，其他四个组件的持久化就没有统一出口了。Session 作为独立抽象层，统一解决了"所有有状态组件的持久化"问题。

而且，Memory 的 addMessage() 在一次用户请求中可能被调用十几次（每一步推理、每一个工具结果、流式 chunk 处理等）。如果每次 addMessage 都触发持久化写入：

- 同步写 → 严重拖慢 Agent 响应
- 异步写 → 中间状态不一致（Agent 还在推理中，你保存了半截状态）
- 批量缓冲写 → 在 Memory 里引入复杂的 buffer/flush 逻辑，职责不纯

分离后，Memory 只管内存中的快速读写，Session 的保存时机完全由开发者决定。

一次 agent.call() 中间可能出错（工具执行失败、达到 maxIters、被用户中断）。如果自动持久化，你会面临"保存了一个不一致的中间状态"。

AgentScope 的做法是让开发者选择 commit point，这类似于数据库事务——你不会希望每条 SQL 自动 commit，而是在业务逻辑完成后显式提交。

其实框架也提供了部分自动化：**GracefulShutdown 自动保存**——agent.loadIfExists() 会自动绑定 Session 到 ShutdownManager，JVM 关闭时自动 saveTo

![image.png](assets/5dafafb240c3.png)

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a06c7c574e403000193f4f2
