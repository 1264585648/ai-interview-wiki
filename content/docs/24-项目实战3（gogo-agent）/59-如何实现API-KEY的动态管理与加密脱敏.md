---
title: "✅如何实现API KEY的动态管理与加密、脱敏"
---

# ✅如何实现API KEY的动态管理与加密、脱敏

本文部分内容和[56-✅基于Token 直接配置方式做鉴权.md](56-✅基于Token 直接配置方式做鉴权.md) 有重合，但是侧重点不同，建议结合着看。

gogo-agent 是一个差旅智能体，它需要调用多个第三方服务（机票搜索、酒店预订、火车票查询），每个服务都需要 API Key。这带来了一组工程挑战：

1. **存储安全**：API Key 不能明文落库，泄露即资损
2. **多用户隔离**：每个用户有自己的 Key，不能串用
3. **Agent 安全**：LLM 不应该"看到"真实 Key（否则可能在回复中泄露）
4. **输出安全**：即使 Key 意外出现在工具返回中，也要在到达前端之前被拦截
5. **使用便捷**：对 LLM 和用户来说，Key 的管理应该是透明的

gogo-agent 设计了一套**四层防护体系**来解决这些问题：加密存储 → 动态注入 → 输出脱敏 → 日志脱敏。下面逐层拆解。

![](assets/0613ae477811.png)

**核心设计原则：LLM 永远不接触明文 Key。** Key 的注入发生在 LLM 推理完成之后、Shell 执行之前——这是一个 LLM 看不到的"暗区"。

第一层：加密存储

因为 Key 是**用户的个人凭证**——Agent 不能预先配置所有用户的 Key。用户第一次使用服务时，Agent 需要引导用户获取并保存 Key。之后的使用则自动复用。

当LLM需要执行某个工具时，如果发现需要用key，则会返回让用户补充，用户补充后，LLM会把这个key做加密存储。

加密方案

```text
// ApiKeyService.java
@Value("${app.api-key-encrypt-secret:gogo-travel-default-secret}")
private String encryptSecret;

@PostConstruct
public void init() {
    this.aesKey = deriveAesKey(encryptSecret);
}

private SecretKeySpec deriveAesKey(String secret) {
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    byte[] hash = digest.digest(secret.getBytes(StandardCharsets.UTF_8));
    byte[] keyBytes = new byte[16];              // 取前 16 字节
    System.arraycopy(hash, 0, keyBytes, 0, 16);
    return new SecretKeySpec(keyBytes, "AES");   // AES-128
}
```

**密钥派生流程**：配置密钥 → SHA-256 哈希 → 取前 16 字节 → AES-128 密钥

**加密算法**：AES/ECB/PKCS5Padding，输出 Base64 编码的密文字符串

**为什么这样设计**：

- SHA-256 哈希确保无论配置密钥多长多短，最终 AES 密钥都是固定 16 字节
- AES-128 在性能和安全性之间取得平衡（每次读取都需要解密，频率高）
- Base64 编码确保密文可以安全存入 MySQL VARCHAR 字段和 Redis String

存储位置

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

**MySQL 表结构（user_api_key）**：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | BIGINT AUTO_INCREMENT | 主键 |
| user_id | VARCHAR | 用户 ID |
| provider | VARCHAR | 服务商标识（如<br>flight-manager<br>、<br>tuniu-cli<br>） |
| api_key_enc | VARCHAR | AES 加密后的 Base64 密文 |

**重要细节：Redis 里存的也是密文**，不是明文。即使 Redis 被攻破，攻击者拿到的仍然是加密后的字符串。解密需要 app.api-key-encrypt-secret 配置值。

读取流程（缓存优先）

```text
public String getApiKey(String userId, String provider) {
    // 1. 尝试 Redis 缓存
    String cacheKey = "apikey:" + provider + ":" + userId;
    String cached = redisTemplate.opsForValue().get(cacheKey);
    if (cached != null) {
        return decrypt(cached);  // 命中缓存：解密后返回明文
    }
    
    // 2. Redis 未命中 → 查 MySQL
    UserApiKeyEntry entry = apiKeyMapper.selectOne(...);
    if (entry == null) return null;
    
    // 3. 回填 Redis 缓存
    redisTemplate.opsForValue().set(cacheKey, entry.getApiKeyEnc(), Duration.ofDays(7));
    
    return decrypt(entry.getApiKeyEnc());
}
```

**明文只存在于 JVM 内存中**，且仅在 getApiKey() 返回值到 Hook 注入命令这一瞬间。不落盘、不写日志。

第二层：LLM 侧的工具接口

工具设计：check + save 配对

