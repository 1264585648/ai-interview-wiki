---
title: "✅AgentScope Java特性：MCP接入"
---

# ✅AgentScope Java特性：MCP接入

MCP我们前面有专门的章节介绍过了，他是 Anthropic 提出的开放协议，定义了"AI 应用"和"工具服务"之间的标准通信接口。核心思想是：

AI Agent（MCP Client） ←──MCP协议──→ Tool Server（MCP Server）

- MCP Server 暴露工具列表 + 执行入口
- MCP Client 负责发现工具、生成 schema 给 LLM、调用执行。

定义MCP Client（连接MCP Server）

ASJ实现的是 **MCP Client 端**——让你的 Agent 可以连接任意符合 MCP 协议的 Tool Server。

McpClientBuilder

McpClientBuilder通过名字你就能看出来，他是MCP Client的构造器。用它就能构造一个mcp client。通过McpClientBuilder.create(name)，他支持三种传输层：

```
// StdIO 传输：启动子进程，通过 stdin/stdout 通信
McpClientWrapper wrapper = McpClientBuilder.create("filesystem")
    .stdioTransport("npx", List.of("-y", "@anthropic/mcp-filesystem"))
    .buildAsync()
    .block();

// SSE 传输：连接远程 HTTP Server 的 SSE 端点
McpClientWrapper wrapper = McpClientBuilder.create("remote-tools")
    .sseTransport("http://localhost:8080/mcp/sse")
    .header("Authorization", "Bearer token123")
    .buildAsync()
    .block();

// Streamable HTTP 传输：新版 MCP 推荐的双向 HTTP 流
McpClientWrapper wrapper = McpClientBuilder.create("cloud-tools")
    .streamableHttpTransport("https://api.example.com/mcp")
    .header("X-API-Key", "key123")
    .queryParam("version", "v2")
    .buildAsync()
    .block();
```

**buildAsync()**** 内部做了什么：**

1. 根据选择的传输类型创建底层 Transport 对象
2. 建立连接（StdIO = 启动子进程；SSE/HTTP = HTTP 握手）
3. 发送 MCP 协议的 initialize 请求（交换 capabilities）
4. 调用 tools/list 获取远端所有工具定义
5. 为每个工具定义创建 McpToolDefinition 对象
6. 包装为 McpClientWrapper 返回

所以 buildAsync() 返回时，工具列表已经拉取完毕。

通过McpClientBuilder得到的是一个McpClientWrapper，那么这个McpClientWrapper是啥呢？

McpClientWrapper

McpClientWrapper其实是是对底层 MCP Client 的封装，职责是：

- **持有连接状态**（transport 实例、session 信息）
- **缓存工具列表**（从 tools/list 获取的 List&lt;McpToolDefinition&gt;）
- **提供工具调用入口**：callTool(name, arguments) → Mono&lt;McpCallToolResult&gt;
- **生命周期管理**：close() 关闭连接/杀子进程

```text
public class McpClientWrapper {
    private final String name;              // 客户端标识（如 "filesystem"）

    protected final Map<String, McpSchema.Tool> cachedTools;


    public abstract Mono<McpSchema.CallToolResult> callTool(
            String toolName, Map<String, Object> arguments);


    /**
     * Lists all tools available from this MCP server.
     *
     * @return a Mono emitting the list of available tools
     */
    public abstract Mono<List<McpSchema.Tool>> listTools();

    /**
     * Invokes a tool on the MCP server.
     *
     * @param toolName the name of the tool to call
     * @param arguments the arguments to pass to the tool
     * @return a Mono emitting the tool call result
     */
    public abstract Mono<McpSchema.CallToolResult> callTool(
            String toolName, Map<String, Object> arguments);

    /**
     * Gets a cached tool definition by name.
     *
     * @param toolName the name of the tool
     * @return the tool definition, or null if not found
     */
    public McpSchema.Tool getCachedTool(String toolName) {
        return cachedTools.get(toolName);
    }
}
```

McpClientWrapper提供了三个具体的实现：

![](assets/88841b07de46.png)

- **McpAsyncClientWrapper（推荐使用）**
- 封装 MCP SDK 的 McpAsyncClient，所有操作返回 Reactor Mono/Flux，支持响应式异步执行。
- 不阻塞线程，适合高并发、WebFlux 应用等需要非阻塞 I/O 的场景
- McpSyncClientWrapper
- 封装 MCP SDK 的 McpSyncClient，所有操作阻塞式执行。
- 适合简单场景、命令行工具、批处理任务等不需要高并发的场景
- HigressMcpClientWrapper
- 专门用于对接 Higress AI 网关 的 MCP 客户端实现。
- 工具治理（鉴权、限流、路由、可观测）下沉到网关层，Agent 只负责调用

注册MCP工具

Toolkit.registerMcpClient() 方法，用来注册MCP工具

```text
import io.agentscope.core.tool.Toolkit;

Toolkit toolkit = new Toolkit();

// 注册 MCP 服务器的所有工具
toolkit.registerMcpClient(mcpClient).block();
```

具体注册的实现是在io.agentscope.core.tool.McpClientManager#registerMcpClient中实现的。其实就是针对McpClientManager.listTools得到的所有的tool，循环创建对应的McpTool，并完成工具注册。（具体代码在下面的McpTool介绍部分）

