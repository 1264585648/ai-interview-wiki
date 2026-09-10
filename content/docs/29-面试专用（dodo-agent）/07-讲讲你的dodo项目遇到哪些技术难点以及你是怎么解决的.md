---
title: "✅讲讲你的dodo项目遇到哪些技术难点，以及你是怎么解决的?"
---

# ✅讲讲你的dodo项目遇到哪些技术难点，以及你是怎么解决的?

深度研究 Agent 的 Plan-Execute-Critique 循环控制

**问题是什么：** 深度研究场景下，Agent 需要自主规划研究任务、并行执行、然后自我反思结果是否充分。**难点在于这个循环不可控——Critique 阶段如果判断太宽松，研究深度不够就提前结束了；如果太严格，又会反复循环浪费 token，甚至陷入死循环。**另外，Plan 阶段生成的任务之间有依赖关系，有的可以并行、有的必须串行，怎么编排执行顺序也是个问题。

**怎么解决的：** 第一，任务编排上，我让 LLM 生成带 order 字段的 PlanTask 列表，相同 order 的任务并行执行，不同 order 按序串行。并行执行用 Semaphore(3) 控制并发度防止过载，用 CountDownLatch 保证同一批次全部完成后才进入下一批。每个子任务由独立的 SimpleReactAgent 执行，自带 Tavily 搜索工具。

第二，Critique 质量上，我用结构化输出 CritiqueResult(passed, feedback) 强制 LLM 给出明确的通过/不通过判断和具体反馈，而不是开放式文本。feedback 会作为下一轮 Plan 的输入，引导规划方向。同时设了 maxRounds=3 的硬上限兜底，防止无限循环。

第三，上下文管理上，多轮循环会导致上下文快速膨胀。我做了专门的压缩逻辑：只保留最新一轮的 Critique 反馈（历史的 Critique 已经过时了），提取 Task Result 块做摘要而非保留原始搜索结果，当总字符数超过 50K 时触发 LLM 摘要压缩。

**效果：** 最终这个 Agent 能完成 3 轮以内的自主研究迭代，对复杂问题（比如"对比分析 A 和 B 的技术选型"）能生成结构化的研究报告，而不是一次性的浅层回答。

Agent 多轮对话的上下文爆炸

**问题是什么：** Agent 跟普通聊天不同，每一轮可能包含多个 Tool 调用和返回结果，一个搜索结果动辄几千 token，三四轮对话后上下文就容易超过模型的 context window。直接截断会丢失关键信息，全部保留又会超限或者推理质量下降（模型对超长上下文中间部分关注度低）。

**怎么解决的：** 我设计了两层压缩策略。

第一层是 micro_compact，每轮执行。核心思路是：旧的 Tool 返回结果在后续推理中的价值递减，但 Tool 的名称和调用参数仍有上下文意义。所以我把超过 4 轮之前的 Tool 响应内容替换为一个 JSON 占位符（只保留 tool name 和摘要），同时把超过 200 字符的 Tool 参数截断。但有些关键 Tool（比如 "Skill" 加载的提示词）是不能压缩的，通过 protectedTools 集合保护。

第二层是 auto_compact，当 token 总量超过阈值（60K）时触发。这里有个前提——需要一个准确的 token 估算器。我没有简单用字符数除以 4，而是做了 CJK 感知：中文大约 1.5 字符一个 token，ASCII 大约 4 字符一个 token，这样对中英混合的上下文估算更准确。超阈值后，把所有非系统消息发给 LLM 做结构化摘要，摘要替换原消息后继续对话。如果摘要调用本身失败了，降级为截断保留最近 10 条消息。

**效果：** 这套方案让 SkillsReactAgent 可以在一个会话中执行 10+ 轮的复杂任务（涉及多次文件读写、搜索、代码执行），而不会因为上下文超限崩溃。两层策略的好处是 micro_compact 代价低、高频执行，auto_compact 代价高但极少触发，整体成本可控。

流式 Tool Calling 的参数拼接与并行执行

