---
title: "✅天气查询工具/MCP的接入"
---

# ✅天气查询工具/MCP的接入

市面上关于天气相关的工具有很多，但是要么就有限制，要么就要收费。

gogo-agent 首选的 wttr.in 是一个开箱即用、无需 API Key 的免费天气服务，但它只能给出**今天起 3 天内**（今天 + 未来 2 天）的预报。而差旅场景恰恰经常要查更远的日期——「我下周三去成都出差，那天天气怎么样」。这时候 wttr.in 就无能为力了。

要覆盖更远的日期，就得上付费服务。gogo-agent 选了阿里云云市场上的一个天气 MCP，它支持 15 日预报、40 日预报、天气预警、空气质量等更丰富的能力，但**按调用量收费**。

于是设计者做了一个很务实的取舍：**不要让付费 MCP 承担所有查询，而是让免费的 wttr.in 打头阵，只有当它够不着（日期超出 3 天）时才把请求交给付费 MCP。** 这样既保证了「查明天天气」这种高频需求零成本，又能兜住「查下周天气」的长尾需求。

这就形成了一个双通道结构：

![](assets/aa7088398791.png)

**两条通道之间的「交接」不是代码里 if-else 判断出来的，而是靠工具返回值里的一个 ****beyond_range**** 信号，让模型自己在下一轮推理时决定改调 MCP。** 这是 Agent 编排和传统后端编排最不一样的地方——路由逻辑外置给了 LLM。下面逐层看真实实现。

通道一：原生免费工具 query_weather

