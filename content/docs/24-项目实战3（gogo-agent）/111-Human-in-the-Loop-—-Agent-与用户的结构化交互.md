---
title: "✅Human-in-the-Loop — Agent 与用户的结构化交互"
---

# ✅Human-in-the-Loop — Agent 与用户的结构化交互

一个 ReAct Agent 的循环可以粗暴地理解成流水线上的一个工人：**想一下（reasoning）→ 伸手拿工具（acting）→ 看工具给的结果 → 再想一下**，直到能交活为止。所有工具调用都遵循同一个契约：模型发出一个 ToolUseBlock（"我要调 X，参数是这些，这次调用的编号是 toolUseId"），框架执行完塞回一个 ToolResultBlock（"编号 toolUseId 的调用结果是这些"），循环继续。

Human-in-the-Loop（下文简称 HITL）做的事，是把"问用户"也塞进这个契约里：**"问用户"就是一次工具调用，只不过这个工具的执行者是人**。工人伸手去拿的那个零件，暂时没人递给他，于是他举手停机；等人把零件递过来（用户在前端点了选项），编号一对上，工人从举手的那一刻原地继续干，前面想过的东西一点没丢。

这个比喻里有两个容易被忽略的点，恰好是这套机制最难的部分：

第一，**"停机"不能是线程阻塞**。用户可能三十秒回，也可能三十分钟不回，甚至永远不回。如果用一个 CountDownLatch 把 Tomcat 线程挂住，几十个并发就能把线程池吃干净。所以停机必须是"响应式流正常结束 + 状态外置"——本轮 HTTP 请求干干净净地结束，等待这件事由**外部存储**记着。

第二，**"零件递回来"的那个请求，未必落在同一个进程上**。集群部署下，发起提问的是 A 节点，用户点完选项，负载均衡可能把 /respond 打到 B 节点。B 节点内存里什么都没有，它必须能从共享存储里知道"是谁在等、等的是哪一次调用"，然后把那个 Agent 重新造出来、把历史记忆装回去、再续跑。

带着这两点往下看。。。

为什么HILP

最朴素的做法是：让子智能体在回复正文里写一句"请问您从哪个城市出发？"，然后这一轮就正常结束。用户看到这句话，在输入框里打"上海"，下一轮当作一条全新的用户消息重新进流水线。

gogo-agent 里**这条路径确实存在，而且是子智能体的默认做法**。itinerary-manage-agent-system.md 写得很直白：

```text
4. 信息不完整时，**直接在回复中向用户提问**，每次只追问最关键的一到两个问题；问题必须清晰具体，并说明为什么需要这个信息。
```

这条路径够用，但有三个明显的代价。

**第一，用户要打字，而且打得对不对全凭运气。** 差旅场景里大量的提问其实是封闭的：出发日期是个日期，出差目的地是从几个城市里选一个，"是否确认提交审批"是个是/否。让用户手打，既慢又容易给出系统解析不了的答案（"下下周吧，具体哪天你看着办"）。

**第二，上下文会被整轮丢弃再重建。** 如果按"新一轮消息"处理，用户的"上海"这两个字要重新走一遍问题改写、意图识别、主智能体路由，然后主智能体还得从历史里推断出"哦，上海是在回答刚才那个出发城市的问题"。这一整套重推理，既费 token 又容易推错——尤其当用户回答的是"确认"这种脱离上下文就完全没有信息量的词。

**第三，也是最关键的：主智能体没有办法把"我在等一个具体答案"这件事表达出来。** 它只能输出一段文字，然后这一轮就结束了。前端不知道该渲染输入框还是渲染单选框，也不知道该不该把输入框锁上防止用户岔开话题。

HITL 要解决的就是这三件事：**把提问变成一次带结构（问题 + 控件类型 + 选项）的、有编号的、可以被精确回填的工具调用**。用户看到的是一张可以点的卡片而不是一段要读的文字；系统拿到的是一个能对上 toolUseId 的答案而不是一句需要重新理解的自然语言；Agent 从暂停点继续，而不是从头再来。

具体实现

整条链路可以拆成两个方向：

**Agent → 用户**：工具抛异常 → 框架标记挂起 → 状态落盘 → SSE 推事件 → 前端渲染卡片。

**用户 → Agent**：前端提交 → /api/chat/respond → 解析 Agent 实例 → 构造 ToolResultBlock → 续跑。

先讲从Agent → 用户这条链路。

UserInteractionTools

