---
title: "✅多实例Agent任务管理改造"
---

# ✅多实例Agent任务管理改造

在前面的课程中，我们已经通过 `AgentTaskManager` 实现了单实例下的任务注册、并发控制、流式终止和资源释放。但那套实现只依赖本地 `ConcurrentHashMap`，一旦系统部署多个实例，问题就出现了，比如我现在启动两个实例，一个是8888端口，一个是8889端口，然后通过nginx进行转发，就可能出现，任务跑在 8888 端口上，停止请求却被 Nginx 转发到了 8889 端口，本地 map 里根本找不到这个任务，停止指令无处执行。本节课要解决的就是这个问题——**如何让任务管理跨实例生效**。改造后的 `AgentTaskManager` 引入了 Redis 分布式锁和 Pub/Sub 机制，使得任意实例都能正确停止运行在其他实例上的任务，同时保持了单实例场景下的简洁性和高性能。

从单实例到多实例：问题出在哪？

在真实的生产部署中，单个应用实例很难支撑所有用户请求。通常会通过 Nginx 等反向代理，将请求轮询分发到多个后端实例。我们的项目中也是这样做的：

```java
# nginx.conf
upstream agent_backend {
    server 127.0.0.1:8888;
    server 127.0.0.1:8889;
}

server {
    listen       9999;
    location / {
        proxy_pass http://agent_backend;
        proxy_http_version 1.1;
        
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Connection '';
        proxy_read_timeout 86400s;
    }
}
```

这里有两个关键配置需要特别注意：

**`proxy_read_timeout`**** 是必须设置的**

SSE 属于长连接，Nginx 默认 60 秒读超时，如果在该时间内没有数据传输，会强制断开连接，导致流式输出中断。

**`proxy_buffering off`**** 建议开启**

Nginx 默认会对响应进行缓冲，这可能导致后端生成的 token 被积攒后再批量发送，从而影响流式体验。虽然在某些情况下（如 token 输出频繁、数据量较小）即使不关闭缓冲也不会出现明显问题，但在高并发或复杂网络环境下仍可能导致延迟，因此建议显式关闭。

**`proxy_cache off`**** 一般不是必须**

SSE 响应通常带有 `no-cache` 头，Nginx 默认不会缓存，因此该配置更多是保险措施。

配置完成后，需要修改前端的接口配置：`dodo-agent\src\main\resources\static\js\config.js`

```java
const CONFIG = {
    backendUrl: 'http://localhost:9999'
};

// 导出配置（用于非模块化环境）
window.APP_CONFIG = CONFIG;
```

在这种架构下，用户对话的请求可能被分发到不同的实例：

![image.png](assets/a1965eb79115.png)

原有的 `AgentTaskManager` 只用 `ConcurrentHashMap` 做本地存储，8889 实例的 map 里根本没有这个任务，`stopTask()` 会直接返回 false，任务无法停止。

改造思路：Redis 分布式协作

要让多个实例协作管理任务，需要解决两个核心问题：

第一，**任务注册的互斥性**。同一个 `conversationId` 的任务只能在一个实例上运行，不能两个实例同时处理同一个会话。

第二，**停止指令的路由**。停止请求可能到达任意实例，但必须能精准传达给持有任务的那个实例。

改造方案如下：

```text
┌──────────────────────────────────────────────────┐
│                Redis                              │
│                                                   │
│  agent:task:{conversationId} → instanceId (SETNX) │
│                                                   │
│  agent:stop (Pub/Sub Topic)                       │
│                                                   │
└──────────┬───────────────────────┬───────────────┘
           │                       │
           ▼                       ▼
   ┌──────────────┐       ┌──────────────┐
   │   实例 8888   │       │   实例 8889   │
   │              │       │              │
   │ taskMap(本地) │       │ taskMap(本地) │
   │ instanceId   │       │ instanceId   │
   │              │       │              │
   │ 订阅 stop     │       │ 订阅 stop    │
   └──────────────┘       └──────────────┘
```

- **Redis SETNX**：任务注册时写入 `agent:task:{conversationId} → instanceId`，也就是`agent:task:{conversationId}` 为 key，`instanceId`为 value，保证同一会话只注册一次
- **Redis Pub/Sub**：停止请求通过 `agent:stop` 主题广播，所有实例监听，只有持有任务的实例执行停止，其他实例自动忽略即可。

