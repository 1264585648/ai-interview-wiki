---
title: "✅Human-in-the-Loop在集群模式下的支持"
---

# ✅Human-in-the-Loop在集群模式下的支持

我们的项目，其实已经是支持集群模式的了，最主要的就是我们的对话记录和session都是做了持久化的，依靠数据库来做的保存，包括我们的过程数据，比如规划的方案这些，用户的api key啥的，我们也都是存在redis或者mysql的，没有针对单机的本地内存和磁盘的依赖。

但是我们还是有两个地方需要特别注意的，一个是我们这一期要讲的HILP的支持，另一个后面要讲的Agent的打断与恢复的支持。

我们前面讲过，Agent 调用 `ask_user` 工具向用户提问（如"请选择出发日期"）时会进入 `TOOL_SUSPENDED` 暂停状态。但是暂停的 Agent 实例（含完整对话上下文）活在节点 A 的内存里；用户的回复请求却可能落在节点 B。

那么我们就需要解决这个问题，让集群模式下的HILP可以玩的转。我们的方案是这样的：

**暂停时双写**（`ChatAgentExecutor.handleAgentResult`）：

```java

if (result.getGenerateReason() == GenerateReason.TOOL_SUSPENDED) {
    // ① 本地缓存：Agent 实例留在本节点内存（同节点恢复零开销）
    agentSessionManager.register(new AgentSession(sessionId, resumableAgent, toolUse.getId()));
    // ② 共享存储：只持久化轻量元数据（agentName / toolUseId / toolName）
    pendingToolSessionStore.save(sessionId, agentName, toolUse.getId(), "ask_user");
}
```

**恢复时两级查找**（`ChatAgentExecutor.resume`）：

```java
// 第一步：解析 Agent 实例
AgentSession localSession = agentSessionManager.getBySessionId(sessionId);   // L1：本地 Caffeine
if (localSession != null) {
    agent = localSession.getAgent();     // 同节点：直接复用实例
} else {
    PendingToolState pending = pendingToolSessionStore.get(sessionId);      // L2：共享 Session
    agent = agentRegistry.getAgent(pending.agentName(), ReActAgent.class);  // 跨节点：按名字重建实例
}
// 跨节点重建的实例内存为空 → 从共享 Session 加载历史 memory 后续跑
agent.call(List.of(toolResultMsg))
     .contextWrite(SessionReactorContext.of(sessionCtx, !recoveredFromSession));
```

我们看跨节点的情况，先通过`pendingToolSessionStore.get(sessionId);` 去数据库中查询出当前是否有被pending的工具。如果有的话，从保存的记录中获取到是哪个agent运行被暂停了，把这个agent重建出来，继续跑。

| 层 | 存什么 | 作用 |
| --- | --- | --- |
| `AgentSessionManager`（Caffeine，1024 个 / 访问后 30min 过期） | 活的 Agent 实例 | 同节点恢复**零重建开销**；容量与 TTL 上限防止实例永驻内存 |
| `PendingToolSessionStore`（MySQL，key =<br>`sessionId:pending_tool`） | agentName、toolUseId、toolName | 跨节点恢复的**唯一依据**，任意节点可读 |

同时，上面在构建上下文的时候，会把是否从session中构建的agent作为一个标记记录下来。如果是从session构建的agent，我们需要对它特殊处理，处理逻辑如下：

```text
/**
 * ReActAgent（持有 {@link Memory}）的 Session 持久化：沿用 StateModule 原生 saveTo/loadIfExists。
 */
private void persistReActAgent(HookEvent event, ReActAgent reActAgent, String sessionKey,
                               String sessionId, String agentName, boolean resuming) {
    if (event instanceof PreCallEvent) {
        if (resuming) {
            logger.debug("[SessionPersistence] 恢复暂停 Agent，跳过历史记忆加载: sessionId={}, agent={}", sessionId, agentName);
        } else {
            // 加载上一轮历史记忆（首次请求时 Session 不存在，loadIfExists 直接跳过）
            boolean loaded = reActAgent.loadIfExists(session, sessionKey);
            if (loaded) {
                logger.debug("[SessionPersistence] 已加载历史记忆: sessionId={}, agent={}", sessionId, agentName);
            }
        }
    } else {
        reActAgent.saveTo(session, sessionKey);
        logger.debug("[SessionPersistence] 已保存对话记忆: sessionId={}, agent={}", sessionId, agentName);
    }
}
```

也就是要干这个——`boolean loaded = reActAgent.loadIfExists(session, sessionKey);` ，因为这种情况下，agent是没有记忆的，所以我们需要把他的记忆给他重建出来。

但是这里还有个问题（不算问题），大家注意到没有。按照上面的这个流程走下来：

Step 1，和实例1说帮我创建行程，但是信息不足，触发hilp

Step2，用户补充信息，请求到实例2，实例2恢复运行。

但是，实例1里面还有一个处于中间状态的Agent？

这其实是一个错误理解，实例1中的Agent并没有在等，他其实已经返回了，结束了！

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a9d0a7e3fb918000101ed5a
