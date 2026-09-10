---
title: "✅AgentScope Java特性：工具集成"
---

# ✅AgentScope Java特性：工具集成

我们最开始讲ASJ的时候的case中就演示了使用Toolkit来实现工具的集成，工具使用是Agent的必备技能。我们这一节再展开介绍下ASJ种的工具集成的相关能力和实现。

工具定义的方式

**基于@Tool注解**

在ASJ中，工具定义的方式有很多种，我们前面演示过最简单的基于注解的方式：

```text
public class SimpleTools {
    @Tool(name = "get_time", description = "获取当前时间")
    public String getTime(
            @ToolParam(name = "zone", description = "时区，例如：北京") String zone) {
        return java.time.LocalDateTime.now()
                .format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
    }
}
```

使用@Tool和 @ToolParam组合，来定义工具。@Tool用来声明一个具体的工具，用在方发生，@ToolParam用来定义工具的参数。

方法返回值可以是 String、Mono&lt;String&gt;、ToolResultBlock、Mono&lt;ToolResultBlock&gt;，或任意可 JSON 序列化的对象（框架自动用 DefaultToolResultConverter 转为 JSON）

实现 AgentTool 接口

除了基于注解外，我们还可以通过实现AgentTool 接口的方式来定义一个工具：

```text
public interface AgentTool {

  
    String getName();

   
    String getDescription();

  
    Map<String, Object> getParameters();

    
    default Map<String, Object> getOutputSchema() {
        return null;
    }

    Mono<ToolResultBlock> callAsync(ToolCallParam param);
}
```

这几个方法看名字就知道是干嘛的了。需要注意的是getParameters这个方法，很多人会不知道该怎么写，我们可以通过内置的工具实现看看他如何定义，如ShellCommandTool中的实现。基本需要以下格式和字段：

```text
    @Override
    public Map<String, Object> getParameters() {
        return Map.of(
            "type", "object",
            "properties", Map.of(
                "command", Map.of("type", "string", "description", "The shell command to execute")
            ),
            "required", List.of("sql")
        );
    }
```

这个 Map 最终序列化为 JSON 放入 LLM API 请求的 tools[].function.parameters。模型会据此约束自己生成的参数。如果使用 strict = true，模型严格按照 schema 生成（无多余字段、类型完全匹配）。

**和 ****@Tool**** 注解方式的对比**：注解式由框架通过反射+@ToolParam 自动生成这个 Map；接口式需要你手动构造，但获得了完全的自由度——你可以做动态 schema（比如根据运行时状态决定有哪些参数）。

还有getOutputSchema()这个方法，用来定义输出的schema的，大多数工具不需要定义输出 schema。这个方法主要为 **MCP 工具**设计——MCP 协议允许 server 声明工具的输出结构。框架里 McpTool 覆写了此方法来暴露 MCP server 提供的 outputSchema。

callAsync(ToolCallParam param)这个方法就是执行的入口了。这个是天然异步的接口。

内置的工具

ASJ中内置了一些工具，可以供开发者直接使用，这些工具的定义也分别使用了上面的工具定义的方式。有使用注解的，也有实现AgentTool接口的。这些工具定义在io.agentscope.core.tool下面。

- ReadFileTool/WriteFileTool
- 通过注解实现，实现文件的读写功能。
- ShellCommandTool
- 基于AgentTool接口实现，实现shell命令的执行。
- SubAgentTool
- 基于AgentTool接口实现，提供把子agent当做tool的能力
- OpenAiMultiModalTool/DashScopeMultiModalTool
- 通过注解实现，提供多模态工具，提供文生图、图生文、文生视频、文本转语音、语音转文本、视频理解等能力。
- McpTool
- 基于AgentTool接口实现，作为MCP的协议桥接，通过该工具调用远程的服务。
- SchemaOnlyTool
- 基于AgentTool接口实现。callAsync直接抛ToolSuspendException异常，让模型知道某个工具的存在（从而可以决定调用它），但工具的实际执行不在框架内发生。用来实现HIL、外部审批等。

（另外，还有一些工具不在这个tool包下，但是也算默认实现，比如后面我们RAG这里需要用到的KnowledgeRetrievalTools）