一个 McpClientWrapper 可能对应多个工具（一个 MCP Server 可以暴露多个工具）。注册后，这些工具在 ToolRegistry 里和本地工具地位完全平等——模型看到的是统一的 tools 列表，无法区分哪些是本地执行、哪些通过 MCP 远程调用。

有了这个ToolKit之后，就可以和其他工具集成一样，把他配置到Agent中就行了：

```text
ReActAgent agent = ReActAgent.builder()
        .name("Assistant")
        .model(model)
        .toolkit(toolkit) 
        .build();
```

McpTool

McpTool看到这个眼不眼熟？上一节我们讲工具集成的时候就介绍过这个tool，ASJ中的Agent会通过McpTool来把MCP当做工具调用。

这里比较大的区别就是，McpTool单独实现了getOutputSchema这个方法，而这个方法在其他的Tool中是默认返回null的：

![](assets/4966d369e104.png)

这里面的outputSchema是通过构造函数传进来的，调用来源就是前面我们提到的McpClientManager#registerMcpClient。

![](assets/208883e73dd6.png)

Demo

我们通过ASJ作为客户端 ，调用一下我们之前通过spring ai定义的MCP Server：

```text
package cn.hollis.llm.llmentor.agentscope.demo;

import io.agentscope.core.ReActAgent;
import io.agentscope.core.memory.InMemoryMemory;
import io.agentscope.core.message.Msg;
import io.agentscope.core.model.DashScopeChatModel;
import io.agentscope.core.tool.Toolkit;
import io.agentscope.core.tool.mcp.McpClientBuilder;
import io.agentscope.core.tool.mcp.McpClientWrapper;

import java.time.Duration;

/**
 * AgentScope 调用 MCP Server (SSE) 的示例。
 * <p>
 * 前置条件：先启动 mcp-server-sse 模块（端口 8003），提供天气查询工具 getWeather。
 * <p>
 * 本示例通过 AgentScope 的 McpClientBuilder 以 SSE 方式连接到 MCP Server，
 * 然后注册其暴露的工具（getWeather），让 ReActAgent 能够自动调用该工具来回答天气相关问题。
 */
public class McpClientDemo {

    public static void main(String[] args) {
        String apiKey = "sk-dcebc45c03b04c6e85391abb2264e594";

        // 1. 通过 SSE 传输方式连接到 MCP Server（mcp-server-sse 模块，端口 8003）
        McpClientWrapper mcpClient = McpClientBuilder.create("weather-mcp")
                .sseTransport("http://127.0.0.1:8003/sse")
                .timeout(Duration.ofSeconds(30))
                .buildAsync()
                .block();

        System.out.println("✅ 已成功连接到 MCP Server (SSE)");

        // 2. 创建 Toolkit 并注册 MCP 客户端中的所有工具
        Toolkit toolkit = new Toolkit();
        toolkit.registerMcpClient(mcpClient).block();

        // 打印已注册的工具
        System.out.println("📦 已注册的工具列表: " + toolkit.getToolNames());

        // 3. 创建 ReActAgent，配置模型与工具
        ReActAgent agent = ReActAgent.builder()
                .name("WeatherAssistant")
                .sysPrompt("你是一个天气助手，可以帮用户查询各个城市的天气信息。请使用工具来获取天气数据。")
                .model(DashScopeChatModel.builder()
                        .apiKey(apiKey)
                        .modelName("qwen-max")
                        .build())
                .toolkit(toolkit)
                .memory(new InMemoryMemory())
                .build();

        // 4. 发送消息，让 Agent 调用 MCP 工具查询天气
        System.out.println("\n--- 第1轮对话 ---");
        Msg msg1 = Msg.builder()
                .textContent("北京今天天气怎么样？")
                .build();
        Msg reply1 = agent.call(msg1).block();
        System.out.println("用户: 北京今天天气怎么样？");
        System.out.println("Agent: " + reply1.getTextContent());

        // 第2轮对话 - 查询另一个城市
        System.out.println("\n--- 第2轮对话 ---");
        Msg msg2 = Msg.builder()
                .textContent("深圳呢？")
                .build();
        Msg reply2 = agent.call(msg2).block();
        System.out.println("用户: 深圳呢？");
        System.out.println("Agent: " + reply2.getTextContent());

        // 5. 清理资源
        toolkit.removeMcpClient("weather-mcp").block();
        System.out.println("\n🔌 已断开 MCP 连接");
    }
}
```

先把McpServerSseApplication启动，然后再运行以上代码，得到输出如下：

![](assets/ba57daec83bb.png)

选择性激活工具

如果你不想把一个MCP的所有工具都注册到你的agent中，怕浪费上下文的话，也可以选择性注册。

```text
List<String> enableTools = List.of("read_file", "list_directory");
List<String> disableTools = List.of("write_file");

toolkit.registration().mcpClient(mcpClient).enableTools(enableTools).disableTools(disableTools).apply();
```

通过enableTools指定你要启用的工具，通过disableTools来指定你不要启动的工具。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a06c785a7c8ff0001bdefa7
