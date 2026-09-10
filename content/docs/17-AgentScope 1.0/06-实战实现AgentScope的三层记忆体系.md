---
title: "✅实战：实现AgentScope的三层记忆体系"
---

# ✅实战：实现AgentScope的三层记忆体系

AutoContextMemory的使用

AutoContextMemory其实也是Memory的一个实现类。所以可以把他当做Memory设置到ReactAgent中。

AutoContextMemory可以通过AutoContextConfig来设置一些可以调节的参数，并且AutoContextMemory因为需要用到LLM，所以需要给他一个ChatModel。

```text
DashScopeChatModel chatModel = DashScopeChatModel.builder()
        .apiKey("sk-dcebc45c03b04c6e85391abb2264e594")
        .modelName("qwen3-max")
        .stream(true)
        .enableThinking(true)
        .formatter(new DashScopeChatFormatter())
        .defaultOptions(GenerateOptions.builder().thinkingBudget(1024).build())
        .build();

		// AutoContextMemory（自动上下文压缩）
AutoContextConfig autoContextConfig = AutoContextConfig.builder()
                .tokenRatio(0.1)        // 触发压缩的阈值比例
                .lastKeep(20)            // 最近保留的消息数
                .build();
AutoContextMemory memory = new AutoContextMemory(autoContextConfig, chatModel);
```

构造好了一个AutoContextMemory之后，就可以把他设置个ReactAgent作为Memory了，但是，这里还需要注意的是，AutoContextMemory中的compressIfNeeded是需要通过一个Hook来调用执行的。这个Hook就是AutoContextHook。

所以用法如下：

```text
ReActAgent agent = ReActAgent.builder()
        .memory(memory)      // 自动上下文压缩
        .hook(new AutoContextHook())     // 自动上下文压缩 Hook
        .build();
```

在AutoContextHook的handlePreReasoning中，会执行`autoContextMemory.compressIfNeeded();` 。也就是在LLM每一次Reasoning之前，会触发调用。

三层记忆体系

通过前面几节课介绍的长期记忆、持久化记忆以及智能上下文压缩。我们可以用ASJ实现一个三层记忆体系：

```text
package cn.hollis.llm.llmentor.agentscope.demo;
import io.agentscope.core.ReActAgent;
import io.agentscope.core.formatter.dashscope.DashScopeChatFormatter;
import io.agentscope.core.memory.LongTermMemoryMode;
import io.agentscope.core.memory.autocontext.*;
import io.agentscope.core.memory.bailian.BailianLongTermMemory;
import io.agentscope.core.memory.mem0.Mem0LongTermMemory;
import io.agentscope.core.message.Msg;
import io.agentscope.core.message.MsgRole;
import io.agentscope.core.message.TextBlock;
import io.agentscope.core.model.DashScopeChatModel;
import io.agentscope.core.model.GenerateOptions;
import io.agentscope.core.session.JsonSession;
import io.agentscope.core.session.Session;
import io.agentscope.core.tool.Toolkit;
import io.agentscope.core.tool.file.ReadFileTool;
import io.agentscope.core.tool.file.WriteFileTool;

import java.nio.file.Path;
import java.nio.file.Paths;
public class FullMemoryDemo {

    public static void main(String[] args) {
        DashScopeChatModel chatModel = DashScopeChatModel.builder()
                .apiKey("sk-dcebc45c03b04c6e85391abb2264e594")
                .modelName("qwen3-max")
                .stream(true)
                .enableThinking(true)
                .formatter(new DashScopeChatFormatter())
                .defaultOptions(GenerateOptions.builder().thinkingBudget(1024).build())
                .build();

        // 1. 长期记忆：跨会话语义检索
        BailianLongTermMemory longTermMemory = BailianLongTermMemory.builder()
                .userId("hollis666")           // 关键：每个用户一个隔离的记忆空间
                .apiKey("sk-dcebc45c03b04c6e85391abb2264e594")
                .memoryLibraryId("8553b56bbeb9451295e49a09d8c26ee3")
                .build();

        // 2. 短期记忆：AutoContextMemory（自动上下文压缩）
        // 当短期消息超过 token 上限时，自动总结早期消息以节省 token
        AutoContextConfig autoContextConfig = AutoContextConfig.builder()
                .tokenRatio(0.1)        // 触发压缩的阈值比例
                .lastKeep(20)            // 最近保留的消息数
                .build();
        AutoContextMemory memory = new AutoContextMemory(autoContextConfig, chatModel);

        // 3. 工具集
        Toolkit toolkit = new Toolkit();
        toolkit.registerTool(new ReadFileTool());
        toolkit.registerTool(new WriteFileTool());

        // 4. 完整 Agent 配置
        ReActAgent agent = ReActAgent.builder()
                .name("Assistant")
                .sysPrompt("You are a helpful AI assistant")
                .model(chatModel)
                .memory(memory)
                .maxIters(50)
                .longTermMemory(longTermMemory)
                .longTermMemoryMode(LongTermMemoryMode.STATIC_CONTROL)  // 也可以用 BOTH
                .enablePlan()                          // 启用计划模块
                .toolkit(toolkit)
                .hook(new AutoContextHook())          // 自动上下文压缩 Hook
                .build();

        // 5. Session 持久化
        String sessionId = "user_hollis_session";
        Path sessionPath = Paths.get(System.getProperty("user.home"),
                ".agentscope", "examples", "sessions");
        Session session = new JsonSession(sessionPath);
        agent.loadIfExists(session, sessionId);  // 恢复短期记忆

        // 6. 多轮交互循环
        try {
            // ...用户输入循环...
            Msg userMsg = Msg.builder()
                    .role(MsgRole.USER)
                    .content(TextBlock.builder().text("...").build())
                    .build();
            Msg response = agent.call(userMsg).block();
            agent.saveTo(session, sessionId);  // 保存短期记忆 + 工具状态

        } catch (Throwable e) {
            agent.saveTo(session, sessionId);  // 异常时也保存
        }
    }
}
```

```text
		用户输入
          ↓
   ┌──────────────────┐
   │AutoContextMemory │  ← 短期记忆（带自动压缩）
   │  最近 20 条原文 +  │     超长后早期消息会被 LLM 总结
   │  早期对话摘要      │
   └──────────────────┘
          ↓
   ┌──────────────────┐
   │  JsonSession     │  ← 会话持久化（跨重启）
   │  序列化到磁盘      │     保存的是上面的短期记忆
   └──────────────────┘
          ↓
   ┌──────────────────┐
   │  Mem0LongTermMem │  ← 长期记忆（跨会话语义检索）
   │  向量化提取的事实   │     每轮自动写入，每轮自动召回
   └──────────────────┘
```

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a19610251b1440001afa58f
