---
title: "✅上下文压缩：micro_compact"
---

# ✅上下文压缩：micro_compact

在前面的课程中，我们围绕 SkillsReactAgent 实现了 Agent Skills 系统的相关功能，但在实际使用中，尤其是处理长链路的复杂任务时，你会发现一个问题：**Agent 跑着跑着就变笨了，甚至开始偏离主题**。

以 PPT 生成场景为例，一个复杂的 PPT 任务可能需要 Agent 执行 15-20 轮工具调用，每轮调用都会产生大量的 ToolResponse 内容（文件列表、文件内容、命令执行结果等）。这些内容全部堆积在对话上下文中，很快就会逼近模型的上下文窗口限制。**Agent 的对话上下文会持续膨胀，而模型的上下文窗口是有限的**。

所以，这节课，我们来实现 dodo-agent 的上下文压缩机制。这个机制分为两层：

- **Layer 1 - micro_compact**：每轮自动执行的轻量级压缩，替换旧的工具调用内容为占位符
- **Layer 2 - auto_compact**：token 超阈值时触发的重量级压缩，用 LLM 摘要替换所有旧消息

为什么需要 micro_compact

先看一个实际的例子。假设 Agent 正在执行一个 PPT 生成任务，对话历史可能长这样：

```text
Round 1:  User → 助手回复 → read_file("PPT结构.json")
          → ToolCall args: 50 字符（文件路径）
          → ToolResponse: 3200 字符（文件内容）

Round 2:  助手回复 → write_file("slide1.py")
          → ToolCall args: 3500 字符（完整的 Python 脚本代码）
          → ToolResponse: 50 字符（"写入成功"）

Round 3:  助手回复 → bash("python slide1.py")
          → ToolCall args: 100 字符（命令）
          → ToolResponse: 1800 字符（命令输出）

Round 4:  助手回复 → read_file("PPT结构.json")
          → ToolCall args: 50 字符
          → ToolResponse: 3200 字符（同 Round 1）

Round 5:  助手回复 → write_file("slide2.py")
          → ToolCall args: 3800 字符（另一份完整 Python 脚本）
          → ToolResponse: 50 字符

Round 6:  助手回复 → bash("python slide2.py")
          → ToolCall args: 100 字符
          → ToolResponse: 1600 字符
...
```

到 Round 6 的时候，上下文中已经累积了大量的内容。注意这里膨胀来自两个方向：

- **ToolResponse（工具返回）**：read_file 返回的文件内容、bash 返回的命令输出，每轮几千字符
- **ToolCall args（工具调用参数）**：write_file 的参数是完整的 Python 脚本代码，每次调用也是几千字符

两者加起来超过 17000 字符。而且你会发现一个关键特征：**Round 1 的 read_file 返回结果和 Round 2 的 write_file 参数，对 Round 6 的决策几乎没有任何帮助** —— Agent 已经不需要那份 3200 字符的文件内容，也不需要之前写入的完整脚本代码了，但它们仍然占据着上下文空间。

**这就好比 JVM 中的内存管理：年轻代中的对象，大部分都是朝生夕死的，用完就可以回收了。Agent 的工具调用结果也是一样的。最近几轮的内容是热的，是有用处的，那就需要保留；更早的内容已经过期了，对当前没有太多作用，可以被安全地替换，只需要知道曾经调用过就好了。**

**micro_compact 就像是 JVM 的 Young GC：频繁触发、开销低、针对性强、回收短命对象。** 它不做摘要，不调 LLM，只是简单地用占位符替换掉旧的工具调用内容，释放上下文空间。

整体设计

上下文压缩功能位于 `context` 包下，包含三个核心类：

```java
context/
├── ContextPolicy.java      -- 上下文压缩策略配置（阈值、保留数量、保护工具等）
├── ContextCompactor.java   -- 上下文压缩器（micro_compact + auto_compact）
└── TokenEstimator.java     -- Token 估算工具（中英文差异化计算）
```

在 SkillsReactAgent 中，压缩发生在每轮 LLM 调用之前：

```java
// SkillsReactAgent.scheduleRound()
if (contextCompactor != null) {
    contextCompactor.compact(messages, currentQuestion);
    log.info("=== Round {} 压缩后消息数: {} ===", round, messages.size());
}
```

