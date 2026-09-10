---
title: "✅集群架构下的Agent打断与恢复"
---

# ✅集群架构下的Agent打断与恢复

单机时代，打断和恢复都很简单：一个内存变量标记"停"，一个内存对象存"待恢复状态"。但一旦上多节点集群，两个难题立刻浮现：

**难题一：打断请求和运行中的 Agent 可能不在同一个节点。** 用户点"停止"，请求经负载均衡打到节点 B，可 Agent 正跑在节点 A 上。节点 B 的内存里根本没有这个 Agent 实例，怎么停？

**难题二：恢复请求可能落到任意节点，甚至发生在重启之后。** Agent 问了用户一个问题挂起（HITL），用户几分钟后回答，这个 /respond 请求可能落到节点 C，而挂起状态原本在节点 A 的内存里；如果期间集群滚动重启，节点 A 的内存也没了。怎么恢复？

gogo-agent 的答案是一套明确的分工：**运行时协调用 Redis Pub/Sub 广播，持久状态用 MySQL 共享，SSE 流则刻意保持节点本地、与执行同节点**。下面拆开讲。

打断入口

用户在AI对话过程中点停止，POST /api/chat/&#123;sessionId&#125;/interrupt 打到某个节点（记作节点 B），进 ChatAgentExecutor.interrupt(sessionId)。

本地优先，未命中则广播

打断的核心编排在 ChatAgentExecutor.interrupt：

```text
    public boolean interrupt(String sessionId) {
        // ① 先试本地——Agent 就在本节点，直接优雅中断
        boolean interrupted = interruptBroadcast.interruptLocalSession(sessionId);
        // ② 本地没命中——可能跑在别的节点，Redis 广播出去
        if (!interrupted) {
            interruptBroadcast.broadcastInterrupt(sessionId);
            interrupted = true;
        }
        return interrupted;
    }
```

本地打断的时候，要干的事情有以下几个。

```text
/**
 * 在当前节点执行完整的本地中断与清理，带广播时序校验。
 *
 * <p>包括：
 * <ol>
 *   <li>中断本地运行中的 Agent 并持久化 memory（带时序校验，跳过广播后新启动的 Agent）</li>
 *   <li>清理本地缓存的 ask_user suspended 状态（Caffeine，幂等）</li>
 *   <li>清理共享 Session 中的 pending tool 状态</li>
 *   <li>若本节点持有 SseEmitter（即发起 chat 请求的节点），通知前端"已停止生成"</li>
 * </ol>
 * 所有操作均为幂等，状态不存在时自动跳过。</p>
 *
 * @param broadcastTime 中断广播发出的时间戳（毫秒）；传 {@link Long#MAX_VALUE} 表示不做时序过滤
 * @return true 表示本地命中并中断了运行中的 Agent
 */
public boolean interruptLocalSession(String sessionId, long broadcastTime) {
    boolean interrupted = executionRegistry.interruptLocal(sessionId, broadcastTime);
    agentSessionManager.remove(sessionId);
    pendingToolSessionStore.clear(sessionId);
    // 仅在本地确实中断了运行中的 Agent 时才通知前端。
    // 否则 Redis Pub/Sub 回环可能在新请求注册新 emitter 后误发 "已停止生成"。
    if (interrupted) {
        SseEmitter emitter = emitterRegistry.get(sessionId);
        if (emitter != null) {
            sseNotifier.sendInterrupted(emitter);
        }
    }
    return interrupted;
}
```

AgentExecutionRegistry 是每个节点独立维护的本地注册表，Map&lt;sessionId, Set<Agent&gt;>——用 Set 是因为 MasterAgent 会通过 SubAgentTool 嵌套调子智能体，同一 session 同时可能有多个 Agent 在跑：

```text
    public boolean interruptLocal(String sessionId, long broadcastTime) {
        Long registerTime = registerTimeMap.get(sessionId);
        if (registerTime != null && registerTime > broadcastTime) {
            logger.info("[EXEC_REGISTRY] session={} Agent 注册时间({})晚于广播时间({}), 跳过中断（新执行流）",
                    sessionId, registerTime, broadcastTime);
            return false;
        }
        Set<Agent> agents = localAgents.remove(sessionId);
        registerTimeMap.remove(sessionId);
        if (agents == null || agents.isEmpty()) {
            logger.debug("[EXEC_REGISTRY] session={} 本地无运行中 Agent", sessionId);
            return false;
        }
        boolean interrupted = false;
        for (Agent agent : agents) {
            try {
                agent.interrupt();
                logger.info("[EXEC_REGISTRY] 优雅中断 session={} 的 Agent: {}", sessionId, agent.getName());
                interrupted = true;
            } catch (Exception e) {
                logger.error("[EXEC_REGISTRY] 本地中断 Agent 失败 session={} agent={}", sessionId, agent.getName(), e);
            }
            // AgentScope 优雅中断路径会跳过 PostCallEvent，SessionPersistenceHook 无法自动保存。
            // 在中断发生时立即把当前 memory 写入 Session，避免子智能体被打断后记忆丢失。
            persistInterruptedMemory(agent, sessionId);
        }
        return interrupted;
    }
```