**问题是什么：** Spring AI 默认的 Tool 执行机制是 internalToolExecutionEnabled(true)，框架自动处理 Tool 调用。但这有几个限制：无法控制并行度（默认可能是串行执行）、无法在流式场景下做自定义的错误处理、也无法插入执行前后的事件通知（比如给前端发"正在调用工具"的状态）。所以我关了内部执行，自己实现。

难点在于流式场景下，LLM 返回的一个 Tool Call 的 arguments 字段会分散在多个 SSE chunk 中，你需要正确拼接。同时 LLM 一次可能返回多个 Tool Call，它们之间可以并行执行，但最终返回给 LLM 的 Tool Response 顺序必须跟原始 Tool Call 顺序一致。

**怎么解决的：** 参数拼接：我用一个 Map 按 toolCallId 缓存每个 Tool Call 的 chunk。每收到一个 chunk，找到对应的 toolCallId，把 arguments 拼接到已有内容后面。通过检测 chunk 中的 finish 标记判断这个 Tool Call 是否完整。所有 chunk 处理完后，得到完整的 Tool Call 列表。

并行执行：把所有 Tool Call 提交到 Schedulers.boundedElastic() 并行执行，结果放入 ConcurrentHashMap&lt;toolCallId, ToolResponse&gt;。用一个 AtomicInteger 计数已完成的数量，全部完成后，按原始 Tool Call 的顺序从 Map 中取出结果，组装成单条 ToolResponseMessage。

错误处理：单个 Tool 执行失败不会中断整个循环，而是把错误信息序列化为 JSON 作为该 Tool 的响应返回给 LLM，让 LLM 决定如何处理（重试、换一个 Tool、或者告诉用户失败了）。

**效果：** 多个独立的 Tool 调用可以并行执行，比如同时搜索 3 个不同关键词，整体耗时从串行的 9 秒降到 3 秒左右。而且单 Tool 失败不会影响整个 Agent 循环的稳定性。

分布式场景下的任务管理与跨实例取消

**问题是什么：** 系统要支持水平扩展部署多个实例。用户发起一个 Agent 任务（可能持续几十秒甚至几分钟），期间如果用户点击"停止"，请求可能路由到不同的实例。核心问题是：怎么让"停止"操作能跨实例生效？同时，同一个会话不能有两个实例同时处理（否则会话历史会冲突）。

**怎么解决的：** 任务注册（分布式互斥）：用 Redis 的 trySet() 原子操作，key 是 agent:task:&#123;conversationId&#125;，value 是持有任务的实例标识，TTL 30 分钟。trySet() 只在 key 不存在时成功，这就保证了同一会话只有一个实例能注册任务。如果注册失败，直接拒绝请求返回"任务正在处理中"。

跨实例取消：用 Redisson 的 RTopic（Redis Pub/Sub）。每个实例启动时订阅 stop topic，收到消息后检查是不是自己持有的任务，如果是就执行本地的取消操作（dispose Reactor 的 Disposable + complete Sink）。当用户点停止时，先检查本地有没有这个任务——有就直接本地取消（快路径）；没有就查 Redis 看任务在哪个实例，通过 Pub/Sub 广播停止消息。

TTL 刷新：长任务的 TTL 可能过期（30分钟），一旦过期锁就释放了，其他实例可能重复注册。我用一个 ScheduledExecutor 每 5 分钟遍历本地任务列表，刷新 Redis key 的 TTL。

**效果：** 多实例部署下，任务互斥和跨实例取消都能正常工作。面试时可以补充一点：这个方案的局限是 Redis Pub/Sub 是 fire-and-forget 的，如果目标实例当时断连了会丢消息。改进方向可以用 Redis Stream 或者加一个轮询兜底。

PPT 生成流水线的断点续跑

**问题是什么：** PPT 生成是一个 8 阶段的长流程（需求采集→模板选择→大纲生成→联网搜索→Schema 构建→Python 渲染→完成/失败），整个过程可能需要几分钟。任何一步都可能失败——网络超时、LLM 返回格式不对、Python 渲染脚本报错。如果每次都从头开始，用户体验很差。

