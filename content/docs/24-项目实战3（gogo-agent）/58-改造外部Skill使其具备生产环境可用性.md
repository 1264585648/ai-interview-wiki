---
title: "✅改造外部Skill使其具备生产环境可用性"
---

# ✅改造外部Skill使其具备生产环境可用性

我们需要针对rgh这个CLI做改造，需要靠改造解决以下问题：

1、用户 A 登录后，用户 B 以 A 的身份下单了

2、用户在一个节点登录成功，下一句话就说他没登录

3、用户明明登出了，换个节点又是已登录

4、用了一段时间，突然要求重新授权

5、授权链接点了，但根本没反应

6、功能全通了，但Token到处都是明文

7、本地文件残留，内容不断膨胀

以下是这个方案涉及到的组件：

| 组件 | 职责 |
| --- | --- |
| RghTokenStore | Redis 侧权威源读写，加解密、TTL、存量明文兼容 |
| RghWorkspace | 用户级本地工作区：目录布局、权限收紧、路径安全校验 |
| RghUserIsolationHook | 命令改写、投影/回写编排、登录 watcher |
| RghWorkspaceCleaner | 定时回收本地敏感残留 |

用户 A 登录后，用户 B 以 A 的身份下单了

两个用户几乎同时用酒店功能，第二个用户从没授权过，却直接下单成功了——订单落在第一个用户的账号上。

根因很直白：**Token 路径是全局唯一的**。同一个 JVM 里，所有用户的 `rgh` 子进程看到的 `~` 都是同一个目录，`~/.hotel-cli/token.json` 是所有人共用的一个文件。谁最后登录，全站就都是谁。

解决思路是，既然 `rgh` 把路径写死成 `~/.hotel-cli/token.json`，那就换掉它眼中的 `~`。 在 RghUserIsolationHook的`PreActingEvent` 阶段拦下 `execute_shell_command`，命中 `rgh` 后把原命令包一层：

```java

String wrappedCommand = "env HOME=" + userDir + " bash -c '" + escapedCommand + "'";
```

工具内部本身是 `bash -c "<命令>"` 执行的，所以最终形态是：

```bash

bash -c "env HOME=/tmp/gogo-agent/rgh-users/u_001 bash -c 'rgh whoami'"
```

每个用户拿到独立的 `<base>/{userId}/.hotel-cli/token.json`，进程内并发也互不干扰。

用户在一个节点登录成功，下一句话就说他没登录

前面解决了"用户之间"的隔离，线上集群部署后立刻暴露新问题：

1. 用户在**节点 A** 完成授权，Token 落在节点 A 的本地磁盘；
2. 下一条消息经负载均衡路由到**节点 B**；
3. 节点 B 的本地磁盘上没有这个用户的目录 → `rgh whoami` 返回未登录 → Agent 又发一遍授权链接。

用户视角就是"授权了个没完"。根因：**本地磁盘是节点私有的**，隔离维度只解决了用户，没解决节点。

于是我们改成用Redis存储Token，本地文件作为"临时投影"。

![image.png](assets/ec540ce2255f.png)

`PreActing` 在包装命令之前，先把 Redis 里的 Token 写到用户本地目录：

```java

String syncedToken = tokenStore.getToken(userId);
if (syncedToken != null) {
    workspace.writeToken(userId, syncedToken);   // 跨节点免登录
}
```

这样即使用户是在其他实例上登录的，因为Redis是共享的，也能拿到对应的token值。

Redis Key 为 rgh:token:&#123;userId&#125;，TTL 30 天（与 rgh OAuth Token 默认有效期对齐），由 RghTokenStore 封装。

为啥有了Redis还需要本地文件？因为rhg这个命令他就是要读写本地文件的，我们只能干预他从哪个目录下读文件，没办法让他直接去读写Redis。所以需要兼容。

用户明明登出了，换个节点又是已登录

1. 用户在节点 B 执行登出（或者超时过期），Redis 里的 Token 被删掉了；
2. 但节点 A 的本地磁盘上，之前投影下去的 Token 文件**还在**；
3. 下一条消息回到节点 A，`rgh` 读到本地过期的token去请求就会报错。

那么，我们需要针对"Redis 里没有值"的情况，做特殊处理，出现这种情况，我们就认为"该用户未登录"，这个状态必须同样被同步到本地：