跨节点广播：Redis Pub/Sub

当本地未命中，AgentInterruptBroadcast 把 sessionId 发到统一频道，每个节点都订阅了它，持有该 Agent 的节点收到后执行本地中断：

```text
    @PostConstruct
    public void init() {
        listenerContainer.addMessageListener(this, new ChannelTopic(INTERRUPT_CHANNEL));
        logger.info("[INTERRUPT_BROADCAST] 已订阅 Redis 频道: {}", INTERRUPT_CHANNEL);
    }

    @Override
    public void onMessage(Message message, byte[] pattern) {
        String body = new String(message.getBody());
        if (body == null || body.isBlank()) {
            return;
        }
        // 解析 "sessionId|timestamp" 格式；兼容旧格式（无分隔符时整个 body 视为 sessionId）
        String sessionId;
        long broadcastTime;
        int sepIdx = body.lastIndexOf(PAYLOAD_SEPARATOR);
        if (sepIdx > 0) {
            sessionId = body.substring(0, sepIdx);
            try {
                broadcastTime = Long.parseLong(body.substring(sepIdx + 1));
            } catch (NumberFormatException e) {
                broadcastTime = Long.MAX_VALUE;
            }
        } else {
            sessionId = body;
            broadcastTime = Long.MAX_VALUE;
        }
        if (sessionId.isBlank()) {
            return;
        }
        logger.info("[INTERRUPT_BROADCAST] 收到广播中断消息, sessionId={}, broadcastTime={}", sessionId, broadcastTime);
        interruptLocalSession(sessionId, broadcastTime);
    }

    /**
     * 向所有节点广播中断指定 session 的 Agent，消息携带发送时间戳。
     *
     * <p>消息格式：{@code sessionId|timestamp}，接收端据此判断本地 Agent 是否是在
     * 广播发出之后才启动的新执行流，避免异步广播回环误杀新 Agent。</p>
     */
    public void broadcastInterrupt(String sessionId) {
        if (sessionId == null || sessionId.isBlank()) {
            return;
        }
        long timestamp = System.currentTimeMillis();
        String payload = sessionId + PAYLOAD_SEPARATOR + timestamp;
        redisTemplate.convertAndSend(INTERRUPT_CHANNEL, payload);
        logger.info("[INTERRUPT_BROADCAST] 已广播中断消息, sessionId={}, timestamp={}", sessionId, timestamp);
    }
```

这就是**难题一的完整解法**：本地能停就本地停（快），停不了就全集群广播，让真正持有 Agent 的那个节点去停。

每个节点启动时都 @PostConstruct 订阅了 agent:interrupt 频道。节点 A 收到消息，onMessage 里拿到 sessionId，再执行一次**自己的** interruptLocal——这次因为 Agent 真在 A 上，命中并真正中断。其他没有这个 session 的节点收到消息后 interruptLocal 返回 false，什么也不做。

```text
@Override
public void onMessage(Message message, byte[] pattern) {
    String sessionId = new String(message.getBody());
    executionRegistry.interruptLocal(sessionId);   // 只有持有者会命中
}
```

这就是解决"打断请求和运行中的 Agent 不在同一节点"的核心：**本地优先（快），广播兜底（全覆盖）**。

打断后的记忆补偿

前面说过优雅中断跳过 PostCallEvent，所以 interruptLocal 里紧跟着调 persistInterruptedMemory，手动把当前 memory 写进 MySQL Session，避免被打断那一轮的用户输入丢失：

```text
private void persistInterruptedMemory(Agent agent, String sessionId) {
    String sessionKey = sessionId + ":" + agent.getName();
    Memory memory = resolveMemory(agent);   // 只有 ReActAgent 有 memory
    if (memory == null) return;             // 无状态识别器跳过
    memory.saveTo(agentSession, sessionKey);
}
```

同时，框架优雅中断返回的是一条英文恢复消息，AgentPipelineService.isInterruptRecovery 会识别它（或 GenerateReason.INTERRUPTED），短路整个 pipeline，返回中文的"已停止生成。请告诉我接下来有什么可以帮您的？"

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a5a08c6c71a8900017abda8
