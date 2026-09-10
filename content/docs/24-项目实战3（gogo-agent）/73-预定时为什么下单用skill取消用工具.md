---
title: "✅预定时，为什么下单用skill，取消用工具？"
---

# ✅预定时，为什么下单用skill，取消用工具？

预订智能体（BookingAgent）里有个乍看很别扭的不对称：

- **下单**（出机票 / 订酒店 / 订火车票）：没有任何一个 Java @Tool 负责下单。LLM 读 tuniu-cli 技能文档，自己拼出 tuniu call flight saveOrder -a '&#123;...&#125;' 这样的命令，用 Shell 工具跑掉；BookingPersistenceHook 在命令跑完后**被动旁听**、把结果落库。整条链路是 **Skill + LLM + Hook**。

- **取消**：偏偏有一个正儿八经的 Java @Tool——cancel_booking（在 BookingWriteTools 里）。LLM 只是调用这把工具，真正的编排（校验、调平台、改状态、回话）全在 Java 里。

同一个业务域、同一套 tuniu CLI，为什么下单敢放手给模型，取消却要收回代码手里？把两条主线的真实代码摆在一起，答案会非常清晰：**这不是随意，而是由"操作错了会怎样"和"要不要精确编排"决定的控制权归属差异。**

下单

下单在数据层面是"无中生有"——先跑命令、平台返回一坨不可预测的响应，再从里面抠出订单号落成一条新记录。这种形态天然适合**被动 Hook 旁观**。看 BookingPersistenceHook 的入口（agent/hook/BookingPersistenceHook.java）：

```text
@Override
public int priority() {
    // 落库为纯副作用，放在命令注入类 Hook（3/5）之后即可
    return 20;
}

@Override
public <T extends HookEvent> Mono<T> onEvent(T event) {
    if (event instanceof PostActingEvent postActing) {
        try {
            handlePostActing(postActing);
        } catch (Exception e) {
            // 落库失败不得影响主流程  ← 关键：异常被吞掉，绝不打断 ReAct 主循环
            logger.error("[BookingPersistence] 预订记录落库异常", e);
        }
    }
    return Mono.just(event);  // 无论成败，事件原样放行
}
```

整条下单旁路在 PostActingEvent 阶段被动触发，落库失败也只记日志、把事件原样 return，绝不影响 LLM 继续往下走。

再看它怎么识别"这是一次下单命令"（handlePostActing）：

```text
private void handlePostActing(PostActingEvent event) {
    ToolUseBlock toolUse = event.getToolUse();
    if (toolUse == null || !SHELL_TOOL_NAME.equals(toolUse.getName())) {
        return;  // 只关心 execute_shell_command
    }
    String command = (String) input.get("command");
    // ...
    BookingOp op = resolveOp(command);   // 靠"命令里包含 call flight saveOrder"这种字符串匹配识别
    if (op == null) {
        return;                          // 不是预订命令，跳过
    }
    // 解析结果 → 只在 success 时同步 → CREATE 走 handleCreate
    switch (op.action()) {
        case CREATE -> handleCreate(op.bizType(), resultJson, args);
        case CANCEL -> handleCancel(op.bizType(), args);
    }
}
```

handleCreate 里做的是典型的"尽力而为的抽取"：CLI 响应可能被 MCP 包在 content[].text 里要先 unwrapMcpContent 解包，订单号字段名不固定，于是用 firstString(orderId/orderNo/mainOrderNo/...) 逐个试；抠不到就 return 跳过，绝不报错。落库成功后再通过 SSE 推一张"立即支付"卡片（emitBookingResult，状态 待支付）。

**这条主线为什么能放手给 LLM**：下单参数是高度可变、深度嵌套、随品类和平台版本漂移的——机票要 flightNo/contactTourist&#123;name,mobile&#125;，酒店要 checkInDate/checkOutDate，火车要 resources[] 数组带 adultPrice。如果用 Java 硬编码，每加一个品类、平台改一次字段就要改代码重新发布。交给 Skill（文档描述用法）+ LLM（拼参）+ Shell（执行）+ Hook（旁观落库），Java 侧零改动就能扩展。而且下单是创建型、失败可重试、落库可尽力而为，即便旁路漏抓一条也不产生资损——所以"发射后不管"是可接受的。

取消