第一条通道是一个普通的 Spring @Component 里的 @Tool 方法，走 WebClient 直连 wttr.in（[https://wttr.in/](https://wttr.in/) ）。文件在 DestinationLiveTools.java。

**常量与数据源**

```text
@Component
public class DestinationLiveTools {

    /** wttr.in：免费天气 API，无需 API Key，直接按城市名查询 */
    private static final String WEATHER_API_BASE = "https://wttr.in/";

    /** wttr.in 支持的最大预报天数（今天起算） */
    private static final int WEATHER_FORECAST_DAYS = 2;

    /** 天气查询 HTTP 请求超时（秒） */
    private static final int WEATHER_REQUEST_TIMEOUT_SECONDS = 8;
```

WEATHER_FORECAST_DAYS = 2 就是那道「3 天窗口」的边界（今天 + 2 天）。它既用于日期预检，又写进了工具描述里给模型看——这个数字是整个双通道设计的支点。

**工具描述：把「什么时候该换通道」写给模型看**

@Tool 的 description 是模型选择工具的唯一依据。这里的写法非常关键：

```text
@Tool(name = "query_weather",
      description = "联网查询目的地城市的天气信息（首选工具，免费）。"
              + "支持今天及未来 2 天（共 3 天）的天气预报；"
              + "若 date 超出此范围，工具会返回 beyond_range=true，Agent 应改用 weather-mcp 工具查询。"
              + "不指定 date 则返回当前天气 + 未来 3 天全量预报。"
              + "每日预报包含最高/最低温度和逐 3 小时天气（温度、降雨概率、风速、状况描述）。"
              + "支持中文城市名（如 北京、上海）和英文城市名（如 Tokyo、Paris）。")
public String queryWeather(
        @ToolParam(name = "city", description = "目标城市，如 北京、上海、杭州、Tokyo、Paris") String city,
        @ToolParam(name = "date",
                   description = "查询日期，YYYY-MM-DD 格式，如 2026-07-15；"
                           + "仅支持今天及未来 2 天（wttr.in 限制），超出范围会提示改用 weather-mcp；"
                           + "可选，不填则返回全量 3 天预报",
                   required = false) String date) {
```

注意描述里明确写了两件事：**「首选工具，免费」**（引导模型优先选它）+ **「超出范围会返回 ****beyond_range=true****，应改用 weather-mcp」**（预告交接协议）。模型在读工具清单时就已经知道了这套规则，等真拿到 beyond_range 信号时才不会懵。

**日期预检：够不着就返回交接信号，根本不发请求**

方法一进来先做日期范围检查，超出窗口直接返回信号，连 wttr.in 都不打——省一次网络往返：

```text
// ── 日期范围预检：超出 today+2 则直接返回 beyond_range 信号 ──────────────
LocalDate targetDate = parseDate(date);
if (targetDate != null) {
    LocalDate maxDate = LocalDate.now().plusDays(WEATHER_FORECAST_DAYS);
    if (targetDate.isAfter(maxDate)) {
        logger.info("[TOOL][query_weather] 日期 {} 超出 wttr.in 范围，提示使用 weather-mcp", date);
        JSONObject beyond = new JSONObject();
        beyond.put("city", city);
        beyond.put("date", date);
        beyond.put("beyond_range", true);
        beyond.put("message",
                date + " 超出 wttr.in 支持范围（仅今天起 3 天内）。"
                        + "请立即改用 maps_weather 工具查询该日期的天气预报。");
        return JSON.toJSONString(beyond);
    }
}
```

这段返回的 JSON 就是**通道交接的全部载体**。它不抛异常、不返回错误，而是返回一个结构化的「我不行，你去找 MCP」的语义信号。模型下一轮推理读到 beyond_range:true + message，就会去调 weather-mcp 的工具。

通道二：付费 MCP weather-mcp

先订购一下天气通的服务： [https://market.aliyun.com/detail/cmapi00074002?spm=5176.29867242_210807074.0.0.44e83e7ejbr5q0](https://market.aliyun.com/detail/cmapi00074002?spm=5176.29867242_210807074.0.0.44e83e7ejbr5q0)  （可以先试用，跑通流程就行）

订购后，切换到MCP的tab下，点击生成MCP URL，把steamableHttpUrl这个地址替换到配置文件中的WEATHER_MCP_ENDPOINT

![](assets/87c46c71ad00.png)

这条通道是一个真正的 MCP 客户端，用 McpClientBuilder 构建，走 **Streamable HTTP** 传输连到阿里云云市场网关。文件在 WeatherMcpConfig.java。

**完整配置类**

```text
@Configuration
public class WeatherMcpConfig {

    private static final Logger logger = LoggerFactory.getLogger(WeatherMcpConfig.class);

    /** MCP 工具调用请求超时（秒） */
    private static final int MCP_REQUEST_TIMEOUT_SECONDS = 30;
    /** MCP 初始化握手超时（秒） */
    private static final int MCP_INIT_TIMEOUT_SECONDS = 15;

    /**
     * 天气 MCP Streamable HTTP 端点，从配置文件读取。
     * 配置项：app.weather-mcp.endpoint
     */
    @Value("${app.weather-mcp.endpoint}")
    private String weatherMcpEndpoint;

    @Bean(name = "weatherMcpClient")
    public McpClientWrapper weatherMcpClient() {

        logger.info("[WeatherMcp] 初始化 天气 MCP 客户端 (Streamable HTTP)...");

        try {
            McpClientWrapper client = McpClientBuilder.create("weather-mcp")
                    // Streamable HTTP 传输
                    .streamableHttpTransport(weatherMcpEndpoint)
                    // 工具调用请求超时
                    .timeout(Duration.ofSeconds(MCP_REQUEST_TIMEOUT_SECONDS))
                    // MCP 初始化握手超时
                    .initializationTimeout(Duration.ofSeconds(MCP_INIT_TIMEOUT_SECONDS))
                    .buildAsync()
                    .block();

            logger.info("[WeatherMcp] 天气 MCP 客户端初始化成功");
            return client;

        } catch (Exception e) {
            logger.warn("[WeatherMcp] 天气 MCP 客户端初始化失败，超过 3 天的天气查询将不可用。原因：{}",
                    e.getMessage());
            return null;
        }
    }
}
```

工具白名单：只暴露 6 个差旅核心工具

这个云市场 MCP 声明了很多工具（POI 天气、经纬度天气、生活指数……），但差旅场景用不上那么多。yml 里用白名单只放行 6 个：

```text
weather-mcp:
  # 天气 MCP 工具白名单（逗号分隔的工具名称）
  # 当前选定 6 个差旅核心工具（省略 POI/经纬度类、长期预报、生活指数等）：
  enabled-tools: 城市天气实况,城市15日预报,城市天气预警,城市空气实况,城市24小时预报,城市40日预报
```

*白名单的价值在于****省 Token****：MCP 的每个工具 schema 都要塞进模型的上下文，工具越多前缀越长、每轮推理越贵。只暴露必要的 6 个，既减少 Token 消耗，也降低模型选错工具的概率。注意白名单****不是在 builder 上设的****，而是在 Agent 注册*工具时通过 .enableTools(...) 施加的（见下一节）。

两条通道装配到同一个 Agent

两条通道最终都注册进 InfoAgent 的同一个 Toolkit，模型看到的是一张统一的工具清单。

```text
@Bean(name = "infoAgent")
@Scope("prototype")
public ReActAgent build() {
    Toolkit toolkit = new Toolkit();

    toolkit.createToolGroup(TOOL_CIRCUIT_BREAKER_GROUP, TOOL_CIRCUIT_BREAKER_GROUP, true);

    toolkit.registration().tool(infoQueryTools).apply();
    toolkit.registration().tool(policyTools).apply();
    // 通道一：原生 query_weather 所在的 DestinationLiveTools，放进熔断组
    toolkit.registration().tool(destinationLiveTools).group(TOOL_CIRCUIT_BREAKER_GROUP).apply();
    // 通道二：weather-mcp，按白名单暴露工具
    toolkit.registration().mcpClient(weatherMcpClient).enableTools(weatherMcpEnabledTools).apply();
    toolkit.registration().mcpClient(oriznVisaMcpClient).enableTools(oriznMcpEnabledTools).apply();
    // ...
}
```

对应的依赖注入在共享基类 BaseSubAgent 里，用 @Autowired(required = false) + @Nullable 兜住「MCP 降级为 null」的情况：

```text
@Autowired(required = false)
@Qualifier("weatherMcpClient")
@Nullable
protected McpClientWrapper weatherMcpClient;

/** 天气 MCP 工具白名单（从 app.weather-mcp.enabled-tools 读取），Spring 自动按逗号拆成 List */
@Value("${app.weather-mcp.enabled-tools:}")
protected List<String> weatherMcpEnabledTools;
```

这里有个细节：weatherMcpClient 为 null 时，toolkit.registration().mcpClient(null).enableTools(...).apply() 需要能安全跳过——这正是 §3.1 优雅降级返回 null 能成立的前提。required = false 保证 Spring 注入 null 不报错，注册链路再对 null 做容错，两头配合才让「付费 MCP 挂了应用照跑」真正闭环。

顺带说明，同样这套装配在 ItineraryPlanAgent（行程规划 Agent）里也复现了一遍——它同样注册了 weatherMcpClient + destinationLiveTools，因为规划行程时也要看目的地天气。两个 Agent 共享同一个 weatherMcpClient 单例 Bean。

提示词约束

为了让Agent能够在行程规划时考虑到天气、新闻等因素，我们需要在提示词中告知他要做这方面的考虑。

```text
## 规则

（信息收集、已审批单/上下文提取、出发地 base 地、追问用户等规则见上文「核心前提」，此处不再重复。）

1. **途经点优先**：审批单或用户描述中提到的具体到访地点必须纳入行程，酒店、餐饮、市内交通围绕途经点安排。
2. **先获取用户偏好、差旅政策和出发地、目的地环境**，再生成方案（以下查询应并行执行，不额外消耗迭代轮次）：
   - `preferences` = `retrieve_from_memory` 召回的真实偏好（舱位/品牌/时段/避红眼/房型等都是用户个人化的），自由文本非 JSON
   - `policy` = `query_travel_policy(destination)` 拿到的差旅政策
   - **天气**：分别调用 `query_weather` 查询**出发地和目的地**的出差日期天气；若出差日期超出 3 天范围，改用「城市15日预报」或「城市40日预报」工具
   - **资讯**：分别调用 `query_destination_news(topic=traffic)` 查询**出发地和目的地**的交通管制、限行等出行资讯
   - 若长期记忆无相关偏好，`preferences` 一律传空字符串 `""` 表示"无偏好约束"
   - **天气和资讯结果必须用于后续方案设计**：
     - **出发地或目的地天气恶劣**（暴雨/大雾/大风/雷暴/雾霾）时，**优先选择高铁而非飞机**——恶劣天气易导致航班延误或取消，高铁受天气影响较小、准点率更高
     - 出发地和目的地天气均良好时，按正常偏好和价格因素选择交通方式
     - 出发地有限行/交通管制时，提醒用户提前出发或选择地铁前往机场/车站
     - 目的地有交通管制/限行时，调整到达后的市内交通方案或出行时间，在方案中提醒用户
     - 有重大展会/赛事时提醒用户酒店可能紧张，建议尽早预订
```

并且在最终的输出的方案中也可以包含一些天气提示给到用户

````text
```markdown
## 🗂️ 差旅行程方案（上海 → 杭州，2026-07-16 去 / 2026-07-18 返）

### 🏆 推荐方案 · 综合最佳
> **为什么是它**：在通过审核的方案里综合分最高（85），总价最低、总耗时最短，去程是你偏好的早班直飞。
> **🌤️ 天气提醒**：上海 多云，28-35°C；杭州 多云转小雨，26-33°C。出发地天气良好适合飞行，目的地有小雨建议携带雨具，户外活动安排在上午。
````

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a622be3c71a89000182d099