压缩是可选的 —— 只有在构建 Agent 时配置了 `ContextPolicy`，压缩器才会被创建和执行：

```java
this.contextCompactor = contextPolicy != null
        ? new ContextCompactor(contextPolicy, chatModel)
        : null;
```

本节我们先聚焦 micro_compact，下面逐个看这三个类的实现。

ContextPolicy：压缩策略的配置中心

ContextPolicy 是一个 record，定义了压缩行为的所有可配置参数：

```java
public record ContextPolicy(
    int tokenThreshold,     // auto_compact 的 token 阈值（本节暂不涉及）
    int keepRecentTools,    // micro_compact 保留最近几轮工具调用的完整内容
    int maxToolLength,      // 工具内容压缩阈值（ToolResponse 和 ToolCall 统一使用）
    Set<String> protectedTools  // 受保护的工具，不会被压缩
) { ... }
```

对于 micro_compact 来说，关键的三个参数是：

**keepRecentTools（默认 4）**：保留最近 N 轮工具调用的完整内容。比如设为 4，意味着最近 4 次 ToolResponse 和 4 次 AssistantMessage 中的 ToolCall 参数保持原样不动，只有更早的才会被替换。

**maxToolLength（默认 200）**：触发压缩的长度阈值。当旧的 ToolResponse 内容或 ToolCall 参数超过这个长度时，替换为占位符。设为 200 是一个比较合理的值 —— 大部分工具调用的短结果（如写入成功、状态查询）都不会超过 200 字符，而文件内容、命令输出等大块内容则会被压缩。

**protectedTools**：内置保护工具 `Skill`（以及其他自定义保护工具）。Skill 工具的调用和返回在压缩时会被完整保留，因为 Skill 的内容（SKILL.md）对后续决策至关重要，不能丢失。你不需要手动添加 `Skill`，它已经内置在默认保护列表中了：

```java
private static final Set<String> BUILTIN_PROTECTED_TOOLS = Set.of("Skill");
```

使用时通过 Builder 创建：

```java
ContextPolicy policy = ContextPolicy.builder()
        .keepRecentTools(4)
        .maxToolLength(200)
        .protectedTools("my_custom_tool")  // Skill 已内置保护，无需手动添加
        .build();
```

TokenEstimator：不依赖分词器的 Token 估算

在进入压缩逻辑之前，需要知道当前上下文消耗了多少 token。但问题是：**准确计算 token 需要使用模型对应的分词器（tokenizer），而引入分词器这个复杂度和响应时间都会提高很多**。

所以我们的策略是：**估算，不精确计算**。估算的好处是零依赖、速度快，对于判断是否需要压缩这个场景已经非常足够了。

TokenEstimator 的核心逻辑很简单 —— 中英文分开算：

```java
private static final double CHARS_PER_TOKEN_EN = 4.0;    
private static final double CHARS_PER_TOKEN_CJK = 1.5;   // 中文：约 1.5 字符 = 1 token

public static int estimateTokens(List<Message> messages) {
    int cjkCount = 0;
    int nonCjkCount = 0;

    for (Message msg : messages) {
        int[] counts = countChars(msg);  // 遍历消息中所有文本内容，统计中英文字符数
        cjkCount += counts[0];
        nonCjkCount += counts[1];
    }

    return (int) (cjkCount / CHARS_PER_TOKEN_CJK + nonCjkCount / CHARS_PER_TOKEN_EN);
}
```

为什么中英文要分开算？因为分词器处理中英文的方式差异很大：

- 英文 "hello world" → 2 个 token，每个单词大约 1-2 个 token，平均 4 个字符一个 token
- 中文 "你好世界" → 4 个 token（每个汉字基本都是一个 token），平均 1-1.5 个字符一个 token

所以如果简单用"字符数 / 4"来估算中文内容，会严重低估 token 消耗。

micro_compact：核心压缩逻辑

micro_compact 的执行流程如下：