任务注册

改造后的 `registerTask` 在本地检查之后，增加了 Redis 分布式锁：

```java
public TaskInfo registerTask(String conversationId, Sinks.Many<String> sink, String agentType) {
        // 1. 先检查本地
        TaskInfo existing = taskMap.get(conversationId);
        if (existing != null) {
            log.warn("会话 {} 本地已有任务在执行，拒绝注册新任务", conversationId);
            return null;
        }

        // 2. 尝试在 Redis 中注册
        RBucket<String> bucket = getTaskBucket(conversationId);
        boolean acquired = bucket.trySet(instanceId, TASK_TTL_MINUTES, TimeUnit.MINUTES);

        if (!acquired) {
            String holder = bucket.get();
            log.warn("会话 {} 已在实例 {} 上执行，当前实例 {} 拒绝注册", conversationId, holder, instanceId);
            return null;
        }

        // 3. 注册到本地
        TaskInfo taskInfo = new TaskInfo(sink, agentType);
        taskMap.put(conversationId, taskInfo);
        log.info("注册任务成功: conversationId={}, agentType={}, instanceId={}", conversationId, agentType, instanceId);
        return taskInfo;
    }
```

`bucket.trySet()` 是 Redis 的 `SETNX` 命令，同时设置了 30 分钟的 TTL。这样即使实例意外宕机，Redis key 也会自动过期，不会造成死锁。

注册流程如下：

```text
实例 A 收到请求
   │
   ├── 检查本地 taskMap → 无冲突
   │
   ├── Redis SETNX → 成功（写入 instanceId）
   │
   └── 注册到本地 taskMap

---

实例 B 收到同一会话的请求
   │
   ├── 检查本地 taskMap → 无冲突
   │
   ├── Redis SETNX → 失败（key 已存在）
   │
   └── 拒绝注册，返回 null
```

`hasRunningTask` 也做了对应改造，除了检查本地 map，还会检查 Redis：

```java
public boolean hasRunningTask(String conversationId) {
        // 先检查本地（快速路径）
        if (taskMap.containsKey(conversationId)) {
            return true;
        }
        // 检查 Redis（其他实例可能持有）
        RBucket<String> bucket = getTaskBucket(conversationId);
        return bucket.isExists();
    }
```

这样即使任务注册在另一个实例上，当前实例也能正确判断出该会话正在执行。

实例标识

每个 `AgentTaskManager` 实例在构造时生成一个 8 位随机 ID，作为整个分布式协调的身份标识：

```java
public AgentTaskManager(RedissonClient redissonClient) {
        this.redissonClient = redissonClient;
        this.instanceId = UUID.randomUUID().toString().substring(0, 8);
        this.stopTopic = redissonClient.getTopic(STOP_TOPIC_NAME, StringCodec.INSTANCE);
        log.info("AgentTaskManager 初始化, instanceId={}", instanceId);
    }
```

`instanceId` 用于三个地方：

- **注册时**：写入 Redis value，标识任务的持有者
- **停止时**：判断 Redis key 的持有者是否是本实例
- **续期时**：校验 key 归属是否发生变化

停止会话：Pub/Sub

这部分是改造的核心，停止请求可能到达任意实例，但任务可能运行在其他实例上。我们需要一个机制把停止指令路由到正确的实例上。

stopTask 的四层判断

```java
public boolean stopTask(String conversationId) {
        // 1. 先尝试本地停止（快速路径）
        TaskInfo localTask = taskMap.get(conversationId);
        if (localTask != null) {
            log.info("本地停止任务: conversationId={}, instanceId={}", conversationId, instanceId);
            doStopTask(conversationId, localTask);
            return true;
        }

        // 2. 先检查 Redis 中是否存在该任务，不存在则无需广播
        RBucket<String> bucket = getTaskBucket(conversationId);
        if (!bucket.isExists()) {
            return false;
        }

        // 3. 持有者是本实例，说明已在处理中，无需广播
        String holder = bucket.get();
        if (instanceId.equals(holder)) {
            log.debug("任务持有者是本实例，跳过广播: conversationId={}", conversationId);
            return false;
        }

        // 4. 本地没有但 Redis 有，且持有者不是本实例，Pub/Sub 广播停止请求
        long receivers = stopTopic.publish(conversationId);
        log.info("发布停止广播: conversationId={}, 订阅者数量={}", conversationId, receivers);
        return true;
    }
```

