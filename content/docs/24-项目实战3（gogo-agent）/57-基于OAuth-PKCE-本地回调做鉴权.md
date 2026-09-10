---
title: "✅基于OAuth PKCE + 本地回调做鉴权"
---

# ✅基于OAuth PKCE + 本地回调做鉴权

我们还集成了rolling go的工具，他会用到一个CLI命令rgh，源码在这:[https://www.npmjs.com/package/@rollinggo/hotel](https://www.npmjs.com/package/@rollinggo/hotel)

rgh实现了一个非常标准的 **OAuth 2.0 + PKCE 登录流程。**他的核心流程如下：

rgh鉴权流程

![](assets/2fe63c89f6ad.svg)

初始化与 PKCE 参数生成

- **生成随机数**：使用 `crypto` 模块生成 `code_verifier`（随机字符串）和 `session_id`。
- **生成 Challenge**：对 `code_verifier` 进行 SHA256 哈希运算，生成 `code_challenge`。这是 PKCE 规范的核心，用于防止授权码拦截攻击。

获取授权 State

- **发起请求**：向中转服务器（`oauthServerUrl`）的 `/init` 接口发送 POST 请求。
- **传递参数**：将 `session_id`、`code_verifier` 和 `client_id` 发送给服务器。
- **获取结果**：服务器返回一个 `state`（通常是 JWT 格式）和一个用于后续轮询的短 `session_id`（`pollKey`）。

构建授权链接与短链接

- **拼接 URL**：构建完整的 OAuth 授权 URL，包含 `response_type=code`、`client_id`、`redirect_uri`、`state`、`code_challenge` 以及申请的权限范围（`scope` 包含酒店订单的读取、预订和取消权限）。
- **生成短链接**：调用短链接服务将长授权 URL 转换短链接，方便在终端展示。
- **展示二维码**：在终端打印二维码（通过 `qrserver.com` 生成）和链接，引导用户扫码或点击跳转浏览器进行授权。

轮询获取 Token

- **循环检查**：代码进入一个轮询循环（最多 150 次，每次间隔 2 秒，约 5 分钟超时）。
- **查询状态**：使用之前获取的 `pollKey` 向中转服务器的 `/token` 接口发起 GET 请求。
- **处理响应**：
- `pending`：用户尚未完成授权，继续等待。
- `expired`：授权会话过期，抛出错误。
- `success`：用户已授权，服务器返回 `token` 对象。

保存凭证与登录管理

- **保存 Token**：将获取到的 Token 以 JSON 格式写入本地文件（`TOKEN_PATH`）。
- **辅助功能**：代码还提供了 `isLoggedIn()`（检查本地是否有 Token）、`loadToken()`（读取 Token）和 `logout()`（删除本地 Token 文件）等工具函数，方便在其他业务逻辑中复用鉴权状态。

默认CLI的问题

rgh 的鉴权方案挺好的，但是这不代表 RollingGo 就是一个非常好的Skill了，作为一个桌面化Agent的skill来说，他是合适的，比如qoderwork，openclaw这些，都是可以的（本来可能也是这么设计的）。但是如果要被我们这样的项目集成用在生产环境中，还是存在很大的问题的。

整个流程强依赖本地文件（`TOKEN_PATH`）来存储 Token。这就带来两个层面的问题：

**同机多用户互相覆盖**。rgh 默认把 Token 写在当前进程 HOME 下的全局路径。gogo-agent 是一个多用户服务，所有用户共用同一个 JVM 进程、同一个 HOME——A 用户登录写的 token.json 会被 B 用户登录直接覆盖。

**跨节点登录态漂移**。用户在节点 A 登录，token.json 落在 A 的磁盘上；下一个请求被负载均衡路由到节点 B，B 的磁盘上根本没有这个文件，rgh 一执行就是"未登录"。

为了解决以上问题，我们针对rgh做了改造和适配。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a71be10c71a8900019103b3