取消在数据层面完全不同——它不是创建，而是**去改一条已知的、并且已经存在的记录**，而且"改错了"会直接造成资损（用户以为退了实际没退）。这要求精确、可中止、能回话的控制流，而LLM来负责这种控制流的话，**确定性**是不如工具的。

还有就是，我在实际开发的时候，最开始我其实也是直接用的skill取消的（其实你从 BookingPersistenceHook 中我们还保留着取消的代码逻辑就能看得出来），但是在实际使用的时候，我会发现经常会出现

- LLM 可能拼错单号（混淆内部单号与外部平台单号）；
- 没有幂等与失败保护，平台取消失败时内部状态可能与平台不一致。

等问题，那于是我就干脆把取消这个事务操作，干脆直接放到一个工具中，在工具内部把单号的确定性、幂等与失败的处理、先外部后内部的固定流程给他编排和确定好。就可以解决这个问题了。

```text
public String cancelBooking(AgentSessionContext sessionCtx, String bookingId, String reason) {

    // 1. 查询并校验归属——取消是改存量记录，必须防越权
    
    // 2. 幂等：已取消直接返回成功
    
    // 3. 先调平台取消

    // 4. 只有平台取消成功，才修改内部状态
   
}
```

**还有个重要原因，就是我们页面上其实也提供了一个取消的入口，用户可以直接点击按钮取消，这时候有个取消的工具就非常的重要了！！！**

取消并没有绕开 CLI，只是换了"谁来编排"

很容易误以为"取消不用 skill+hook = 取消不用 CLI"。其实不然。看 invokeTuniuCancel：

```text
private CliResult invokeTuniuCancel(String subCommand, String externalOrderNo, String userId) {
    String apiKey = apiKeyService.getApiKey(userId, TUNIU_PROVIDER);  // TUNIU_PROVIDER = "tuniu-cli"
    // 与 TuniuApiKeyHook 保持一致：用 env 前缀注入 API Key
    String cmd = "env TUNIU_API_KEY=%s tuniu %s -a '{\"orderId\":\"%s\"}'"
            .formatted(apiKey, subCommand, externalOrderNo);   // subCommand = "call flight cancelOrder" / "call train cancelOrder"
    ProcessBuilder pb = new ProcessBuilder("sh", "-c", cmd).redirectErrorStream(true);
    // ... 30s 超时、解析 successCode ...
}
```

取消底层跑的仍然是**同一套 tuniu CLI**（tuniu call flight cancelOrder -a '&#123;"orderId":"..."&#125;'），甚至连 API Key 注入方式都和下单的 TuniuApiKeyHook 保持一致。真正的区别只有一个字——**谁编排 CLI**：

| 维度 | 下单 | 取消 |
| --- | --- | --- |
| 编排者 | LLM（读 skill 自己拼命令） | Java 代码（cancel_booking亲自拼命令、调ProcessBuilder） |
| 落库/改状态 | BookingPersistenceHook<br>被动旁听（PostActing） | 工具方法内主动save，且严格后置于平台成功 |
| 失败处理 | 吞掉，不影响主流程 | 返回结构化 error，内部状态不变 |
| 参数形态 | 复杂、多变、按品类嵌套 | 固定，只有一个orderId |
| 数据操作 | CREATE 新记录 | UPDATE 已知记录 |
| 控制权 | 交给模型（松耦合、零 Java 改动可扩展） | 收回代码（强一致、可鉴权、能回话） |

**下单是"LLM 编排 CLI + Hook 旁观"，取消是"Java 编排 CLI"。**

**倾向"Skill + LLM + Hook（放手给模型）"当且仅当：** 操作是 CREATE 型；入参复杂多变、需频繁扩展；失败可重试、副作用可尽力而为（漏一条不致资损）；不需要向 LLM 精确回报分支结果。

**倾向"Java @Tool（收回代码）"当且仅当：** 操作是 UPDATE/DELETE 存量记录；必须鉴权（防越权、租户隔离）；需要事务顺序（外部成功才改内部）；需要幂等；需要把结构化结果回给 LLM 转述给用户。

装配上两者可以共存：在 BookingAgent.build() 里，cancel_booking 通过 toolkit.registration().tool(bookingWriteTools) 注册为工具，bookingPersistenceHook 通过 .hooks(...) 挂成钩子，互不干扰。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a68693274e4030001f1614e