整个判断逻辑的流向：

```text
stopTask(conversationId)
   │
   ├── 本地 taskMap 有 → 直接停止
   │
   ├── Redis key 不存在 → 没任务，返回 false
   │
   ├── Redis 持有者是本实例 → 已在处理中，跳过
   │
   └── Redis 持有者是其他实例 → Pub/Sub 广播
```

Pub/Sub 订阅与远程停止

每个实例在启动时（`afterPropertiesSet`）都会订阅 `agent:stop` 主题：

```java
public void afterPropertiesSet() {
        // 订阅停止消息
        listenerId = stopTopic.addListener(String.class, (channel, conversationId) -> {
            handleRemoteStop(conversationId);
        });

        // 启动 TTL 刷新定时任务
        ttlRefreshScheduler.scheduleAtFixedRate(
                this::refreshTaskTtls,
                TTL_REFRESH_INTERVAL_MINUTES,
                TTL_REFRESH_INTERVAL_MINUTES,
                TimeUnit.MINUTES
        );

        log.info("AgentTaskManager 启动完成, 已订阅停止主题, TTL刷新间隔={}分钟", TTL_REFRESH_INTERVAL_MINUTES);
    }
```

当某个实例发布广播后，所有实例都会收到消息，但只有持有任务的实例会处理：

```java
private void handleRemoteStop(String conversationId) {
      TaskInfo taskInfo = taskMap.remove(conversationId);
      if (taskInfo == null) {
          return;
      }
      log.info("远程停止任务: conversationId={}, instanceId={}", conversationId, instanceId);
      doStopTask(conversationId, taskInfo);
  }
```

完整的跨实例停止流程：

![bb8e5d6acdb05acd43c5b6657a4cbd9b.jpg](assets/bfe31946463b.jpg)

TTL 自动续期

任务注册时 Redis key 的 TTL 设为 30 分钟。但某些复杂任务（如深度研究）执行时间可能超过 10多分钟，如果 key 过期被删除，其他实例就可能重复注册同一会话的任务。

为此，每个实例启动了一个定时任务，每 5 分钟刷新本地所有任务的 TTL：

```java
private void refreshTaskTtls() {
    if (taskMap.isEmpty()) {
        return;
    }

    log.debug("开始刷新 TTL, 本地任务数={}", taskMap.size());
    for (String conversationId : taskMap.keySet()) {
        try {
            RBucket<String> bucket = redissonClient.getBucket(TASK_KEY_PREFIX + conversationId);
            String holder = bucket.get();
            if (instanceId.equals(holder)) {
                bucket.expire(Duration.ofMinutes(TASK_TTL_MINUTES));
            } else {
                // Redis 中的 holder 不是本实例，说明 key 已被其他实例持有或已过期
                log.warn("TTL刷新发现 key 归属变化: conversationId={}, 期望={}, 实际={}",
                        conversationId, instanceId, holder);
                taskMap.remove(conversationId);
            }
        } catch (Exception e) {
            log.error("TTL刷新失败: conversationId={}", conversationId, e);
        }
    }
}
```

续期时会校验 `holder` 是否仍然是自己的 `instanceId`，防止误续别人的 key。

前端停止机制：abort 与 stopAgent

前端的 `stopMessage` 函数中同时使用了两种停止手段：

```java
const stopMessage = async () => {
    if (!isSending.value) return;

    // 方式一：abort 直接断开 SSE 连接
    if (abortController) {
        abortController.abort();
    }

    // 方式二：stopAgent 通过后端 API 停止任务
    await APP_API.stopStream(backendUrl, currentChatId);
};
```

这两种方式的工作原理完全不同，理解它们的差异对于理解整个停止机制至关重要。

abort：基于 SSE 连接的直连停止

前端通过 `fetch` 建立 SSE 连接时，会创建一个 `AbortController` 并将其 `signal` 绑定到请求上：

```text
abortController = new AbortController();
const response = await fetch(sseUrl, { signal: abortController.signal });
```