AgentTool这种形式更加灵活，比如用在Schema不确定的场景，如McpTool 的参数**来自远程 MCP Server**——你根本没法在编译时写注解，因为参数是什么取决于对面那个进程。所以它必须自己实现 getParameters()，把远端拿到的 inputSchema 原样返回。

注册工具到 Toolkit

有了工具定义之后，需要通过ToolKit来包装工具，然后把ToolKit传给Agent

```text
Toolkit toolkit = new Toolkit();
toolkit.registerTool(new SimpleTools());

ReActAgent jarvis = ReActAgent.builder()
                .toolkit(toolkit)
                .build();
```

工具组

工具多了之后，一次性全塞给模型会导致 schema 过长、模型选错工具。Tool Group 的设计是：把工具按功能分组，只有active 状态的组才对模型可见。利用工具组可以实现：

- 权限控制：根据用户角色激活不同工具
- 场景切换：不同对话阶段使用不同工具集
- 性能优化：减少 LLM 可见的工具数量

```text
// 创建分组（默认 active=true）
toolkit.createToolGroup("file_ops", "File system operations", false);  // 初始不激活
toolkit.createToolGroup("math_ops", "Math calculations", false);

// 注册工具到分组
toolkit.registration().tool(new FileTools()).group("file_ops").apply();
toolkit.registration().tool(new MathTools()).group("math_ops").apply();

// 运行时激活/停用
toolkit.updateToolGroups(List.of("file_ops"), true);   // 激活
toolkit.updateToolGroups(List.of("math_ops"), false);  // 停用
```

工具执行上下文 —— ToolExecutionContext

如果在调用工具的时候，有一些参数想要直接传给工具，而如果不需要模型来决策参数传递的话，可以用ToolExecutionContext。典型用途是：注入当前用户信息、数据库连接、Session 上下文。

```text
// 定义上下文对象
public class UserContext {
    private String userId;
    private String role;
    // getters...
}

// 注册上下文
ToolExecutionContext context = ToolExecutionContext.builder()
    .register(new UserContext("user_123", "admin"))
    .build();

// 绑定到 toolkit
Toolkit toolkit = new Toolkit(ToolkitConfig.builder()
    .defaultContext(context)
    .build());

// 工具方法中通过类型自动注入
@Tool(name = "get_profile")
public String getProfile(UserContext ctx) {  // ★ 框架自动注入，不在 schema 里
    return "User: " + ctx.getUserId() + ", Role: " + ctx.getRole();
}
```

工具流式进度 —— ToolEmitter

长如果遇到耗时工具可以在执行过程中发射中间进度，前端 UI 或监控 Hook 可以实时展示。注意：**emit 的内容不进入模型上下文**，只有最终 return 值才喂给 LLM。

```text
@Tool(name = "analyze_data", description = "Analyze large dataset")
public String analyzeData(
        @ToolParam(name = "dataset") String dataset,
        ToolEmitter emitter) {   // ★ 框架自动注入，不需要 @ToolParam

    emitter.emit(ToolResultBlock.text("Loading dataset..."));
    loadData(dataset);

    emitter.emit(ToolResultBlock.text("Processing 50%..."));
    processHalf();

    emitter.emit(ToolResultBlock.text("Processing 100%..."));
    processAll();

    return "Analysis complete: 1000 records processed, 3 anomalies found.";
}
```

工具调用流程

```text
用户消息 → ReActAgent.call()
    │
    ├─ 1. 构造 messages + tools schema → 送模型
    │
    ├─ 2. 模型返回 ToolUseBlock（可能多个）
    │       {name: "get_weather", input: {city: "Beijing"}}
    │
    ├─ 3. Toolkit.callTools(toolUseBlocks, config, agent, context)
    │       │
    │       ├─ ToolExecutor.executeAll()
    │       │   ├─ 并行/串行分发
    │       │   ├─ 每个 tool: 合并预设参数 → 注入上下文 → callAsync()
    │       │   ├─ 超时/重试由 ExecutionConfig 控制
    │       │   └─ 返回 List<ToolResultBlock>
    │       │
    │       └─ ToolResultBlock 回填到 memory（作为 ToolResultBlock 消息）
    │
    ├─ 4. 继续推理（带工具结果的 messages → 模型）
    │
    └─ 5. 模型生成最终回复 或 继续调用更多工具（循环，受 maxIters 限制）
```

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a06c769c71a8900012b370b