**怎么解决的：** 我用状态机 + 策略模式来实现。每个阶段对应一个状态和一个 Strategy 实现类。状态转换时，先把新状态持久化到 MySQL 的 ai_ppt_inst 表，再执行该阶段的逻辑。这样即使中途崩溃，数据库里记录的也是最后成功进入的状态。

用户再次发起 PPT 相关请求时，PptIntentRecognizer 会先检查有没有未完成的 PPT 实例。如果有，识别为 RESUME_PPT 意图，直接从数据库记录的断点状态开始执行，而不是从头走 INIT 流程。

策略模式的另一个好处是，每个阶段是独立的类，新增或修改某个阶段不会影响其他阶段。比如后来加了一个"联网搜索补充素材"的阶段，只需要新增一个 SearchStrategy 并调整状态转换规则。

**效果：** 实际使用中，渲染阶段偶尔会因为 Python 环境问题失败，用户重新触发时直接从 RENDER 阶段重试，不需要重新走需求、大纲、Schema 等耗时步骤。

Skills 插件体系的"Tool vs Skill"语义区分

**问题是什么：**在Skill出来之后，我们的Agent需要支持SKill，Skills 体系的设计目标是让 Agent 能按需加载领域知识（比如"如何生成 PPT"、"如何操作 Excel"），这些知识以 SKILL.md 文件的形式存在，包含 YAML frontmatter（元数据）和 Markdown 正文（操作指令）。但这里有一个概念上的难题：LLM 需要理解 Skill 和 Tool 的区别——Tool 是直接调用的（比如搜索、读文件），Skill 是"先加载提示词，再按提示词使用其他 Tool"的两步过程。如果 LLM 混淆两者，就会试图"调用"一个 Skill 当 Tool 用，或者把 Tool 当 Skill 去加载提示词。

**怎么解决的：** 我在 Skill 的 Tool 描述（description）里显式解释了两者的区别和使用流程：

"Skills are different from tools. Tools are functions you call directly. Skills are instruction sets that you must first load, then follow step by step using other tools."

加载流程设计为：Agent 启动时，系统扫描 skills 目录下的所有 SKILL.md 文件，解析 frontmatter 提取 name 和 description，注册为一个名为 "Skill" 的 FunctionToolCallback。LLM 看到的 Tool 列表里只有一个 "Skill" 工具，参数是 skill name。当 LLM 判断需要某个 Skill 时，调用 Skill(name="pptx")，系统返回该 Skill 的完整提示词和工作目录路径，LLM 然后按提示词的指令使用其他 Tool（比如 write_file、bash 等）来完成任务。

另外，SKILL.md 的 description 字段非常关键——它是 LLM 判断"要不要加载这个 Skill"的唯一依据。我在 description 里写了明确的触发条件，比如"Use when the user wants to create .pptx files"，避免 LLM 在不相关的场景下误加载。

**效果：** LLM 能正确区分何时用 Tool、何时加载 Skill，在实测中没有出现混淆。新增一个 Skill 只需要写一个 SKILL.md 文件放到指定目录，不需要改代码。

MCP 协议集成与 Tool 生命周期管理

**问题是什么：** 项目通过 MCP（Model Context Protocol）接入 Tavily 搜索服务。MCP 是一个相对新的协议，Spring AI 的 MCP Client 还在快速迭代中。集成过程中遇到了几个问题：MCP Server 的连接管理（什么时候建连、什么时候断连）、Tool Callback 的生命周期（跟 Agent 一致还是全局共享）、以及 MCP 调用的超时处理（网络搜索可能很慢）。

**怎么解决的：** 连接管理上，我在 AgentController 启动时（@PostConstruct）创建 MCP 的 HttpClientStreamableHttpTransport，配置 Bearer Token 认证和 300 秒超时，构建 McpSyncClient。这个 Client 作为全局单例，所有需要联网搜索的 Agent 共享同一组 ToolCallback，而不是每个 Agent 各自建连。超时设了 300 秒是因为搜索+结果返回的端到端时间可能较长，宁可多等也不要误超时。