```java
每轮 LLM 调用前
    │
    ▼
构建 toolCallId → toolName 映射（用于从 ToolResponse 找到工具名称）
    │
    ▼
收集所有 ToolResponseMessage 的索引位置
    │
    ▼
收集所有包含 ToolCall 的 AssistantMessage 的索引位置
    │
    ▼
对旧的 ToolResponse 内容（保留最近 keepRecentTools 个）：
    ├── 受保护工具 → 跳过，不压缩
    └── 非保护工具 + 内容 > maxToolLength → 替换为 JSON 占位符
    │
    ▼
对旧的 ToolCall 参数（保留最近 keepRecentTools 个）：
    ├── 受保护工具 → 跳过，不压缩
    └── 非保护工具 + 参数 > maxToolLength → 替换为 JSON 占位符
```

下面看具体代码。

构建 toolNameMap

在压缩 ToolResponse 的时候，我们需要知道这个响应来自哪个工具，用来判断它是不是受保护工具，也要把工具名称写进占位符 JSON 里。

先看一下对话历史中消息的关联关系：

```java
messages 列表：
  [0] AssistantMessage
        ToolCall: { id="call_001", name="read_file", args='{"path":"a.txt"}' }
  [1] ToolResponseMessage
        ToolResponse: { id="call_001", name=null, responseData="文件内容..." }
```

可以看到，`ToolCall` 和 `ToolResponse` 通过 `id="call_001"` 关联在一起。`ToolCall` 里一定有工具名称 `name="read_file"`，但 `ToolResponse` 的 `name()` 在一部分模型下是 null。所以我们提前遍历所有 AssistantMessage，把 `ToolCall.id → ToolCall.name` 的映射建好：

```java
private Map<String, String> buildToolNameMap(List<Message> messages) {
    Map<String, String> map = new HashMap<>();
    for (Message msg : messages) {
        if (msg instanceof AssistantMessage am && am.getToolCalls() != null) {
            for (AssistantMessage.ToolCall tc : am.getToolCalls()) {
                map.put(tc.id(), tc.name());  // call_001 → read_file
            }
        }
    }
    return map;
}
```

后面处理 ToolResponse 时，就可以这样拿到工具名称：

```java
String toolName = resp.name() != null ? resp.name() :
        toolNameMap.getOrDefault(resp.id(), "unknown");
```

优先用 ToolResponse 自带的 name，如果为 null 就通过 id 反查。

替换旧的 ToolResponse 内容

```java
// 保留最近 keepRecentTools 个，只压缩更早的
int trmKeepCount = Math.min(policy.keepRecentTools(), trmIndices.size());
int trmClearCount = trmIndices.size() - trmKeepCount;

for (int idx = 0; idx < trmClearCount; idx++) {
    int msgIndex = trmIndices.get(idx);
    ToolResponseMessage original = (ToolResponseMessage) messages.get(msgIndex);

    List<ToolResponseMessage.ToolResponse> replaced = new ArrayList<>();
    for (var resp : original.getResponses()) {
        String content = resp.responseData();
        String toolName = resp.name() != null ? resp.name() :
                toolNameMap.getOrDefault(resp.id(), "unknown");

        // 跳过受保护的工具（如 Skill）
        if (policy.isProtected(toolName)) {
            replaced.add(resp);
            continue;
        }

        // 替换长内容为占位符
        if (content != null && content.length() > policy.maxToolLength()) {
            content = "{\"compacted\":true,\"tool\":\"" + toolName
                    + "\",\"originalLength\":" + content.length()
                    + ",\"message\":\"content compressed\"}";
        }
        replaced.add(new ToolResponseMessage.ToolResponse(resp.id(), resp.name(), content));
    }
    messages.set(msgIndex, ToolResponseMessage.builder().responses(replaced).build());
}
```

这里有一个很关键的细节。

占位符必须是合法 JSON

这个看似简单的占位符格式，其实是我踩过坑之后的改进。一开始设计的时候，ToolResponse 的占位符用的是自然语言的格式：

```text
[Previous: used read_file, result was 3200 chars]
```

看起来很直观对吧？但实际跑起来发现了一个问题：**大模型在处理对话历史时，会尝试解析 ToolResponse 的内容。所以可能会直接报错400参数错误。**

而 ToolCall 参数那边，一开始就是用 JSON 占位符的：

```text
{"_compacted": true, "_original_length": 3200, "_tool": "read_file"}
```

