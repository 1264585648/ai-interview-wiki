---
title: "✅外部能力集成 — MCP 与 Skill"
---

# ✅外部能力集成 — MCP 与 Skill

（本期无视频，内容前面也都讲过，文档再总结一下）

一个只会聊天的 LLM 是没有价值的，它必须能查天气、查签证、搜航班、订酒店、开发票——这些都是「外部能力」。在 gogo-agent 里，接入外部能力有两条截然不同的路径：

- **MCP（Model Context Protocol）**：把外部服务包装成一个标准协议的「工具服务器」，框架用 McpClientWrapper 直接跟它对话（启动子进程走 stdio，或走 HTTP）。工具的名字、入参 schema 由 MCP 服务器自己声明，框架自动把它们变成 LLM 可直接调用的原生工具。**协议化、强类型、框架托管连接**。
- **Skill（技能）**：把「如何使用某个外部能力」写成一篇 Markdown 操作手册（含参考文档、脚本），放进技能仓库；运行期让模型按需加载这篇手册，然后通过一个受限的 ShellCommandTool 去执行 CLI 命令或 curl 调用。**文档化、灵活、模型自主 shell-out**。

一句话概括这两者在本工程里的取舍：**能拿到标准 MCP 服务器、且工具集稳定的，走 MCP；需要复杂多步骤操作、依赖成熟 CLI、或想让模型「看着手册干活」的，走 Skill。** 下面分别拆解。

MCP 接入：两个客户端，两种传输

gogo-agent 里只有两个 MCP 客户端 Bean，恰好演示了 MCP 的两种主流传输方式。

stdio 传输：Orizn 签证 MCP

签证查询接的是开源的 orizn-visa-mcp，通过 npx 拉起一个本地 Node 子进程，用标准输入输出通信：

```text
@Bean(name = "oriznVisaMcpClient")
public McpClientWrapper oriznVisaMcpClient() {
    // 解析 args（默认 -y,orizn-visa-mcp）
    List<String> args = ...;

    // 构造子进程环境变量：注入 ORIZN_API_KEY（未配置则走免费模式）
    Map<String, String> env = new HashMap<>();
    if (apiKey != null && !apiKey.isBlank()) {
        env.put("ORIZN_API_KEY", apiKey);
    }

    McpClientWrapper client = McpClientBuilder.create("orizn-visa-mcp")
            // stdio 传输：启动 npx -y orizn-visa-mcp 进程
            .stdioTransport(command, args, env)
            .timeout(Duration.ofSeconds(requestTimeoutSeconds))         // 工具调用超时 30s
            .initializationTimeout(Duration.ofSeconds(initializationTimeoutSeconds)) // 握手 20s
            .buildAsync()
            .block();
    return client;

    // catch: 初始化失败返回 null —— 优雅降级为内部 RAG 签证知识库
}
```

关键设计点：

- **认证靠环境变量注入**：MCP 服务器的鉴权不写在应用逻辑里，而是把 ORIZN_API_KEY 塞进子进程 env。配了 key 解锁完整工具集，不配就是免费模式（只暴露两个工具）。
- **.block()**** 阻塞构建**：MCP 客户端在 Spring 启动阶段就完成进程拉起 + 协议握手，保证 Bean 就绪即可用。
- **失败返回 ****null**** + ****@Autowired(required = false)**：这是本工程 MCP 接入最值得学的一点——MCP 是外部依赖，npx 不在 PATH、握手超时都可能发生。返回 null 让 Agent 侧 @Nullable 字段优雅降级（签证退回内部 RAG 知识库），**绝不让一个外部服务挂掉拖垮整个应用启动**。

Streamable HTTP 传输：天气 MCP（远程网关）

天气 MCP 走阿里云市场的 MCP 网关，用 Streamable HTTP：

```text
McpClientWrapper client = McpClientBuilder.create("weather-mcp")
        .streamableHttpTransport(weatherMcpEndpoint)   // http://mcpservergateway.../...
        .timeout(Duration.ofSeconds(30))
        .initializationTimeout(Duration.ofSeconds(15))
        .buildAsync()
        .block();
// 失败同样返回 null 降级
```

endpoint 里嵌了 AppCode token（Base64 段），认证信息直接编码在 URL 里。同样是失败降级模式。

把 MCP 挂到 Agent

MCP 客户端由具体 Agent 在 build() 里注册到 Toolkit。以 InfoAgent 为例：

```text
toolkit.registration().mcpClient(weatherMcpClient).enableTools(weatherMcpEnabledTools).apply();
toolkit.registration().mcpClient(oriznVisaMcpClient).enableTools(oriznMcpEnabledTools).apply();
```