```text
@Tool(name = "check_flight_api_key",
      description = "检查当前用户是否已配置机票服务的 API Key。"
                  + "在执行任何航班搜索、预订等操作之前必须先调用此工具。"
                  + "若返回 hasKey=false，需要引导用户前往获取页面...")
public Map<String, Object> checkFlightApiKey(AgentSessionContext sessionCtx) {
    boolean hasKey = apiKeyService.hasApiKey(sessionCtx.getUserId(), "flight-manager");
    if (hasKey) {
        return Map.of("hasKey", true, "message", "✅ 机票 API Key 已配置");
    } else {
        return Map.of("hasKey", false, "message", "❌ 尚未配置，请引导用户前往...");
    }
}
```

```text
@Tool(name = "save_flight_api_key",
      description = "保存用户的机票 API Key。用户获取 Key 后调用此工具加密保存...")
public Map<String, Object> saveFlightApiKey(AgentSessionContext sessionCtx, String apiKey) {
    // 1. 空值校验
    if (apiKey == null || apiKey.isBlank()) return fail("不能为空");
    // 2. 前缀校验（机票 Key 必须以 sk_ 开头）
    if (!apiKey.startsWith("sk_")) return fail("格式不正确");
    // 3. 加密保存
    apiKeyService.saveApiKey(userId, "flight-manager", apiKey.trim());
    return success("✅ 已保存，后续服务调用将自动使用");
}
```

**关键设计**：

- **先 check 后 save** — 通过 tool description 要求 LLM 在使用服务前先检查 Key 状态
- **前缀校验** — sk_（机票）、sk-（途牛），防止用户粘贴错误内容
- **Agent 永远不回显 Key** — save 的返回值只有 "已保存"，不包含 Key 本身

Hook 动态注入

LLM 需要生成包含 API Key 的 shell 命令来调用外部服务。但如果 Key 出现在 LLM 的输入/输出上下文中，就有被泄露的风险（LLM 可能在回复中复述命令内容）。

**解决方案：占位符 + Hook 注入。**

- Skill 模板中用占位符代替真实 Key（如 $&#123;FLIGHT_API_KEY&#125;）
- LLM 生成的命令包含占位符，而非真实 Key
- 在命令实际执行前的最后一刻，Hook 把占位符替换为真实 Key
- 替换发生在 Hook 层，不进入 LLM 的上下文

抽象基类：模板方法模式

```text
public abstract class AbstractShellApiKeyHook implements Hook {

    @Override
    public int priority() { return 3; }  // 优先级 3，早于用户隔离 Hook(5)

    @Override
    public final <T extends HookEvent> Mono<T> onEvent(T event) {
        if (event instanceof PreActingEvent preActing) {
            return handlePreActing(preActing);
        }
        return Mono.just(event);
    }

    protected Mono<PreActingEvent> handlePreActing(PreActingEvent event) {
        ToolUseBlock toolUse = event.getToolUse();
        
        // 1. 只拦截 execute_shell_command
        if (!SHELL_TOOL_NAME.equals(toolUse.getName())) return pass;
        
        // 2. 子类判断：这条命令是否需要注入？
        String command = (String) toolUse.getInput().get("command");
        if (!shouldHandle(command)) return pass;
        
        // 3. 从 DB/Redis 读取并解密 Key
        String apiKey = apiKeyService.getApiKey(userId, providerName());
        if (apiKey == null) return pass;
        
        // 4. 子类完成注入
        String newCommand = transformCommand(command, apiKey);
        
        // 5. 替换 ToolUseBlock（LLM 不感知这个替换）
        event.setToolUse(newToolUseWithCommand(newCommand));
        return Mono.just(event);
    }

    protected abstract String providerName();
    protected abstract boolean shouldHandle(String command);
    protected abstract String transformCommand(String command, String apiKey);
}
```

两种注入策略

**策略一：占位符替换（FlightApiKeyHook）**

```text
// Skill 模板中预埋占位符
// LLM 生成的命令：curl -H "Authorization: ${FLIGHT_API_KEY}" https://fly.huoli.com/...

@Override
protected boolean shouldHandle(String command) {
    // 同时包含占位符 + 端点域名（占位符天然防重复注入）
    return command.contains("${FLIGHT_API_KEY}") 
        && command.contains("fly.huoli.com");
}

@Override
protected String transformCommand(String command, String apiKey) {
    return command.replace("${FLIGHT_API_KEY}", apiKey);
}
```

**优势**：占位符本身就是防重复注入的标志——替换后占位符消失，不会被二次处理。

**策略二：环境变量前置（TuniuApiKeyHook）**