这就造成了另一个问题：**ToolResponse 和 ToolCall 的占位符格式不统一**。一边是自然语言纯文本，一边是 JSON。模型在处理上下文时，两种格式混在一起，增加了额外的理解负担。

最终的解决方案：**两边统一为 JSON 格式，且字段命名保持一致**（`compacted`、`tool`、`originalLength`、`message`），这样模型处理起来更加一致和可预测：

```text
{"compacted":true,"tool":"read_file","originalLength":3200,"message":"content compressed"}
```

**在 LLM 的上下文中，工具返回的数据应该保持结构化格式（JSON），千万不要用自然语言描述来代替**。

替换旧的 ToolCall 参数

ToolCall 参数的压缩逻辑和 ToolResponse 类似：

```java
if (policy.maxToolLength() > 0) {
    int ascKeepCount = Math.min(policy.keepRecentTools(), assistantWithToolCallIndices.size());
    int ascClearCount = assistantWithToolCallIndices.size() - ascKeepCount;

    for (int idx = 0; idx < ascClearCount; idx++) {
        int msgIndex = assistantWithToolCallIndices.get(idx);
        AssistantMessage original = (AssistantMessage) messages.get(msgIndex);

        List<AssistantMessage.ToolCall> replacedCalls = new ArrayList<>();
        for (AssistantMessage.ToolCall tc : original.getToolCalls()) {
            // 跳过受保护的工具
            if (policy.isProtected(tc.name())) {
                replacedCalls.add(tc);
                continue;
            }

            String args = tc.arguments();
            if (args != null && args.length() > policy.maxToolLength()) {
                args = "{\"compacted\":true,\"tool\":\"" + tc.name()
                        + "\",\"originalLength\":" + args.length()
                        + ",\"message\":\"args compressed\"}";
            }
            replacedCalls.add(new AssistantMessage.ToolCall(
                    tc.id(), tc.type(), tc.name(), args));
        }
        messages.set(msgIndex, AssistantMessage.builder()
                .content(original.getText())
                .toolCalls(replacedCalls)
                .build());
    }
}
```

protectedTools

受保护的工具（默认包含 `Skill`）在 micro_compact 中不会被压缩。为什么？

因为 Skill 的 ToolResponse 返回的是 SKILL.md 的完整内容 —— 这是一份详细的执行指南，Agent 后续的每一轮决策都依赖它。如果把这个内容压缩成占位符，Agent 就没有执行说明书了，当然也就不知道该怎么继续执行任务了。

所以 protectedTools 的设计思路是：**对于需要持续参考的工具，保留其完整内容**。Skill 是内置的，你也可以通过 Builder 添加自定义保护工具。

micro_compact 的效果估算

假设一个 Agent 执行了 10 轮工具调用，每轮产生平均 2000 字符的 ToolResponse 内容。在 keepRecentTools=4 的情况下：

- 压缩前：10 轮 × 2000 字符 = 20000 字符（约 13300 个 token for CJK）
- 压缩后：6 轮 × 约 80 字符（JSON 占位符）+ 4 轮 × 2000 字符 = 8480 字符（约 5650 个 token）
- **节省约 57% 的上下文空间**

而且这个操作的开销极低，只是遍历消息列表、替换字符串，不涉及任何 LLM 调用。每轮执行一次，对性能几乎没有影响。

micro_compact 之后，旧内容变成了占位符，但是它仍然占据少量空间。当消息数量持续增长、占位符也累积到一定程度时，micro_compact 就不够用了。

这时候就需要 Layer 2 —— auto_compact 出场了，它就像是 JVM 的 Full GC，做一次彻底的清理。我们下一节来详细讲解。

小结

1. **micro_compact：是 Agent 上下文管理的第一道防线**，每轮自动执行，开销极低
2. **核心思路是保留最近、压缩历史**：最近 N 轮工具调用保持完整，更早的内容替换为 JSON 占位符
3. **占位符必须是合法 JSON 格式**：这是在实践中踩过坑的，自然语言格式的占位符会导致模型报错
4. **ToolResponse 和 ToolCall 使用统一的阈值和格式**：保持一致性
5. **protectedTools 机制：保护关键工具内容**不被压缩（Skill 是内置保护的）
6. **TokenEstimator：使用中英文差异化估算**，零依赖、速度快

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a04482c74e4030001905c69