当调用 `abortController.abort()` 时，浏览器会立即断开这条 TCP 连接。关键在于这条连接是直接连到持有任务的那个后端实例的（中间经过 Nginx 转发）。所以后端检测到连接断开后，Reactive 流的 `doOnCancel` 回调会直接触发，进而调用 `stopTask()` 完成本地停止。

![image.png](assets/a27f76f680f8.png)

可以看到，当 `abort()` 生效时，整个 Pub/Sub 机制根本没有参与，8888 已经通过 `doOnCancel` 自己把自己停了，等 8889 收到 `stopAgent` 请求时，Redis key 都已经删了，直接返回 false。这意味着：**只要 ****`abort`**** 生效，****`stopAgent`**** 和 Pub/Sub 就完全是多余的。**

abort 的局限

但光靠 `abort` 其实并不可靠，它的前提是必须要有SSE链接才可以。`abort` 依赖 SSE 连接的存在，比如：网络抖动，导致链接意外断开，`abort()` 同样无法触发。再比如如果系统中有其他组件需要主动停止某个任务（例如管理后台远程终止用户的执行任务），它并不持有用户的 SSE 连接，无法使用 `abort`，所以只能通过调用 `stopAgent` 接口配合 Pub/Sub 来完成跨实例停止。

验证 Pub/Sub：去掉 abort

由于 `abort` 会抢先完成停止，直接观察不到 Pub/Sub 的效果。如果想验证 Pub/Sub 机制是否正常工作，可以在前端代码中把 `abort` 注释掉：

```text
const stopMessage = async () => {
    if (!isSending.value) return;

    // 注释掉 abort，让停止完全走后端 Pub/Sub 路径
    // if (abortController) {
    //     abortController.abort();
    // }

    await APP_API.stopStream(backendUrl, currentChatId);
};
```

此时停止流程就会完全按照`Pub/Sub 订阅与远程停止`的时序图执行：`stopAgent → Pub/Sub 广播 → handleRemoteStop → 停止任务`。

建议：两者都保留

在实际项目中，建议两种机制都保留，各司其职：

```text
用户点击停止
   │
   ├── abort()          → 快速路径：直接断 TCP，触发 doOnCancel，毫秒级响应
   │
   └── stopAgent API    → 兜底路径：Pub/Sub 跨实例停止，覆盖 abort 失效的场景
```

`abort` 负责绝大多数正常场景下的快速停止，`stopAgent` + Pub/Sub 则为异常场景（标签页关闭、网络断开、管理后台远程停止等）提供可靠的兜底能力。

实例销毁时清理

当实例关闭（如重启、缩容）时，`AgentTaskManager` 通过 Spring 的 `DisposableBean` 回调执行清理：

```java
@Override
public void destroy() {
    // 移除发布订阅监听器
    try {
        stopTopic.removeListener(listenerId);
    } catch (Exception e) {
        log.warn("移除发布订阅监听器失败", e);
    }

    // 关闭定时任务
    ttlRefreshScheduler.shutdown();

    // 清理所有本地任务（释放 Redis key）
    for (String conversationId : taskMap.keySet()) {
        doRemoveTask(conversationId);
    }

    log.info("AgentTaskManager 销毁完成, instanceId={}", instanceId);
}
```

第 3 步确保实例下线时，其持有的所有 Redis key 都被主动删除，而不是等待 30 分钟 TTL 自然过期。这样其他实例可以立即接管这些会话。

总结

从单实例到多实例的改造，核心变化是将 `AgentTaskManager` 的存储和协调机制从本地 `ConcurrentHashMap` 扩展到中间件 Redis。改造涉及三个关键机制：

- **Redis SETNX 分布式锁**：保证同一会话的任务只能在一个实例上注册，解决了并发注册的互斥问题
- **Redis Pub/Sub 广播**：停止请求通过广播到达所有实例，由持有任务的实例执行停止，解决了跨实例路由问题
- **TTL 自动续期**：防止长任务在执行过程中 Redis key 过期导致的状态丢失

整个改造保持了单实例场景下的简洁性，本地任务直接走本地 map 快速路径，只有在涉及跨实例时才访问 Redis。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69da329b3fb9180001524341
