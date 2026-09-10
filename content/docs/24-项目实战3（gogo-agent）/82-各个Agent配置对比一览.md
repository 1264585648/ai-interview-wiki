---
title: "✅各个Agent配置对比一览"
---

# ✅各个Agent配置对比一览

一、全局模型配置（ModelConfig）

| 模型 Bean | 底层模型 | 思考模式 | 单价(元/百万Token) | 用途定位 |
| --- | --- | --- | --- | --- |
| `fastModel` | qwen3.6-flash | 关闭 | 1.2 | 轻量快速任务 |
| `strongModel` | qwen3.7-max | 关闭 | 12 | 通用主力（@Primar） |
| `strongModelWithThinking` | qwen3.7-max | **开启** | 12 | 复杂推理任务 |
| `stableModel` | glm-5.1 | 关闭 | 6 | 稳定/低成本任务 |

---

二、核心 Agent 对比总表

| 维度 | MasterAgent | ItineraryPlanAgent | ItineraryManageAgent | BookingAgent | InfoAgent | ItineraryReviewAgent | IntentRecognitionAgent | QueryRewritingAgent | ReimbursementAgent |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Agent类型** | ReActAgent | ReActAgent | ReActAgent | ReActAgent | ReActAgent | ReActAgent | AgentBase | AgentBase | ReActAgent(待实现) |
| **最大迭代** | 15 | 15 | 10 | 10 | 5 | 8 | 1 | 1 | — |
| **工具超时** | **15 分钟** | 默认(1分钟) | 默认(1分钟) | 默认(1分钟) | 默认(1分钟) | 默认(1分钟) | — | — | — |
| **thinking_budget** | — | 2048 | — | 2048 | — | — | — | — | — |
| **cacheControl** | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — |

---

三、工具（Tools）配置对比

| Agent | 注册工具数 | 具体工具集 | 特殊能力 |
| --- | --- | --- | --- |
| **MasterAgent** | 1+4 SubAgent | `UserInteractionTools`<br>+ SubAgent: itinerary_manage /itinerary_plan / info / booking | 主动询问用户(<br>`ask_user`) |
| **ItineraryPlanAgent** | 10+ | policyTools, travelOrderRead, bookingRead, userInfoRead/Write, apiKeyTools, destinationLiveTools(熔断组), itineraryPlannerTool, weatherMcpClient, oriznVisaMcpClient,<br>**SubAgent: itinerary_review_agent** | tuniu-cli 技能, Shell 命令工具,<br>**并行工具执行** |
| **ItineraryManageAgent** | 8 | travelOrderWrite/Read, bookingRead/Write, policyTools,<br>**travelOrderConflictTools**<br>, userInfoRead/Write | 冲突检测 |
| **BookingAgent** | 6+Skills | travelOrderRead, bookingRead, bookingWrite, userInfoRead/Write, apiKeyTools | tuniu-cli 技能(机票/火车/酒店下单), Shell 命令工具 |
| **InfoAgent** | 4 | policyTools, destinationLiveTools(熔断组), weatherMcpClient, oriznVisaMcpClient | **RAG 知识库**<br>(景点/政策/指南) |
| **ItineraryReviewAgent** | 2 | policyTools, itineraryReviewTools | 六维结构化审核 |
| **IntentRecognitionAgent** | 0 | 无工具调用 | 三层路由(L1规则→L2向量→L3 LLM) |
| **QueryRewritingAgent** | 0 | 无工具调用 | 指代消除/多轮融合 |

---

四、记忆（Memory）配置对比

| Agent | 短期记忆 | 长期记忆 | RAG知识库 | 记忆模式 |
| --- | --- | --- | --- | --- |
| **MasterAgent** | AutoContextMemory | ✅ LongTermMemory(AGENT_CONTROL) | — | Agent自主读写偏好 |
| **ItineraryPlanAgent** | AutoContextMemory | ✅ LongTermMemory(AGENT_CONTROL) | — | Agent自主读写偏好 |
| **ItineraryManageAgent** | AutoContextMemory | — | — | — |
| **BookingAgent** | AutoContextMemory | ✅ LongTermMemory(AGENT_CONTROL) | — | 记录联系人偏好 |
| **InfoAgent** | AutoContextMemory | — | ✅ attraction + policy + guidelines | RAGMode: AGENTIC |
| **ItineraryReviewAgent** | AutoContextMemory | ✅ LongTermMemory(AGENT_CONTROL) | — | — |
| **IntentRecognitionAgent** | — | — | — | 无状态 |
| **QueryRewritingAgent** | — | — | — | 无状态 |

---

五、Hooks 配置对比

| Hook | Master | Plan | Manage | Booking | Info | Review | Intent | Rewrite |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DynamicTimeInjection | — | ✅ | ✅ | ✅ | ✅ | — | — | — |
| AutoContextHook | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| CliResultCompress | — | ✅ | — | ✅ | ✅ | — | — | — |
| ToolCircuitBreaker | — | ✅ | — | — | ✅ | — | — | — |
| FlightApiKeyHook | — | ✅ | — | ✅ | — | — | — | — |
| TuniuApiKeyHook | — | ✅ | — | ✅ | — | — | — | — |
| RghUserIsolationHook | — | ✅ | — | ✅ | — | — | — | — |
| SkillContentCollapseHook | — | ✅ | — | ✅ | — | — | — | — |
| PlanAwareThinkingHook | — | ✅ | — | — | — | — | — | — |
| SessionPersistence | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — |
| ExecutionLogger | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| ProgressNotifier | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| ActiveAgentPersistence | ✅ | ✅ | ✅ | ✅ | — | — | ✅ | ✅ |
| BookingPersistence | — | — | — | ✅ | — | — | — | — |
| PendingToolRecovery | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — |
| **Hook总数** | **6** | **13** | **7** | **12** | **8** | **3** | **3** | **3** |

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a60c46d51b1440001f3945c