UserInteractionTools.java 是整套机制的起点，它注册了一个工具，但这个工具的方法体只有两行，而且必定抛异常：

```text
public class UserInteractionTools {

    public static final String TOOL_NAME = "ask_user";                     // L48
    // ... @Tool 注解与 6 个 @ToolParam 省略，见下 ...
            Boolean allowOther) {
        String reason = question != null ? question : "Waiting for user input";
        throw new ToolSuspendException(reason);                            // L116
    }
}
```

ToolSuspendException 是 AgentScope 为这类"由外部执行的工具"提供的标准信号，表示"这次工具调用的结果暂时拿不到，请把它挂起"。框架接住它之后，会把这次调用转成一个 **pending 状态的 ****ToolResultBlock**，并让本轮返回的 Msg 带上 GenerateReason.TOOL_SUSPENDED。

入参一共六个，全部用 @ToolParam 显式声明名字：

```text
public String askUser(
        @ToolParam(name = "question", description = "The question to ask the user")
        String question,
        @ToolParam(
                name = "ui_type",
                description =
                        "UI component type: text, select, multi_select, confirm, form,"
                        + " date, number. Defaults to 'text'.",
                required = false)
        String uiType,
        @ToolParam(
                name = "options",
                description =
                        "Options for select/multi_select. Simple string array,"
                        + " e.g. [\"Beijing\", \"Shanghai\", \"Tokyo\"]",
                required = false)
        List<String> options,
        @ToolParam(
                name = "fields",
                description =
                        "Field definitions for 'form' ui_type. Array of objects with"
                        + " name, label, type (text/number/date/select/textarea),"
                        + " placeholder, required, options, min, max, step.",
                required = false)
        List<Map<String, Object>> fields,
        @ToolParam(
                name = "default_value",
                description = "Default value for the input field (string only)",
                required = false)
        Object defaultValue,
        @ToolParam(
                name = "allow_other",
                description =
                        "If true, adds an 'Other' option with a free-text input so"
                        + " users can enter custom values not in the predefined"
                        + " list. Use with select or multi_select.",
                required = false)
        Boolean allowOther) {
    String reason = question != null ? question : "Waiting for user input";
    throw new ToolSuspendException(reason);
}
```

