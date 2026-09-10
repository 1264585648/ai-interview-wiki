---
title: "✅AgentScope Java特性：流式输出、结构化输出、超时与重试、执行控制"
---

# ✅AgentScope Java特性：流式输出、结构化输出、超时与重试、执行控制

流式输出

AgentScope Java 的流式输出基于** Reactor** 的 Flux&lt;Event&gt; 实现。Agent 提供 stream() 方法，返回一个事件流，每个事件包含推理过程的增量输出、工具调用结果等。

关键类：

- Agent.stream(Msg, StreamOptions) — 流式调用入口，返回 Flux&lt;Event&gt;
- StreamOptions — 流式配置项（事件类型过滤、增量/累积模式等）
- Event — 流式事件对象，包含类型、消息内容、是否为最后一条
- EventType — 事件类型枚举：ALL、REASONING、TOOL_RESULT、SUMMARY、AGENT_RESULT、HINT
- **REASONING**：Agent 的"思考和规划"阶段产生的事件。对应 ReAct 循环中的 Reasoning 步骤，即模型在决定下一步行动之前的推理输出。(包括TOOL_USE的内容）
- **TOOL_RESULT**：Agent 调用工具（Acting 阶段）执行完成后产生的事件，包含工具的返回结果。
- SUMMARY：当 Agent 达到最大迭代次数（maxIters）仍未完成任务时，框架会强制进入总结阶段，让模型总结当前已完成的工作。这个阶段产生的事件就是 SUMMARY。
- **AGENT_RESULT**：Agent 整个 call() 调用的最终返回结果。相当于 agent.call(msg).block() 的返回值以事件形式出现在流中。
- HINT：来自 RAG（检索增强生成）、Memory（记忆系统）或 Planning（规划系统）的上下文信息注入事件。这些信息不是模型生成的，而是框架在推理之前主动注入的辅助信息。
- ALL：特殊值，表示接收所有类型的事件（**但默认仍不包含 AGENT_RESULT**）

**StreamOptions 配置**

```
StreamOptions options = StreamOptions.builder()
    // 选择要接收的事件类型
    .eventTypes(EventType.REASONING, EventType.TOOL_RESULT)
    // true = 增量模式（只发送新增内容），false = 累积模式（每次发送全部已累积内容）
    .incremental(true)
    // 是否包含推理过程中间 chunk
    .includeReasoningChunk(true)
    // 是否包含最终推理结果（把流式输出的内容拼在一起一次性返回）
    .includeReasoningResult(false)
    .build();
```

**示例**

**演示REASONING的输出：**

```text

@RestController
@RequestMapping("/stream")
public class StreamingController {

    private final String apiKey = "sk-e4902ea9d4164c1fa9d88ca86b2645c8";


    @GetMapping(path = "/chat", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<String> chat(
            @RequestParam String message, HttpServletResponse httpServletResponse) {
        httpServletResponse.setCharacterEncoding("UTF-8");

        Toolkit toolkit = new Toolkit();
        toolkit.registerTool(new SimpleTools());

        // 创建 Agent，注意 model 需要 stream(true)
        ReActAgent agent = ReActAgent.builder()
                .name("WebAgent").toolkit(toolkit)
                .model(DashScopeChatModel.builder()
                        .apiKey(apiKey)
                        .modelName("qwen-plus")
                        .stream(true)  // 开启模型级流式
                        .build())
                .build();

        // 构建用户消息
        Msg userMsg = Msg.builder().textContent(message).build();

        // 配置流式选项 — 增量模式
        StreamOptions streamOptions = StreamOptions.builder()
                // 选择要接收的事件类型
                .eventTypes(EventType.REASONING)
                // true = 增量模式（只发送新增内容），false = 累积模式（每次发送全部已累积内容）
                .incremental(true)
                // 是否包含最终推理结果（把流式输出的内容拼在一起一次性返回）
                .includeReasoningResult(false)
                .build();

        // 调用 stream() 获取事件流
        return agent.stream(userMsg, streamOptions)
                .subscribeOn(Schedulers.boundedElastic())
                .map(event -> JSON.toJSONString(event.getMessage()))
                .filter(text -> text != null && !text.isEmpty());
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

输出内容：

```
data:{"content":[{"type":"text","text":"我是"}],"id":"bf0b7226-221c-9868-b5a0-595c831149de","metadata":{},"name":"WebAgent","role":"ASSISTANT","timestamp":"2026-05-28 16:04:55.254"}

data:{"content":[{"type":"text","text":"通义千"}],"id":"bf0b7226-221c-9868-b5a0-595c831149de","metadata":{},"name":"WebAgent","role":"ASSISTANT","timestamp":"2026-05-28 16:04:55.256"}

data:{"content":[{"type":"text","text":"问，是"}],"id":"bf0b7226-221c-9868-b5a0-595c831149de","metadata":{},"name":"WebAgent","role":"ASSISTANT","timestamp":"2026-05-28 16:04:55.297"}

data:{"content":[{"type":"text","text":"阿里巴巴"}],"id":"bf0b7226-221c-9868-b5a0-595c831149de","metadata":{},"name":"WebAgent","role":"ASSISTANT","timestamp":"2026-05-28 16:04:55.364"}

data:{"content":[{"type":"text","text":"集团旗下的超大规模语言模型"}],"id":"bf0b7226-221c-9868-b5a0-595c831149de","metadata":{},"name":"WebAgent","role":"ASSISTANT","timestamp":"2026-05-28 16:04:55.476"}

data:{"content":[{"type":"text","text":"。\n\n"}],"id":"bf0b7226-221c-9868-b5a0-595c831149de","metadata":{},"name":"WebAgent","role":"ASSISTANT","timestamp":"2026-05-28 16:04:55.575"}

data:{"content":[{"type":"tool_use","content":"{\"zone\": \"","id":"call_1de19c9abd614358ae9cbd","input":{"@type":"java.util.Collections$UnmodifiableMap"},"metadata":{"@type":"java.util.Collections$EmptyMap"},"name":"get_time"}],"id":"bf0b7226-221c-9868-b5a0-595c831149de","metadata":{},"name":"WebAgent","role":"ASSISTANT","timestamp":"2026-05-28 16:04:55.836"}

data:{"content":[{"type":"tool_use","content":"北京\"}","id":"call_1de19c9abd614358ae9cbd","input":{"@type":"java.util.Collections$UnmodifiableMap"},"metadata":{"@type":"java.util.Collections$UnmodifiableMap"},"name":"__fragment__"}],"id":"bf0b7226-221c-9868-b5a0-595c831149de","metadata":{},"name":"WebAgent","role":"ASSISTANT","timestamp":"2026-05-28 16:04:55.986"}

data:{"content":[{"type":"text","text":"现在"}],"id":"9a4cb191-42e9-9062-9036-99c30faac4cf","metadata":{},"name":"WebAgent","role":"ASSISTANT","timestamp":"2026-05-28 16:04:56.520"}

data:{"content":[{"type":"text","text":"是北京时间2"}],"id":"9a4cb191-42e9-9062-9036-99c30faac4cf","metadata":{},"name":"WebAgent","role":"ASSISTANT","timestamp":"2026-05-28 16:04:56.562"}

data:{"content":[{"type":"text","text":"026"}],"id":"9a4cb191-42e9-9062-9036-99c30faac4cf","metadata":{},"name":"WebAgent","role":"ASSISTANT","timestamp":"2026-05-28 16:04:56.607"}

data:{"content":[{"type":"text","text":"年"}],"id":"9a4cb191-42e9-9062-9036-99c30faac4cf","metadata":{},"name":"WebAgent","role":"ASSISTANT","timestamp":"2026-05-28 16:04:56.679"}

data:{"content":[{"type":"text","text":"5月28日1"}],"id":"9a4cb191-42e9-9062-9036-99c30faac4cf","metadata":{},"name":"WebAgent","role":"ASSISTANT","timestamp":"2026-05-28 16:04:56.785"}

data:{"content":[{"type":"text","text":"6时04分"}],"id":"9a4cb191-42e9-9062-9036-99c30faac4cf","metadata":{},"name":"WebAgent","role":"ASSISTANT","timestamp":"2026-05-28 16:04:56.871"}

data:{"content":[{"type":"text","text":"56秒，"}],"id":"9a4cb191-42e9-9062-9036-99c30faac4cf","metadata":{},"name":"WebAgent","role":"ASSISTANT","timestamp":"2026-05-28 16:04:57.004"}

data:{"content":[{"type":"text","text":"也就是下午四点"}],"id":"9a4cb191-42e9-9062-9036-99c30faac4cf","metadata":{},"name":"WebAgent","role":"ASSISTANT","timestamp":"2026-05-28 16:04:57.066"}

data:{"content":[{"type":"text","text":"零四分左右"}],"id":"9a4cb191-42e9-9062-9036-99c30faac4cf","metadata":{},"name":"WebAgent","role":"ASSISTANT","timestamp":"2026-05-28 16:04:57.132"}

data:{"content":[{"type":"text","text":"。"}],"id":"9a4cb191-42e9-9062-9036-99c30faac4cf","metadata":{},"name":"WebAgent","role":"ASSISTANT","timestamp":"2026-05-28 16:04:57.226"}
```

这里包含了模型的思考过程，另外还有工具调用的过程，主要包含tool_use不包含tool_result

如果想要过滤工具调用的内容，只展示模型的输出，则可以在输出时做过滤。如：

```text
return agent.stream(userMsg, streamOptions)
	.subscribeOn(Schedulers.boundedElastic())
	.map(event -> event.getMessage().getTextContent())
	.filter(text -> text != null && !text.isEmpty());
```

即只输出textContext不为空的内容。

**演示TOOL_RESULT的输出：**

修改StreamOptions如下：

```text
StreamOptions streamOptions = StreamOptions.builder()
        // 选择要接收的事件类型
        .eventTypes(EventType.REASONING,EventType.TOOL_RESULT)
        // true = 增量模式（只发送新增内容），false = 累积模式（每次发送全部已累积内容）
        .incremental(true)
        // 是否包含最终推理结果（把流式输出的内容拼在一起一次性返回）
        .includeReasoningResult(false)
        .build();
```

则页面输出：

```text
....

data:{"content":[{"type":"text","text":"的时间：\n\n"}],"id":"360e10cd-c33f-9952-a9c5-344856ae8564","metadata":{},"name":"WebAgent","role":"ASSISTANT","timestamp":"2026-05-28 15:58:37.295"}

data:{"content":[{"type":"tool_use","content":"{\"zone\":","id":"call_f39366c866cb4519be7fb0","input":{"@type":"java.util.Collections$UnmodifiableMap"},"metadata":{"@type":"java.util.Collections$EmptyMap"},"name":"get_time"}],"id":"360e10cd-c33f-9952-a9c5-344856ae8564","metadata":{},"name":"WebAgent","role":"ASSISTANT","timestamp":"2026-05-28 15:58:37.558"}

data:{"content":[{"type":"tool_use","content":" \"北京\"}","id":"call_f39366c866cb4519be7fb0","input":{"@type":"java.util.Collections$UnmodifiableMap"},"metadata":{"@type":"java.util.Collections$UnmodifiableMap"},"name":"__fragment__"}],"id":"360e10cd-c33f-9952-a9c5-344856ae8564","metadata":{},"name":"WebAgent","role":"ASSISTANT","timestamp":"2026-05-28 15:58:37.715"}

data:{"content":[{"type":"tool_result","id":"call_f39366c866cb4519be7fb0","metadata":{"@type":"java.util.ImmutableCollections$MapN"},"name":"get_time","output":[{"type":"text","text":"\"2026-05-28 15:58:37\""}]}],"id":"76130df2-374b-47d7-9ddf-3a8a7dc9e5a9","metadata":{},"name":"system","role":"TOOL","timestamp":"2026-05-28 15:58:37.764"}

data:{"content":[{"type":"text","text":"现在"}],"id":"ad2685d2-3061-9d46-842c-f95b4cad4ff1","metadata":{},"name":"WebAgent","role":"ASSISTANT","timestamp":"2026-05-28 15:58:38.295"}

data:{"content":[{"type":"text","text":"是北京时间2"}],"id":"ad2685d2-3061-9d46-842c-f95b4cad4ff1","metadata":{},"name":"WebAgent","role":"ASSISTANT","timestamp":"2026-05-28 15:58:38.371"}

data:{"content":[{"type":"text","text":"026"}],"id":"ad2685d2-3061-9d46-842c-f95b4cad4ff1","metadata":{},"name":"WebAgent","role":"ASSISTANT","timestamp":"2026-05-28 15:58:38.372"}

...
```

即除了前面的reasoning的内容外，还包含了tool_result的结果，即工具调用的结果。

**演示****AGENT_RESULT输出：**

StreamOptions修改如下：

```text
StreamOptions streamOptions = StreamOptions.builder()
        // 选择要接收的事件类型
        .eventTypes(EventType.AGENT_RESULT)
        // true = 增量模式（只发送新增内容），false = 累积模式（每次发送全部已累积内容）
        .incremental(true)
        // 是否包含最终推理结果（把流式输出的内容拼在一起一次性返回）
        .includeReasoningResult(false)
        .build();
```

这样的话就会直接输出最终结果：

```text
data:{"content":[{"type":"text","text":"现在是北京时间2026年5月28日16时13分14秒，也就是下午四点十三分左右。"}],"id":"bd044b03-0b9f-944e-adb7-404cd312ab85","metadata":{"_chat_usage":{"inputTokens":271,"outputTokens":31,"time":1.17,"totalTokens":302}},"name":"WebAgent","role":"ASSISTANT","timestamp":"2026-05-28 16:13:16.155"}
```

但是结果是一次性输出的，只不过以stream的形式包装了一下返回给前端了。

结构化输出

AgentScope Java 提供了开箱即用的结构化输出能力，可以让 Agent 的输出直接映射为 Java POJO 对象。其内部实现是通过 StructuredOutputHook + generate_response （io.agentscope.core.agent.StructuredOutputCapableAgent#createStructuredOutputTool ）工具模式实现自动纠错——如果模型第一次没有按格式输出，框架会自动重试并引导模型调用指定工具。

关键 API：

- agent.call(Msg, Class&lt;T&gt;) — 指定输出类型，返回包含结构化数据的 Msg
- agent.stream(msgs, options, Class&lt;T&gt;) — 流式模式下的结构化输出
- msg.getStructuredData(Class&lt;T&gt;) — 从返回消息中提取结构化对象

示例如下：

```text
package cn.hollis.llm.llmentor.agentscope.controller;

import com.alibaba.fastjson2.JSON;
import io.agentscope.core.ReActAgent;
import io.agentscope.core.message.Msg;
import io.agentscope.core.message.MsgRole;
import io.agentscope.core.message.TextBlock;
import io.agentscope.core.model.DashScopeChatModel;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/structured")
public class StructuredOutputController {

    private final String apiKey = "sk-e4902ea9d4164c1fa9d88ca86b2645c8";

    @GetMapping("/chat")
    public String chat() {
        // 创建 Agent
        ReActAgent agent = ReActAgent.builder().name("AnalysisAgent").sysPrompt("You are an intelligent analysis assistant. " + "Analyze user requests and provide structured responses.").model(DashScopeChatModel.builder().apiKey(apiKey).modelName("qwen-max").build()).build();


        // 提取联系人信息
        ContactInfo contactInfo = extractContactInfo(agent);
        System.out.println("Name: " + contactInfo.name);
        System.out.println("Email: " + contactInfo.email);
        System.out.println("Phone: " + contactInfo.phone);
        System.out.println("Company: " + contactInfo.company);
        return JSON.toJSONString(contactInfo);
    }

    private static ContactInfo extractContactInfo(ReActAgent agent) {
        Msg userMsg = Msg.builder().role(MsgRole.USER).content(TextBlock.builder().text("Extract contact info: Please contact Hollis at hollischuang@qq.com, " + "phone +1-555-1234, company SuperHollis.").build()).build();

        Msg result = agent.call(userMsg, ContactInfo.class).block();
        return result.getStructuredData(ContactInfo.class);
    }

    /**
     * 联系人信息
     */
    public static class ContactInfo {
        public String name;
        public String email;
        public String phone;
        public String company;
    }
}
```

超时与重试

AgentScope Java 通过 ExecutionConfig 统一管理超时和重试行为。它同时适用于**模型 API 调用**和**工具执行**，但两者的默认策略不同。

| 配置项 | 模型调用默认<br>(MODEL_DEFAULTS) | 工具执行默认 (TOOL_DEFAULTS) |
| --- | --- | --- |
| timeout | 5 分钟 | 5 分钟 |
| maxAttempts | 3（1次 + 2次重试） | 1（不重试） |
| initialBackoff | 2 秒 | — |
| maxBackoff | 30 秒 | — |
| backoffMultiplier | 2.0（指数退避） | — |
| retryOn | 429/5xx/超时/网络异常 | — |

框架定义了 RETRYABLE_ERRORS 判断逻辑：

- **会重试**：HTTP 429（限流）、HTTP 5xx（服务器错误）、TimeoutException、IOException（网络错误）
- **不重试**：HTTP 400（参数错误）、401/403（认证错误）、其他 4xx 客户端错误

**自定义超时与重试配置**

```
package cn.hollis.llm.llmentor.agentscope.controller;

import io.agentscope.core.ReActAgent;
import io.agentscope.core.message.Msg;
import io.agentscope.core.model.DashScopeChatModel;
import io.agentscope.core.model.ExecutionConfig;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;
import java.util.Objects;

@RestController
@RequestMapping("/retry")
public class RetryController {

    private final String apiKey = "sk-e4902ea9d4164c1fa9d88ca86b2645c8";

    @GetMapping("/chat")
    public String chat() {
        //  给模型调用设置更短的超时和更多重试
        ExecutionConfig modelConfig = ExecutionConfig.builder()
                .timeout(Duration.ofSeconds(30))        // 单次请求超时30秒
                .maxAttempts(5)                         // 最多尝试5次（1次初始 + 4次重试）
                .initialBackoff(Duration.ofSeconds(1))  // 首次重试等1秒
                .maxBackoff(Duration.ofSeconds(15))     // 退避上限15秒
                .backoffMultiplier(2.0)                 // 指数退避：1s -> 2s -> 4s -> 8s -> 15s
                .retryOn(ExecutionConfig.RETRYABLE_ERRORS)  // 使用默认可重试条件
                .build();

        // 给工具调用设置更长的超时（某些工具耗时较长）
        ExecutionConfig toolConfig = ExecutionConfig.builder()
                .timeout(Duration.ofMinutes(10))        // 工具执行最多等10分钟
                .maxAttempts(2)                         // 最多重试1次
                .initialBackoff(Duration.ofSeconds(3))
                .retryOn(error -> error instanceof java.io.IOException) // 仅网络错误时重试
                .build();

        // === 构建 Agent，分别指定模型和工具的执行配置 ===
        ReActAgent agent = ReActAgent.builder()
                .name("RobustAgent")
                .sysPrompt("You are a reliable assistant.")
                .model(DashScopeChatModel.builder()
                        .apiKey(apiKey)
                        .modelName("qwen-plus")
                        .stream(true)
                        .build())
                .modelExecutionConfig(modelConfig)   // 模型调用的超时重试
                .toolExecutionConfig(toolConfig)     // 工具调用的超时重试
                .build();

        Msg msg = Msg.builder()
                .textContent("你是谁，现在几点了？")
                .build();

        return Objects.requireNonNull(agent.call(msg).block()).getTextContent();
    }
}
```

除了 ExecutionConfig，底层 HTTP 客户端还有独立的传输超时（HttpTransportConfig）：

```text
import io.agentscope.core.model.transport.HttpTransportConfig;

HttpTransportConfig httpConfig = HttpTransportConfig.builder()
        .connectTimeout(Duration.ofSeconds(10))  // 连接超时 10秒
        .readTimeout(Duration.ofMinutes(3))      // 读取超时 3分钟
        .writeTimeout(Duration.ofSeconds(30))    // 写入超时 30秒
        .build();

DashScopeChatModel model = DashScopeChatModel.builder()
        .apiKey(apiKey)
        .modelName("qwen-plus")
        .transportConfig(httpConfig)   // 传输层超时
        .build();
```

执行控制

AgentScope Java 提供了三层执行控制机制：**迭代次数限制**、**安全中断**、**优雅关机**。

**迭代次数限制**

控制 ReAct 循环（Reasoning → Acting → Reasoning → ...）的最大轮次。达到上限后自动进入 Summary 阶段生成总结。

```text
ReActAgent agent = ReActAgent.builder()
        .name("BoundedAgent")
        .sysPrompt("You are a helpful assistant.")
        .model(model)
        .maxIters(5)   // 最多5轮 Reasoning-Acting 循环，默认值为10
        .build();
```

**安全中断**

用户或系统可以在任意时刻中断正在执行的 Agent。中断后 Agent 会保留完整上下文（包括内存中的对话和未完成工具调用），并返回恢复消息。

**中断源（****InterruptSource****）**：

- USER — 用户主动中断（如点击"停止"按钮）
- TOOL — 工具执行逻辑触发中断（如工具检测到需要人工确认）
- SYSTEM — 系统触发（超时、资源限制、优雅关机等）

```
import io.agentscope.core.ReActAgent;
import io.agentscope.core.memory.InMemoryMemory;
import io.agentscope.core.message.Msg;
import io.agentscope.core.message.MsgRole;
import io.agentscope.core.message.TextBlock;
import io.agentscope.core.tool.Tool;
import io.agentscope.core.tool.ToolEmitter;
import io.agentscope.core.tool.ToolParam;
import io.agentscope.core.tool.Toolkit;

public class InterruptionDemo {

    public static void main(String[] args) throws Exception {
        String apiKey = System.getenv("DASHSCOPE_API_KEY");

        // 注册一个耗时工具
        Toolkit toolkit = new Toolkit();
        toolkit.registerTool(new SlowTools());

        ReActAgent agent = ReActAgent.builder()
                .name("DataAgent")
                .sysPrompt("You are a data processing assistant. "
                        + "Use the process_large_dataset tool to process datasets.")
                .model(DashScopeChatModel.builder()
                        .apiKey(apiKey).modelName("qwen-max").stream(false).build())
                .toolkit(toolkit)
                .memory(new InMemoryMemory())
                .maxIters(10)
                .build();

        // 用户请求
        Msg userMsg = Msg.builder()
                .role(MsgRole.USER)
                .content(TextBlock.builder()
                        .text("Process the 'orders' dataset with 'aggregate' operation.")
                        .build())
                .build();

        // 在单独线程启动 Agent
        Thread agentThread = new Thread(() -> {
            Msg response = agent.call(userMsg).block();
            System.out.println("[Agent] " + response.getTextContent());
        });
        agentThread.start();

        // 等 2 秒后中断 Agent
        Thread.sleep(2000);
        System.out.println(">>> USER INTERRUPTS <<<");

        // 携带中断消息（可选）
        Msg interruptMsg = Msg.builder()
                .role(MsgRole.USER)
                .content(TextBlock.builder()
                        .text("Stop! I need to change parameters.")
                        .build())
                .build();
        agent.interrupt(interruptMsg);

        agentThread.join();
        System.out.println("Memory size: " + agent.getMemory().getMessages().size());
    }

    // 模拟耗时工具
    public static class SlowTools {
        @Tool(name = "process_large_dataset",
              description = "Process a large dataset (takes a long time)")
        public String processLargeDataset(
                @ToolParam(name = "dataset_name") String name,
                @ToolParam(name = "operation") String op,
                ToolEmitter emitter) {

            for (int i = 1; i <= 10; i++) {
                try { Thread.sleep(500); }
                catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return "Processing interrupted at " + (i * 10) + "%";
                }
                // 通过 ToolEmitter 发射中间进度
                emitter.emit(ToolResultBlock.text("Progress: " + (i * 10) + "%"));
            }
            return "Done processing " + name;
        }
    }
}
```

**优雅关机**

适用于服务器部署场景（如 Spring Boot 应用收到kill -15）。系统会等待当前正在执行的 Agent 请求完成或达到超时后安全终止，并自动保存会话状态。

关键配置 GracefulShutdownConfig：

```text
import io.agentscope.core.shutdown.*;
import java.time.Duration;

