---
title: "✅基于Token 直接配置方式做鉴权"
---

# ✅基于Token 直接配置方式做鉴权

基于Token直接配置方式鉴权的方式，就是用户自己去第三方页面领一个长期有效的 API Key，然后**直接把这串 Key 贴给 Agent**，系统把它安全存起来，后续调用时自动拿出来用。没有回调、没有 code 交换、没有刷新逻辑。

Step 1、告知用户需要提供API Key

用户第一次用我们的系统的时候，他肯定是不知道需要提供哪些key的，我们也没必要让用户一开始就提供一堆key。所以，我们需要有一个机制，检查用户是否通过了key，以及告知用户需要提供key。

我们开发了一个工具——ApiKeyTools，在这个工具中，我们检查用户是否提供了API Key：

```text
@Tool(name = "check_tuniu_api_key",
      description = "检查当前用户是否已配置途牛旅行服务的 API Key（TUNIU_API_KEY）。"
                  + "在执行任何机票、酒店、火车票等途牛服务调用之前必须先调用此工具。"
                  + "若返回 hasKey=false，需要引导用户前往 https://open.tuniu.com/mcp/login 获取 API Key，"
                  + "然后使用 save_tuniu_api_key 工具保存。")
public Map<String, Object> checkTuniuApiKey(AgentSessionContext sessionCtx) {
    ProviderConfig cfg = PROVIDERS.get("tuniu-cli");
    String userId = sessionCtx.getUserId();
    boolean hasKey = apiKeyService.hasApiKey(userId, cfg.name());
    logger.info("[TOOL][check_tuniu_api_key] userId={}, hasKey={}", userId, hasKey);

    if (hasKey) {
        return Map.of(
                "hasKey", true,
                "message", "✅ 途牛 API Key 已配置，可以直接使用途牛旅行服务。"
        );
    } else {
        return Map.of(
                "hasKey", false,
                "message", "❌ 尚未配置途牛 API Key。请引导用户前往 " + cfg.guideUrl()
                         + " 获取 API Key，获取后请用户提供 Key，然后调用 save_tuniu_api_key 保存。"
        );
    }
}
```

并且我们在Skill的提示词中明确要求，这个工具会在Agent执行具体的CLI动作之前先执行：

```text
## 配置与 API Key 安全

- **TUNIU_API_KEY** 是途牛开放平台的敏感凭证，每个用户独立保存。**执行任何 `tuniu call` 前，必须先调用 `check_tuniu_api_key` 检查用户是否已配置。**
- 已配置：直接调用 `tuniu`，不要重复索要。
- 未配置：提示用户前往 [途牛开放平台](https://open.tuniu.com/mcp/login) 获取；仅当用户主动提供并希望配置时，才调用 `save_tuniu_api_key` 保存。
- **Agent 会在执行 `tuniu call` 前自动注入当前用户的 `TUNIU_API_KEY`**，命令中无需也不应硬编码真实 Key。
- 不要明文复述密钥（只用脱敏形式如 `sk-****abcd`）；不要代替用户执行含真实密钥的 shell 命令。
```

在检查的时候，会判断用户的key是否存在，如果存在则放过，如果不存在则提示用户不存在key，并告知如何申请和提供对应的key。

![](assets/1415356108af.png)

Step2、用户提供API Key后存储

上面这一步用户如果发现自己没有配置key，就会去对应的网站申请key，然后他主动提供给agent，agent会把这个key保存下来。存储逻辑如下：

```text
// 双写：MySQL + Redis
public void saveApiKey(String userId, String provider, String apiKey) {
    String encrypted = encrypt(apiKey);
    
    // MySQL：持久化存储（upsert 语义：先删后插）
    apiKeyMapper.delete(new LambdaQueryWrapper<UserApiKeyEntry>()
            .eq(UserApiKeyEntry::getUserId, userId)
            .eq(UserApiKeyEntry::getProvider, provider));
    apiKeyMapper.insert(new UserApiKeyEntry(userId, provider, encrypted));
    
    // Redis：缓存层，TTL 7 天
    String cacheKey = "apikey:" + provider + ":" + userId;
    redisTemplate.opsForValue().set(cacheKey, encrypted, Duration.ofDays(7));
}
```