enableTools(...) 是**工具白名单**，这是 MCP 接入的安全阀门。一个 MCP 服务器可能暴露几十个工具，但我们只想放开其中几个：

```text
# application.yml
app:
  weather-mcp:
    endpoint: http://mcpservergateway.../...
    enabled-tools: 城市天气实况,城市15日预报,城市天气预警,城市空气实况,城市24小时预报,城市40日预报
  orizn-mcp:
    command: ${ORIZN_MCP_COMMAND:npx}
    args: ${ORIZN_MCP_ARGS:-y,orizn-visa-mcp}
    api-key: ${ORIZN_API_KEY:orizn_visa_...}
    enabled-tools: ${ORIZN_MCP_ENABLED_TOOLS:quick_visa_check,check_visa_requirement}
```

白名单从 BaseSubAgent 的 @Value 字段读入，Spring 自动按逗号切成 List&lt;String&gt;：

```text
@Autowired(required = false) @Qualifier("weatherMcpClient") @Nullable
protected McpClientWrapper weatherMcpClient;

@Value("${app.weather-mcp.enabled-tools:}")
protected List<String> weatherMcpEnabledTools;
```

注册 MCP 客户端的只有 **InfoAgent** 和 **ItineraryPlanAgent** 两个；BookingAgent 不注册任何 MCP。

Skill 接入：把「怎么用外部能力」写成手册

第二条路径是 AgentScope 的 SkillBox。它不直接连服务，而是给模型一本操作手册 + 一把受限的「命令行钥匙」。

技能仓库：ClasspathSkillRepository

技能仓库在 TravelAgentConfig 里装配，根据配置的路径前缀选择 classpath 还是文件系统实现：

```text
@Bean
public AgentSkillRepository fileSystemSkillRepository(
        @Value("${travel.skill.path:classpath:skills}") String skillPath) throws IOException {
    if (skillPath.startsWith("classpath:")) {
        return new ClasspathSkillRepository(skillPath.substring("classpath:".length()));
    }
    return new FileSystemSkillRepository(Path.of(skillPath));
}
```

默认 classpath:skills → 加载 src/main/resources/skills/ 下的技能目录。这个仓库以 skillRepository 字段注入到所有 Agent。

SkillBox 构建：注册技能 + 一把受限的 Shell

ItineraryPlanAgent 构建它的规划技能盒：

```text
private SkillBox buildPlanningSkillBox(Toolkit toolkit) {
    SkillBox skillBox = new SkillBox(toolkit);
    skillBox.registerSkill(skillRepository.getSkill("tuniu-cli"));   // 注册途牛技能
    ShellCommandTool shellTool = new ShellCommandTool(
            null,
            // 白名单命令集 —— 只允许这些命令，其余一律拒绝
            Set.of("curl", "npm", "tuniu", "rgh", "nohup", "sleep",
                    "cat", "grep", "node", "date", "env", "which", "bash", "ls"),
            null);
    skillBox.codeExecution().withShell(shellTool).withRead().withWrite().enable();
    return skillBox;
}
```

BookingAgent 也构建 SkillBox 并同样注册 tuniu-cli，但它的 shell 白名单**更窄**（只有 tuniu, env, bash, cat, grep, date, which, ls，去掉了 curl / npm / node / rgh）：

**设计信号**：规划阶段要搜航班/酒店/搜网页，命令面宽；下单阶段只跟途牛 CLI 打交道，命令面收窄。**最小权限原则贯穿到 shell 命令粒度**——这是 Skill 路径的核心安全边界，因为一旦给了 shell 就等于给了执行能力，白名单是唯一的护栏。

SkillBox 通过 builder 挂到 ReActAgent：.skillBox(skillBox)。

懒加载：load_skill_through_path + 内容折叠

技能手册往往很长（一个 SKILL.md 加若干 references/*.md），全塞进上下文是浪费。所以 SkillBox 提供内置工具 load_skill_through_path，让模型**用到时才加载**对应的参考文档。system prompt 会强制这条纪律：

```text
# itinerary-plan-agent-system.md 节选
懒加载搜索技能（重要）：必须在本步骤开始时才通过 `load_skill_through_path` 加载
```

更进一步，SkillContentCollapseHook（priority 6）在 PreReasoningEvent 里做「内容折叠」：当某个 load_skill_through_path 的结果已经是 6 条消息以前的旧内容时，就在**这一轮的 LLM 输入里**把冗长的 SKILL.md 正文替换成一句占位提示（告诉模型怎么重新加载）。它只改当轮输入、不动 memory，是无状态的。这样既省 token，又保证模型需要时能重新拉回全文。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a5a081074e4030001e47a62