ToolCallback 的生命周期上，我用 SyncMcpToolCallbackProvider 把 MCP Client 包装成 Spring AI 的 ToolCallback[]，在 Agent 构建时通过 .tools() 注入。因为 Callback 本身是无状态的（只负责转发调用），所以全局共享是安全的。

**效果：** MCP 集成的好处是搜索能力可以独立部署和升级，不需要改 Agent 代码。面试时可以补充对 MCP 协议本身的看法——它定义了 Tool 发现、调用、结果返回的标准协议，让 Agent 和外部能力的对接更规范，类似 USB 协议对设备的意义。

Agent 每请求实例化与状态管理的矛盾

**问题是什么：** 当前架构中，每次用户请求都会在 Controller 里 new 一个新的 Agent 实例（initWebSearchAgent()、initFileAgent() 等），Agent 的 Builder 在 build() 时校验必要依赖。BaseAgent 上有不少实例级可变状态：currentSessionId、currentConversationId、startTime、usedTools 等。这个设计在单实例部署下能工作，但如果水平扩展，同一个会话的前后请求可能路由到不同实例，Agent 实例上的状态就丢了。

**怎么分析：** 本质上这是一个"请求级状态"和"会话级状态"混在一起的问题。startTime、usedTools 是请求级的，每次请求独立，放 Agent 实例上没问题。但 currentSessionId、currentConversationId 以及 ChatMemory 中的消息列表是会话级的，需要跨请求持久化。

**怎么解决的：** 会话级状态已经做了外置：ChatMemory 通过 MySQL 持久化（每次对话从 ai_session 表加载历史消息，对话结束后写回），Session 信息也在 MySQL 中。所以即使请求路由到不同实例，只要从数据库加载就能恢复上下文。

请求级状态保持在 Agent 实例上是安全的，因为一次请求的完整处理都在同一个实例内完成（SSE 流式响应期间连接不会转移）。

AgentTaskManager 用 Redis 保证了同一会话不会被两个实例同时处理，避免了并发状态冲突。

**面试可以延伸讨论：** 如果要做到真正的无状态扩展，可以把 Agent 的构建逻辑做成工厂模式，从 Spring Bean 获取共享依赖（ChatModel、ToolCallbacks），只把请求级状态注入。更进一步可以用 Spring AI 的 ChatClient 作为无状态的共享 Bean，把 sessionId 作为方法参数传入而不是放在实例字段上。

Java + Python 混合架构的跨语言调用

**问题是什么：** PPT 的最终渲染步骤用 Python 实现（render_ppt.py，基于 python-pptx 库），因为 Java 生态里操作 PPTX 的库（Apache POI）对复杂布局和样式的支持不够灵活。Java 侧通过 ProcessBuilder 调用 Python 脚本，传参走命令行参数和 JSON 文件，结果走 stdout。跨语言调用的难点是：Python 环境依赖不可控（目标机器不一定装了 python-pptx）、进程超时管理、错误信息的跨语言传递。

**怎么解决的：** 环境管理上，Python 脚本开头做了依赖检查，缺少 python-pptx 时给出明确的错误信息而不是一个模糊的 ImportError。Java 侧捕获 stderr 输出，解析 Python 的错误信息并转换为结构化的错误响应返回给前端。

超时控制上，用 Process.waitFor(timeout, TimeUnit) 设置渲染超时。超时后先 destroy()（SIGTERM），给 Python 进程几秒清理时间，再 destroyForcibly()（SIGKILL）。

文件传递上，Java 把 Schema JSON 写到临时文件，Python 读取后渲染 PPTX 到指定输出路径，Java 再从输出路径读取上传到 MinIO。避免了命令行参数过长的问题（PPT 的 Schema 可能有几十 KB）。

**效果：** Java 负责业务编排（状态机流转、数据持久化），Python 负责擅长的领域（PPTX 渲染），各司其职。面试时可以补充：如果不想依赖 Python 环境，可以考虑用 GraalVM 的 polyglot 能力或者把 Python 渲染做成独立的微服务。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a49dfedd31fed0001b71b54