所以在上面的代码中，还有个else分支：

```java
if (syncedToken != null) {
    workspace.writeToken(userId, syncedToken);   // 有 → 投影
} else {
    workspace.deleteToken(userId);               // 无 → 清残留（关键）
}
```

用了一段时间，突然要求重新授权

前面解决之后，还有新问题：用户前一天还正常，第二天忽然被要求重新授权，Redis 里的 Key 明明还没到 TTL。

根因是当前的投影是**单向的**：Redis → 本地。而 `rgh` 会在调用过程中静默刷新 OAuth Token 并写回本地文件。于是：

1. 某次命令中 CLI 刷新了 Token，新值只存在于**节点本地文件**；
2. Redis 里还是旧的（已失效）；
3. 下次命令 `PreActing` 投影，**用旧值把新值覆盖掉了**；
4. 旧 Token 已失效 → 未登录。

投影机制不仅没帮上忙，反而在主动破坏正确状态。所以，我们需要针对这种情况做回写，

所以，在RghUserIsolationHook的 `PostActingEvent` 阶段比对，基准是"本次注入下去的值"：

```java

String localToken = workspace.readToken(userId);
if (localToken != null && !Objects.equals(localToken, invocation.syncedToken())) {
    tokenStore.saveToken(userId, localToken);   // 捕获 CLI 刷新
}
```

这需要在 `PreActing` 存一份调用快照带到 `PostActing`：

```java

private record RghInvocation(String userId, String command, String syncedToken) {}
private final Map<String, RghInvocation> invocations = new ConcurrentHashMap<>();
```

授权链接点了，但根本没反应

前四关都在处理"已登录之后"的事。首次登录这条路本身是有问题的，而且断在两个不同的地方：

**断点 A：命令活不到用户点完链接。** `rgh login` 是阻塞轮询命令，要一直等到浏览器授权完成。但 `execute_shell_command` 有执行超时，命令被杀之后**没有任何进程在轮询接收 Token**。用户点了链接，服务端这边没人接。

**断点 B：即使把它放到后台跑起来，Token 也抓不到。** 后台进程的 Token 是在本次命令**返回之后**（用户在浏览器点完的那一刻）才落盘的。第 4 关的 `PostActing` 比对早就执行完了，那时文件还没变化。**这个 Token 将永远进不了 Redis**，节点漂移后依然是未登录。

为了解决第一个情况，我们约定，禁止 Agent 直接执行 rgh login，必须分两次独立的工具调用，以下是我们的skill中的提示词。

````text
. 授权流程（⚠️ **禁止直接执行 `rgh login`**，必须用 nohup 后台模式）：

   > **为什么不能直接执行 `rgh login`？**
   > `rgh login` 是阻塞轮询命令，会持续等待用户完成浏览器授权。但
   > `execute_shell_command` 有执行超时限制，命令超时被杀后无进程轮询接收 token。

   **正确做法 —— 分步后台启动（两条命令，依次执行）：**

   **第一步：启动后台登录进程**
   ```bash
   bash -c "nohup rgh login > $HOME/rgh_login_output.txt 2>&1 &"
   ```
   这条命令通过 `bash -c` 包裹，在后台启动 `rgh login`，不受 shell 超时影响。

   > ⚠️ **输出路径必须用 `$HOME/rgh_login_output.txt`**，不要写成 `/tmp/rgh_login_output.txt` 等固定全局路径。
   > `$HOME` 已由平台按用户隔离，写到全局路径会导致多用户并发登录时互相覆盖，甚至读到他人的授权链接。

   **第二步：读取输出**（第一步执行完毕后，单独执行此命令）
   ```bash
   cat $HOME/rgh_login_output.txt
   ```
   这条命令读取登录输出内容（包含授权链接）。如果输出为空，说明启动尚未完成，请再次执行本命令。

   ⚠️ **禁止将两步合并为一条命令**（如 `sleep 10 && cat ...`），必须作为两次独立的 `execute_shell_command` 调用。

   后台的 `rgh login` 进程会持续轮询，用户完成浏览器授权后自动接收并保存 token。

   **Agent 从输出中提取授权链接**（`https://rollinggo.store/s/xxx` 格式）后必须：
   - 将链接以可点击的形式回复给用户
   - 告知用户："请点击链接完成授权，授权成功后请告诉我"

   **回复模板**：
   ```
   请点击以下链接完成授权：
   [点击授权](https://rollinggo.store/s/xxx)

   授权成功后请告诉我，我将继续为您预订。
   ```