// 配置优雅关机策略
GracefulShutdownConfig config = new GracefulShutdownConfig(
        Duration.ofSeconds(30),            // 关机超时：最多等30秒
        PartialReasoningPolicy.SAVE        // 未完成的推理结果：保存到Session
        // 另一个选项: PartialReasoningPolicy.DISCARD 丢弃不完整结果
);

GracefulShutdownManager.getInstance().setConfig(config);
```

**关机时的安全检查点**（在这些点位 Agent 才会被中断）：

- PostReasoningEvent — 推理完成后
- PostActingEvent — 工具执行完成后
- PostSummaryEvent — 总结生成完成后

这意味着系统不会粗暴截断正在进行的推理或工具调用，而是等当前阶段完整结束后再发起中断。只有当全局超时耗尽时，才会强制中断。

```
import io.agentscope.core.shutdown.*;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import jakarta.annotation.PreDestroy;
import java.time.Duration;

@Configuration
public class AgentShutdownConfig {

    @Bean
    public GracefulShutdownManager shutdownManager() {
        GracefulShutdownManager manager = GracefulShutdownManager.getInstance();
        manager.setConfig(new GracefulShutdownConfig(
                Duration.ofSeconds(30),
                PartialReasoningPolicy.SAVE
        ));
        return manager;
    }