```text
// LLM 生成的命令：tuniu call flight search -a '{"origin":"SHA"}'

@Override
protected boolean shouldHandle(String command) {
    // 包含 tuniu 命令，且没有手动注入过（防重复）
    return command.contains("tuniu ")
        && !command.contains("TUNIU_API_KEY=")
        && !command.contains("export TUNIU_API_KEY");
}

@Override
protected String transformCommand(String command, String apiKey) {
    // 在命令前注入环境变量
    return "env TUNIU_API_KEY=" + apiKey + " " + command;
}
```

**优势**：不修改命令本身，只通过 env 前缀注入环境变量。CLI 工具从环境变量读取 Key，对命令格式零侵入。

完整流程：

```text
LLM 推理完成
    │
    ▼ 决定调用 execute_shell_command
    │ command = "tuniu call flight search -a '{...}'"
    │
    ▼ AgentScope 框架发出 PreActingEvent
    │
    ├── [Priority 3] TuniuApiKeyHook.onEvent()
    │       ├── shouldHandle("tuniu call...") → true
    │       ├── apiKeyService.getApiKey(userId, "tuniu-cli")
    │       │       ├── Redis GET "apikey:tuniu-cli:user123" → 密文
    │       │       └── decrypt(密文) → "sk-abc123real"
    │       └── transformCommand → "env TUNIU_API_KEY=sk-abc123real tuniu call..."
    │       └── event.setToolUse(新命令)
    │
    ├── [Priority 5] RghUserIsolationHook.onEvent()
    │       └── (不匹配 rgh 命令，跳过)
    │
    ▼ ShellCommandTool.execute("env TUNIU_API_KEY=sk-abc123real tuniu call...")
    │
    ▼ 返回执行结果 → PostActingEvent
    │
    ▼ ProgressNotifierHook → SensitiveMasker.mask(result) → SSE 推送（已脱敏）
```

输出脱敏

即使前面所有层都正常工作（Key 不出现在 LLM 上下文中），仍然有意外情况：

- 工具执行结果可能包含 Key（比如 CLI 输出了配置信息）
- 错误堆栈可能暴露环境变量
- 日志中可能有敏感字段

SensitiveMasker 就是应对这些"边缘情况"的兜底机制。

脱敏策略

```text
//SensitiveMasker
public static String mask(String text) {
    // 顺序有讲究：先身份证，再银行卡（避免 18 位身份证被银行卡规则误匹配）
    String masked = maskPattern(text, ID_CARD, ID_NO_STRATEGY);
    masked = maskPattern(masked, BANK_CARD, CARD_ID_STRATEGY);
    masked = maskPattern(masked, PHONE, PHONE_STRATEGY);
    masked = maskPattern(masked, EMAIL, EMAIL_STRATEGY);
    masked = maskPattern(masked, SK_KEY, MASK_ALL_STRATEGY);     // sk-xxx 全量脱敏
    masked = maskKvSecrets(masked);                               // key=value 值脱敏
    return masked;
}
```

**六种脱敏模式**：

| 类型 | 正则特征 | 脱敏策略 | 示例 |
| --- | --- | --- | --- |
| API Key | sk-[A-Za-z0-9]&#123;6,&#125; | 全量遮盖 | sk-abc123xyz<br>→<br>************* |
| KV 秘钥 | password:xxx<br>/<br>token=xxx | 保留 key 名，遮盖 value | token: abc123<br>→<br>token: ****** |
| 手机号 | 1[3-9]\d&#123;9&#125; | 部分遮盖 | 13812345678<br>→<br>138****5678 |
| 身份证 | \d&#123;17&#125;[\dXx] | 部分遮盖 | 310101200001011234<br>→<br>310***********1234 |
| 银行卡 | \d&#123;16,19&#125; | 部分遮盖 | 6222021234567890<br>→<br>6222*********7890 |
| 邮箱 | 标准邮箱格式 | 部分遮盖 | user@example.com<br>→<br>u***@example.com |

三个脱敏注入点

```text
// 1. Agent 最终回复 → 到前端之前
// ChatAgentExecutor.java
String text = SensitiveMasker.mask(result.getTextContent());

// 2. SSE 实时推送事件 → 到前端之前
// ProgressNotifierHook.java
String masked = SensitiveMasker.mask(JSON.toJSONString(data));
emitter.send(SseEmitter.event().name(eventName).data(masked));

// 3. 应用日志 → 到磁盘/控制台之前
// logback-spring.xml
<conversionRule conversionWord="sensitive" 
                converterClass="...SensitiveMaskingConverter" />
<pattern>%d [%thread] %-5level %logger{36} - %sensitive%n</pattern>
```

不信任任何一个环节——即使 Key 不应该出现在这些地方，也要在出口做一次兜底过滤。**安全设计的原则是纵深防御，而非单点依赖。**

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a5a0bb93fb9180001cb159b