````

那为了解决第二个情况，我们需要搞一个后台watcher。

所以在preActing中，增加以下代码：

```text
// login 是后台阻塞轮询，Token 会在本次命令返回之后才落盘，
// 因此必须由 watcher 兜住，否则该 Token 永远不会进 Redis
if (isLoginCommand(command)) {
    startLoginWatcher(userId, syncedToken);
}
```

watcher 以启动时的 Token 内容作 baseline，一旦发现本地文件变成新值，立刻回写 Redis，并删掉那个含授权链接的输出文件；超时或异常则自行退出。

```text
/**
 * 启动后台 watcher 轮询本地 Token 文件：一旦后台 {@code rgh login} 进程收到授权并落盘，
 * 立刻回写 Redis，使其他节点也能读到登录态。超时或成功后自行退出。
 *
 * @param baselineToken 启动时的 Token 内容，用于识别"新落盘"（可能为 null）
 */
private void startLoginWatcher(String userId, String baselineToken) {
    if (!watchingUsers.add(userId)) {
        logger.debug("[RghIsolation] 该用户已有登录 watcher 在运行, userId={}", userId);
        return;
    }

    long deadline = System.currentTimeMillis() + WATCH_TIMEOUT.toMillis();
    logger.info("[RghIsolation] 已启动登录 watcher, userId={}, 最长等待={}分钟",
            userId, WATCH_TIMEOUT.toMinutes());

    watcherExecutor.schedule(new Runnable() {
        @Override
        public void run() {
            try {
                String token = workspace.readToken(userId);
                if (token != null && !Objects.equals(token, baselineToken)) {
                    tokenStore.saveToken(userId, token);
                    watchingUsers.remove(userId);
                    // 授权链接已消费完毕，顺手清掉含链接的输出文件
                    workspace.deleteLoginOutput(userId);
                    logger.info("[RghIsolation] 登录 watcher 捕获到新 Token 并已回写 Redis, userId={}", userId);
                    return;
                }
                if (System.currentTimeMillis() >= deadline) {
                    watchingUsers.remove(userId);
                    logger.info("[RghIsolation] 登录 watcher 超时退出（用户未完成授权）, userId={}", userId);
                    return;
                }
                watcherExecutor.schedule(this, WATCH_INTERVAL.toMillis(), TimeUnit.MILLISECONDS);
            } catch (Exception e) {
                watchingUsers.remove(userId);
                logger.warn("[RghIsolation] 登录 watcher 异常退出, userId={}", userId, e);
            }
        }
    }, WATCH_INTERVAL.toMillis(), TimeUnit.MILLISECONDS);
}
```

授权在节点 A 完成 → watcher 回写 Redis → 后续消息漂到节点 B 也是已登录。

功能全通了，但Token到处都是明文

到这里功能已经完全可用，但是还有个**Redis 里是明文 Token的问题**。它比 API Key 更敏感——是完整的登录凭据，拿到就能以用户身份下单；

于是，我们复用项目已有的 SecretCipher，落 Redis 前统一加密，取出后再解密：

```text
redisTemplate.opsForValue()
        .set(KEY_PREFIX + userId, secretCipher.encrypt(tokenJson), TOKEN_TTL);
```

```text
String decrypted = secretCipher.decrypt(stored);
```

本地文件残留，内容不断膨胀

用户每被调度到一个新节点，就在那个节点留下一份**长期不变的明文 Token**。

也是我们搞了个RghWorkspaceCleaner 每天 03:15（低峰，避免与用户操作竞争目录）执行两级保留期：

| 对象 | 保留期 | 理由 |
| --- | --- | --- |
| 登录输出文件（含授权链接） | 1 小时 | 授权窗口只有几分钟，过期即无用 |
| 整个用户目录 | 7 天 | 够覆盖一次连续出差，又不长期堆积 |

本地只是投影，删掉最坏的后果就是下次命令重新从 Redis 拉一份。如果 Redis 不是权威源，这个清理任务根本不敢写。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a74667c3fb9180001e328c5