    @PreDestroy
    public void onShutdown() {
        GracefulShutdownManager manager = GracefulShutdownManager.getInstance();
        
        // 触发优雅关机
        manager.performGracefulShutdown();
        
        // 等待所有请求完成或超时
        boolean terminated = manager.awaitTermination(Duration.ofSeconds(35));
        if (terminated) {
            System.out.println("All agent requests completed gracefully.");
        } else {
            System.out.println("Shutdown timed out, some requests were force-interrupted.");
        }
    }
}
```

通过实现 Hook 接口可以在 Agent 生命周期的各个阶段插入自定义逻辑，包括阻止工具执行、修改输入、记录日志等：

```
import io.agentscope.core.hook.*;
import reactor.core.publisher.Mono;

public class ExecutionMonitorHook implements Hook {

    @Override
    public <T extends HookEvent> Mono<T> onEvent(T event) {
        if (event instanceof PreCallEvent pre) {
            System.out.println("[Monitor] Agent call started");

        } else if (event instanceof PreActingEvent preAct) {
            // 可以在这里拦截工具调用！
            String toolName = preAct.getToolUse().getName();
            System.out.println("[Monitor] About to call tool: " + toolName);
            // 例如：拦截危险工具
            // preAct.skipTool("Operation not permitted");

        } else if (event instanceof PostActingEvent postAct) {
            System.out.println("[Monitor] Tool completed: " + postAct.getToolUse().getName());

        } else if (event instanceof PostCallEvent post) {
            System.out.println("[Monitor] Agent call finished");

        } else if (event instanceof ErrorEvent err) {
            System.err.println("[Monitor] Error: " + err.getError().getMessage());
        }

        return Mono.just(event);
    }

    @Override
    public int priority() {
        return 100; // 数字越小优先级越高
    }
}

// 注册到 Agent
ReActAgent agent = ReActAgent.builder()
        .name("MonitoredAgent")
        .model(model)
        .hooks(List.of(new ExecutionMonitorHook()))
        .build();
```

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a06cab151b14400019d0fc6