值得注意的是 ui_type 这个字段的定位：**它不是后端的枚举，而是给前端看的渲染指令**。(后面会讲）

**这个工具的方法中，我们定义的参数好像并没有被用到啊。那他的作用是啥呢？又是如何起作用的呢？**

1、虽然工具的参数没有在工具的代码中被用到，但是这些参数LLM是看到了并且传递了的。因为LLM要调用这个工具的。

2、框架在调用 Java 方法之前，需要把这些参数保存到了 ToolUseBlock 的 input 字段里。然后才把参数反序列化并传入 Java 方法。

3、方法抛出 ToolSuspendException 后，ReActAgent 把 ToolUseBlock（带着 input）一起返回。

4、然后通过`toolUse.getInput()` 把内容取出来，并返回给前端。

取`toolUse.getInput()`的逻辑在这里：

任务挂起处理

当Agent执行UserInterationTools被挂起返回后，第一个接住 TOOL_SUSPENDED 的是 ChatAgentExecutor.handleAgentResult

```text
private boolean handleAgentResult(Agent agent, Msg result, SseEmitter emitter,
                                  String sessionId, String userId) {
    if (result.getGenerateReason() == GenerateReason.TOOL_SUSPENDED) {
        ToolUseBlock toolUse = sseNotifier.extractAskUserToolUse(result);
        if (toolUse != null) {
            String agentName = agent != null ? agent.getName() : "MasterAgent";
            // 省略：本地缓存（同节点快速恢复）；
            
            // 持久化到共享 Session（集群任意节点恢复）
            pendingToolSessionStore.save(sessionId, agentName, toolUse.getId(),
                    UserInteractionTools.TOOL_NAME);
            sseNotifier.sendUserInteraction(emitter, result, sessionId);
            return true;
        }
    }
    //...
}
```

首先判断是否触发了TOOL_SUSPENDED，如果是的话，主要干2件事：

**1、将 ask_user 暂停状态持久化到共享 Session——>****`pendingToolSessionStore.save`**

**2、提取 ask_user 工具参数，并推送给前端——> ****`sseNotifier.sendUserInteraction`**

**`pendingToolSessionStore.save`**就是会在数据库中保存一条记录，这条记录长这样，这样在用户反馈了内容之后，即使请求没有落到同一台机器上，也能从数据库中获取到之前的暂停状态，方便后续持续推进。

| 字段名 | 值 |
| --- | --- |
| session_id | session_1785865274322:pending_tool |
| state_key | pendingTool |
| item_index | 0 |
| state_data | &#123;"agentName":"MasterAgent","toolUseId":"call_41ee2cd0e743413d8827e4d5","toolName":"ask_user"&#125; |
| created_at | 2026-08-05 01:42:43 |
| updated_at | 2026-08-05 01:42:43 |

**`sseNotifier.sendUserInteraction`** 其实就是把模型的工具入参进行序列化，然后推送给前端，这样前端拿到完整的内容之后们就可以做渲染了。

（这里需要注意，我们还有一个ProgressNotifierHook也会向前端推送数据，所以需要再这个hook里针对HITL的情况做排除）

**UserInteractionTools的装配**

**我们只在**MasterAgent中做了：

```text
        Toolkit toolkit = new Toolkit();
        // 支持主动向用户提问（Human-in-the-Loop）
        toolkit.registration().tool(new UserInteractionTools()).apply();    // L79-81
```

ItineraryPlanAgent / BookingAgent / InfoAgent / ItineraryManageAgent  全都**没有**注册这个工具。这不是遗漏，是刻意的分工：主智能体是"用户与系统交互的唯一总入口"（master-agent-system.md:38），提问权收归一处；子智能体想问什么，就在自己的回复正文里问，由主智能体决定要不要把它升级成一张卡片。

提示词约束

前面的代码只保证"能问"。但是"该不该问、怎么问"需要靠提示词约束。master-agent-system.md中有关于 ask_user 的约束：

```text
## 主动询问（Human-in-the-Loop）

**⚠️ 前提约束**：以下规则仅适用于你**自身直接处理 `greeting`/`unknown` 意图**时，或**子智能体返回后需要用户确认**时。(**绝不适用于路由阶段** —— 意图识别结果中的 `overall_reason`、`required_info`、`reason` 等字段不构成触发 `ask_user` 的理由，你必须先路由到子智能体再说。)

当你直接处理的请求缺少必要信息、存在歧义或需要用户做选择时，**你必须调用 `ask_user` 工具**向用户提问，而不是自行假设或反复推理。

- 选择合适的 `ui_type`： ...（七种类型列举）
- `question` 必须清晰、具体，说明为什么需要这个信息。
- 单选/多选必须提供 `options`；表单必须提供 `fields`。
- 调用 `ask_user` 后 Agent 会暂停，等待用户在前端完成交互并回复。
```

```text
## 情况一：子智能体返回了完整方案/最终结果（直接透传，禁止 ask_user）

当子智能体返回的内容**已经是完整方案或最终结果**时（即使末尾附带确认问题），**直接将其作为你的回复透传给用户，禁止调用 `ask_user`**。

判断标准：子智能体的回复中包含了**实质性方案内容**（如行程规划、酒店推荐、车次信息、费用明细等），末尾的确认/选择问题是让用户对方案进行反馈。
```

```text
## 情况二：子智能体缺少必要信息，无法生成方案（使用 ask_user）
...
1. 调用 `ask_user`，将子智能体的原始提问**完整放入 `question` 字段**（禁止改写或概括）。
2. 选择合适的 `ui_type`：
   - 单一是/否问题 → `confirm`
   - 选择类问题 → `select`，并提取 `options`
   - 其他（开放式/多个问题）→ `text`
3. 用户回复后，**再次调用同一个子智能体**，在消息中把用户的回复完整传达，让它继续处理。
```

任务恢复处理

接着我们看从用户 → Agent这条链路。

用户在页面上给出反馈之后，会请求到`/respond` 中：

```text
    /**
     * 用户回复 Agent 主动提问（Tool Suspend 恢复）。
     */
    @PostMapping("/respond")
    @SaCheckLogin
    public SseEmitter respond(@RequestBody ChatRespondRequest request) {            // ChatController.java L123-125
        String userId = StpUtil.getLoginIdAsString();
        String sessionId = request.getSessionId();
        AgentSessionContext sessionCtx = new AgentSessionContext(userId, sessionId);
        AgentSessionContextHolder.set(sessionCtx);
        // ...
        try {
            return agentExecutor.resume(sessionCtx, request.getToolUseId(), request.getResponse());  // L135
        } finally {
            // 同 chat()：Tomcat 线程复用，返回前必须清理，避免残留上下文被后续请求继承
            AgentSessionContextHolder.clear();                                      // L138
        }
    }
```

请求体只有三个字段：

```text
    private String sessionId;
    private String toolUseId;
    private Object response;
```

response 是 Object 而不是 String，因为不同控件回来的形状不同：text/date/confirm 是字符串（确认卡片回的是字面量 'yes' / 'no'，见 UserInteractionCard.tsx:178-183），number 是数字，multi_select 是字符串数组，form 是对象。

ChatAgentExecutor.resume是整条链路最核心的方法，分四步：

**第一步，解析 Agent 实例**，两条分支：

```text
// --- 第一步：解析 Agent 实例 ---
AgentSession localSession = agentSessionManager.getBySessionId(sessionId);
ReActAgent agent;
boolean recoveredFromSession;

if (localSession != null && localSession.getAgent() != null) {
    agent = localSession.getAgent();
    recoveredFromSession = false;
    logger.debug("[EXECUTOR] respond 命中本地 AgentSession, sessionId={}", sessionId);
} else {
    PendingToolState pending = pendingToolSessionStore.get(sessionId);
    if (pending == null) {
        SseEmitter emitter = new SseEmitter(0L);
        sseNotifier.sendError(emitter, "会话已过期或不存在，请重新开始对话");
        return emitter;
    }
    agent = agentRegistry.getAgent(pending.agentName(), ReActAgent.class);
    if (agent == null) {
        SseEmitter emitter = new SseEmitter(0L);
        sseNotifier.sendError(emitter, "无法恢复会话：未知的 Agent 类型 " + pending.agentName());
        return emitter;
    }
    recoveredFromSession = true;
    logger.info("[EXECUTOR] respond 跨节点恢复, sessionId={}, agent={}, toolUseId={}",
            sessionId, pending.agentName(), pending.toolUseId());
}
```

同节点的Agent直接从localSession获取，跨节点重建靠的是 AgentRegistry创建新的bea。

**第二步，把用户回复落库**，非字符串统一 JSON.toJSONString 之后存成一条用户消息，保证刷新页面后历史记录里能看到"我当时选了什么"。

```text
// --- 第二步：持久化用户回复 ---
try {
    String userResponseText = response == null ? "" : (response instanceof String s ? s : JSON.toJSONString(response));
    chatHistoryService.saveUserMessage(sessionId, userId, userResponseText);
} catch (Exception e) {
    logger.warn("[EXECUTOR] 保存用户回复失败 sessionId={}: {}", sessionId, e.getMessage());
}
```

**第三步，构造 ****ToolResultBlock****——这是整条链路最关键的十几行：**

```text
// --- 第三步：构建 ToolResultBlock ---
String responseText;
if (response == null) {
    responseText = "";
} else if (response instanceof String s) {
    responseText = s;
} else {
    responseText = JSON.toJSONString(response);
}
ToolResultBlock resultBlock = new ToolResultBlock(
        toolUseId,
        UserInteractionTools.TOOL_NAME,
        List.of(TextBlock.builder().text(responseText).build()));
Msg toolResultMsg = Msg.builder()
        .role(MsgRole.TOOL)
        .name("user")
        .content(resultBlock)
        .build();
```

请注意 MsgRole.TOOL。**用户的回答不是作为一条新的用户消息进入对话，而是作为那次 ****ask_user**** 调用的返回值。** toolUseId 把它和 memory 里那个悬空的 ToolUseBlock 精确配对，模型看到的上下文是"我刚才调了 ask_user，它返回了『上海』"，而不是"用户又说了句话，我得猜猜他在回答什么"。这就是 HITL 相比"正文提问"最本质的差别——**它省掉的不是一次网络往返，而是一次重新理解上下文的推理**。

**第四步，续跑并标记恢复模式：**

```text
agent.call(List.of(toolResultMsg)).contextWrite(SessionReactorContext.of(sessionCtx, !recoveredFromSession)) 
```

这样，Agent就能继续跑下去了。

PendingToolRecoveryHook

顺带提一下，我们的所有 ReActAgent（Master + 四个子 Agent）都挂了框架自带的 PendingToolRecoveryHook。

但是，它管的是另一件事——当用户输入里**不含** ToolResultBlock 却存在孤儿 pending 调用时，补一个错误结果免得模型上下文残缺。它不会误伤 /respond 的正常续跑，因为那条路径带着合法的 ToolResultBlock。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a5a082674e4030001e47a68