我们采用MySQL+Redis双端存储，既能持久化，又能提升查询效率。myslq的表结果如下：

**MySQL 表结构（user_api_key）**：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | BIGINT AUTO_INCREMENT | 主键 |
| user_id | VARCHAR | 用户 ID |
| provider | VARCHAR | 服务商标识（如flight-manager、tuniu-cli） |
| api_key_enc | VARCHAR | AES 加密后的 Base64 密文 |

这个saveApiKey也会作为工具注册到agent中，同时提示词中也告知agent需要再用户提供之后，调对应的工具保存。（上面的提示词中已经有了）

Step 3、命令执行时的动态注入

LLM在调用外部工具时，我们需要把命令中的key替换成对应的用户提供的API Key，这时候就需要实现动态的注入。

为此，我们实现了一个AbstractShellApiKeyHook.java。它监听 PreActingEvent——即"工具（shell 命令）即将真正执行、但还没执行"的时机，拦截 execute_shell_command，把 Key 注进去。

统一注入流程（模板方法模式）：取命令 → 子类判断要不要处理 → 从会话拿 userId → Service 解密取 Key → 子类决定怎么改命令 → 用新命令替换掉原 ToolUseBlock：

```text
// AbstractShellApiKeyHook.java L67-119（节选）
protected Mono<PreActingEvent> handlePreActing(PreActingEvent event) {
    ToolUseBlock toolUse = event.getToolUse();
    if (toolUse == null || !SHELL_TOOL_NAME.equals(toolUse.getName())) {
        return Mono.just(event);
    }
    Map<String, Object> input = toolUse.getInput();
    if (input == null) return Mono.just(event);

    String command = (String) input.get("command");
    if (command == null || !shouldHandle(command)) {       // 子类：这条命令归我管吗？
        return Mono.just(event);
    }

    AgentSessionContext sessionCtx = AgentSessionContextHolder.get();
    if (sessionCtx == null) { ... return Mono.just(event); }

    String userId = sessionCtx.getUserId();
    String apiKey = apiKeyService.getApiKey(userId, providerName());   // 解密取明文
    if (apiKey == null) {
        logger.warn("[{}] 用户未配置 API Key, userId={}", logTag(), userId);
        return Mono.just(event);
    }

    String newCommand = transformCommand(command, apiKey);   // 子类：怎么把 Key 注进去？
    if (newCommand == null || newCommand.equals(command)) {
        return Mono.just(event);
    }

    Map<String, Object> newInput = new HashMap<>(input);
    newInput.put("command", newCommand);
    ToolUseBlock newToolUse = new ToolUseBlock(
            toolUse.getId(), toolUse.getName(), newInput,
            toolUse.getContent(), toolUse.getMetadata());
    event.setToolUse(newToolUse);                            // 替换掉原 ToolUse
    return Mono.just(event);
}
```

**途牛子类：环境变量前缀注入**。文件 TuniuApiKeyHook.java：

```text
// TuniuApiKeyHook.java L17-44
private static final String TUNIU_CMD = "tuniu ";
private static final String ENV_PREFIX = "TUNIU_API_KEY=";
private static final String EXPORT_PREFIX = "export TUNIU_API_KEY";
private static final String ENV_INJECT_PREFIX = "env TUNIU_API_KEY=";

@Override protected String providerName() { return "tuniu-cli"; }
@Override protected String logTag() { return "TuniuApiKey"; }

@Override
protected boolean shouldHandle(String command) {
    // 命中 tuniu 命令，且未通过 env 或 export 手动注入过 Key（防重复注入）
    return command.contains(TUNIU_CMD)
            && !command.contains(ENV_PREFIX)
            && !command.contains(EXPORT_PREFIX);
}

@Override
protected String transformCommand(String command, String apiKey) {
    // 用 env 注入环境变量，不影响命令中原有的引号转义
    return ENV_INJECT_PREFIX + apiKey + " " + command;   // → env TUNIU_API_KEY=<key> tuniu ...
}
```

Key的加密&脱敏

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a71bdf5a7c8ff000124c795
