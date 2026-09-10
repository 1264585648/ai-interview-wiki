---
title: "✅上下文压缩：auto_compact"
---

# ✅上下文压缩：auto_compact

上一节我们实现了上下文压缩的第一层 micro_compact，它像是 JVM 的 Young GC，每轮自动替换掉旧的工具调用内容，释放了大量上下文空间。

但 micro_compact 有一个局限性：它只是把大内容替换成小占位符，**消息的数量并没有减少**。当 Agent 执行了 20 轮工具调用后，即使每条 ToolResponse 都被压缩成了 80 字符的 JSON 占位符，20 条 ToolResponse + 20 条 AssistantMessage + 各种 ToolCall 参数，累积下来仍然是一个庞大的上下文。

而且占位符本身也不少，虽然单条只有 80 字符，但模型在阅读上下文时，仍然需要理解每一条占位符的含义，同样会对大模型的注意力产生影响。所以我们需要第二层防线 **auto_compact**。

如果说 micro_compact 是 Young GC，那 auto_compact 就是 **Full GC**：不常触发，但一旦触发，就是一次彻底的清理，把所有消息打包成一个精炼的摘要，让上下文重新变得干净整洁。

auto_compact 之后原始消息**彻底消失**了，只留下摘要。这意味着 auto_compact 是有损压缩，摘要必然丢失一些细节。所以**不能频繁触发**，每次触发都应该是在不得不压缩的时候。这和 Full GC 的逻辑是类似的。

auto_compact 的触发时机

auto_compact 的入口在 `compact()` 方法中，micro_compact 之后：

```java
public void compact(List<Message> messages, String currentQuestion) {
    if (messages == null || messages.size() <= 2) {
        return;
    }

    // Layer 1: micro_compact（每轮执行）
    microCompact(messages);

    // Layer 2: auto_compact（超阈值触发）
    int estimatedTokens = TokenEstimator.estimateTokens(messages);
    if (estimatedTokens > policy.tokenThreshold()) {
        log.info("Context auto_compact triggered: estimated tokens={} > threshold={}, messages={}",
                estimatedTokens, policy.tokenThreshold(), messages.size());
        autoCompact(messages, currentQuestion);
    }
}
```

关键判断是 `estimatedTokens > policy.tokenThreshold()`。micro_compact 先执行一遍，把能压缩的都压缩了，然后估算 token 数。如果还是超过阈值，就触发 auto_compact。

**这就像 Full GC 的触发逻辑：先尝试 Young GC 回收一波，如果内存还是不够，再执行 Full GC。**

tokenThreshold 默认是 60000，这个值怎么来的，后面会讲到。

auto_compact 的核心逻辑

auto_compact 的思路非常直接：**不挑挑拣拣、不选择，直接把所有旧消息（除 SystemMessage）统统交给 LLM 生成一份结构化摘要，然后用这一条摘要替换掉全部旧消息**。

来看一下压缩前后的对比：

```text
压缩前（20+ 条消息）：                              压缩后（2 条消息）：

[0]  SystemMessage（系统提示词）                 [0] SystemMessage（不变）
[1]  UserMessage（用户提问）                   [1] UserMessage（结构化摘要）
[2]  AssistantMessage（助手回复）
[3]  ToolResponseMessage（read_file 返回）
[4]  AssistantMessage（助手回复）
[5]  ToolResponseMessage（write_file 返回）
[6]  AssistantMessage（助手回复）
[7]  ToolResponseMessage（bash 返回）
[8]  AssistantMessage（助手回复）
[9]  ToolResponseMessage（read_file 返回）
[10] AssistantMessage（助手回复）
[11] ToolResponseMessage（write_file 返回）
[12] AssistantMessage（助手回复）
[13] ToolResponseMessage（bash 返回）
...
[20] AssistantMessage（最新回复）
```

从 20 多条消息，直接变成 2 条：SystemMessage + 摘要。效果非常彻底。

对应代码也很简洁：

```java
private void autoCompact(List<Message> messages, String currentQuestion) {
    // 1. 保留 SystemMessage（第一条）
    SystemMessage systemMessage = null;
    if (!messages.isEmpty() && messages.get(0) instanceof SystemMessage sm) {
        systemMessage = sm;
    }

    int systemMsgCount = systemMessage != null ? 1 : 0;

    // 2. 所有非 SystemMessage 的消息进入摘要
    List<Message> oldMessages = new ArrayList<>(
            messages.subList(systemMsgCount, messages.size()));

    // 3. LLM 生成结构化摘要（失败时回退到截断策略）
    String summary = generateSummary(oldMessages, currentQuestion);

    // 4. 重建消息列表：System → Summary
    messages.clear();
    if (systemMessage != null) {
        messages.add(systemMessage);
    }
    messages.add(new UserMessage("[对话已压缩] 以下是之前对话的摘要：\n" + summary));

    log.info("Context compacted: {} old messages summarized into structured summary",
            oldMessages.size());
}
```

但是这个直接的方案并不是一开始就这么设计的，在此之间我经历了几个关键问题的解决。

问题 1：到底应该怎么压缩，保留什么

一开始设计 auto_compact 的时候，想法是精确切割：保留最近几条消息不动，只把更早的消息交给 LLM 做摘要。具体策略是：设一个 `keepRecentMessages` 参数，比如保留最近 6 条消息，更早的压缩成摘要。最终的消息列表 = SystemMessage + 摘要 + 最近 6 条原始消息。

但这个方案在实际实现中遇到了两个问题：

**第一个问题，边界对齐。** 大模型调用的时候 ToolResponseMessage 是不能独立存在，它必须紧跟在包含对应 ToolCall 的 AssistantMessage 后面。如果切割点恰好落在一条 ToolResponseMessage 上，就会导致这条 ToolResponseMessage 前面没有对应的 AssistantMessage ，会直接报错。

所以需要做边界对齐：当切割点落在 ToolResponseMessage 上时，向前回溯找到对应的 AssistantMessage。如果模型一次返回了多个 ToolCall，一个 AssistantMessage 后面会跟着多条 ToolResponseMessage，边界对齐就更复杂了。再加上还要从旧消息中提取受保护的消息对（protectedTools 的调用组）单独保留，代码很快就变得非常复杂。

**第二个问题，压缩质量。** 当然边界对齐其实也是可以做的，但是即使做对了，这种半压缩半保留的方式本身就有问题。保留的最近几条消息是脱离了前面上下文的，前面的对话被压缩成了摘要，后面的消息是原始的。Agent 在阅读这种断层的上下文时，非常可能会产生理解偏差。比如最近几条消息中引用了前面某轮的结论，但那条消息已经被压缩进摘要了，Agent 可能找不到原始出处。

最终的解决方案就是现在的全部摘要：**不挑挑拣拣，不选择，直接所有消息都交给 LLM 处理。** 我只需要在摘要 Prompt 中描述清楚最终生成的摘要应该是什么样的、保留哪些关键信息，保证 Agent 读到摘要后的任务连续性即可。至于哪些信息重要、哪些可以丢弃，交给摘要 LLM 来判断，这比任何硬编码的规则都更灵活，而且摘要 LLM 能根据对话的实际情况做判断，实测下来，比机械的保留最近 N 条效果好得多。

问题 2：摘要需要知道当前任务是什么

在之前的版本中，摘要请求发送给 LLM 时，只包含对话文本，不包含当前用户的问题：

```java
// 原来的写法
ChatResponse response = chatModel.call(new Prompt(List.of(
    new SystemMessage(COMPACT_SUMMARY_PROMPT),
    new UserMessage(conversationText)  // 只有对话文本，没有单独列出当前问题
)));
```

这导致一个问题：**LLM 在生成摘要时，很可能不知道当前用户在问什么**。它只能平铺直叙地把对话历史压缩一遍，无法判断哪些信息对当前任务更重要。

举个例子，如果用户说"帮我生成一个技术分享 PPT"，Agent 已经执行了 10 轮工具调用，对话中包含了 PPT 结构讨论、代码生成、文件操作等各种内容。如果摘要时不知道用户的核心需求是"生成PPT"，可能会在摘要中平均分配篇幅，导致关键信息被稀释。

解决方案：**把当前用户问题传给摘要 LLM，让它知道应该重点关注什么**。

```java
// 优化后的写法
public static String getCompactSummaryUserPrompt(String conversationText, String currentQuestion) {
    return """
        请将以下对话记录压缩为结构化摘要。

        ## 当前用户请求
        %s

        ## 对话记录
        %s

        <no_think>
        """.formatted(
            currentQuestion != null && !currentQuestion.isBlank() ? currentQuestion : "无",
            conversationText != null ? conversationText : "无");
}
```

摘要 LLM 看到当前用户请求后，就能有侧重地生成摘要 —— 围绕当前任务保留关键信息，对已经完成或无关的部分做更彻底的压缩。

问题 3：构造消息尽可能保留原样

在把消息列表转成文本交给摘要 LLM 之前，需要一个 `buildConversationText` 方法把所有消息拼成一段对话文本。在我最开始做的时候，这个方法对 ToolResponse 内容做了截断 ，超过 500 字符的内容会被截断，只保留前 500 字符：

```java
if (content != null && content.length() > 500) {
    content = content.substring(0, 500) + "...[truncated]";
}
```

这会导致一个很严重的问题：**截断后的内容会让摘要 LLM 产生误判**。

举个例子，Agent 执行了 `write_file("slide1.py", "完整的Python脚本代码...")`，ToolCall 的 args 是一份 3000 字符的完整 Python 脚本。但在 buildConversationText 中，这个内容被截断成了 500 字符。摘要 LLM 看到的是一段残缺的代码，它会认为："这个任务只生成了一部分代码，文件内容是不完整的"，进而在摘要中记录"slide1.py 文件生成不完整"。但实际上文件已经成功写入了完整内容，只是我们的截断让摘要 LLM 产生了误判。

解决方案：**不需要多此一举地截断，直接原样放进去即可**。micro_compact 已经在前面把旧工具内容压缩成了 80 字符的 JSON 占位符，到 buildConversationText 的时候，消息列表已经是瘦身过的了。而最近几轮的完整内容恰恰是最重要的，更不应该被截断。

```java
// 优化后的 buildConversationText —— 不截断，原样提取
private String buildConversationText(List<Message> messages) {
    StringBuilder sb = new StringBuilder();
    for (Message msg : messages) {
        sb.append("[").append(msg.getMessageType()).append("] ");
        sb.append(extractMessageText(msg));
        sb.append("\n\n");
    }
    return sb.toString();
}
```

Token 阈值怎么设置比较合理

ContextPolicy 中 `tokenThreshold` 的默认值是 60000。这个值需要根据你使用的大模型的上下文长度来设置。

目前主流大模型的上下文窗口大约是 128K tokens。这个阈值不能设太小，也不能太大：

**设太小的问题**：比如设了 10000，Agent 执行 5-6 轮工具调用就可能触及阈值，频繁触发 auto_compact。每次触发都需要额外调用一次 LLM 生成摘要，增加响应延迟和 API 成本。而且过于频繁的压缩会损失上下文精度 —— 每次压缩都会丢失一些细节，压缩次数越多，累积的信息损失越大。一些复杂任务根本跑不完就被反复压缩了。

**设太大的问题**：比如设了 100000，那 auto_compact 基本不会触发。但如果不触发，下一轮 LLM 调用时的输入可能就直接超出模型的 128K 上下文窗口了，导致 API 报错或者模型推理质量严重下降。

所以需要取一个居中或者靠上的值。60000 大约是 128K 的一半左右 —— 给 micro_compact 留出了足够的缓冲空间，同时在上下文真正过大之前及时触发压缩。

类比一下 Claude Code 的做法：Claude Code 会在上下文使用量达到约 80%左右时触发压缩。如果把触发阈值设得太高（比如 95%），等到压缩时模型的推理质量已经下降了。**宁可早一点触发，也不要等到上下文快爆了才处理**，我们的 60000 也是类似的思路。

摘要 Prompt 的设计

auto_compact 的效果很大程度上取决于摘要 Prompt 的质量。

```text
你是对话摘要助手。你的任务是将对话记录压缩为结构化摘要，使助手能**无缝接续**未完成的任务。

  ## 核心原则
  摘要的首要目标是**任务延续性**：阅读摘要的助手必须能准确理解当前进度，并指导助手下一步该做什么、调用什么工具。

  ## 必须保留的信息（不可省略）
  1. **用户意图**：原始请求的完整含义，不能丢失任何细节
  2. **文件路径、URL、变量名**等精确引用信息，原样保留
  3. **Skill 的核心步骤/规则**：已加载 Skill 的名称、描述、以及关键执行逻辑（不是完整内容，仅核心步骤）
  4. **已完成步骤的结论**：每个工具调用产生了什么结果，成功还是失败
  5. **下一步的具体操作**：明确指出接下来要调用什么工具、传什么参数、对什么文件操作

  ## 禁止事项
  - 禁止原样复制/粘贴完整对话内容，必须提炼压缩
  - 禁止输出思考过程
  - 禁止用模糊描述替代精确信息（如"操作了某个文件"应写明具体路径）

  ## 输出格式（严格按此结构）

  ### 一、历史对话摘要
  - 之前讨论过的主要话题和关键结论
  - 用户的偏好和关注点

  ### 二、当前任务执行摘要

  #### 1. 用户请求
  （完整保留用户意图的所有细节）

  #### 2. 已加载的 Skill
  - Skill 名称、描述
  - 核心执行步骤/关键规则（摘要形式，但必须包含执行逻辑）

  #### 3. 已完成的工具调用
  逐条列出每个工具调用：
  - 调用序号. 工具名称(关键参数摘要) → 结果：成功/失败 + 关键结论

  #### 4. 已获得的关键信息
  （从工具返回中提炼的所有重要数据/结论，用要点列出，精确信息原样保留）

  #### 5. 当前进度与下一步
  - **已完成**：简要概括当前进度
  - **下一步**：具体要执行什么操作（包含具体调什么工具）
```

这个 Prompt 的核心设计理念是**任务延续性**，要记住摘要不是给人类看的总结报告，而是给失忆后的 Agent看的备忘录。Agent 读到这个摘要后，必须能准确理解：

- 用户想要什么
- 已经做了什么
- 下一步该做什么

容错：摘要失败的兜底

LLM 调用不是 100% 可靠的 —— 可能因为网络超时、API 限流、模型错误等原因失败。如果摘要生成失败，不能直接把消息列表清空（那 Agent 就彻底失忆了），需要一个兜底策略：

```java
private String generateSummary(List<Message> messages, String currentQuestion) {
    String conversationText = buildConversationText(messages);

    try {
        ChatResponse response = chatModel.call(new Prompt(List.of(
                new SystemMessage(ReactAgentPrompts.getCompactSummarySystemPrompt()),
                new UserMessage(ReactAgentPrompts.getCompactSummaryUserPrompt(
                        conversationText, currentQuestion))
        )));
        String summary = response.getResult().getOutput().getText();
        summary = ThinkTagParser.stripThinkTags(summary);
        return summary != null ? summary : "";
    } catch (Exception e) {
        log.warn("LLM summary failed, falling back to message-level truncation: {}",
                e.getMessage());
        return truncationFallback(messages);
    }
}
```

回退策略 `truncationFallback` 很简单 —— 保留最近 10 条消息，之前的直接截断丢弃：

```java
private String truncationFallback(List<Message> messages) {
    int keepCount = 10;
    int start = Math.max(0, messages.size() - keepCount);
    StringBuilder sb = new StringBuilder();
    sb.append("...[摘要生成失败，以下为最近 10 条对话内容]\n\n");
    for (int i = start; i < messages.size(); i++) {
        sb.append(extractMessageText(messages.get(i))).append("\n\n");
    }
    return sb.toString();
}
```

为什么保留最近的而不是最前面的？因为最近的对话和当前任务最相关，前面的历史信息对当前决策的帮助相对较小。

两层压缩的协作

```text
每轮 LLM 调用前
    │
    ▼
┌───────────────────────────────┐
│  Layer 1: micro_compact       │  每轮必执行
│  替换旧工具内容为 JSON 占位符     │  开销极低，无 LLM 调用
└───────────────────────────────┘
    │
    ▼
估算当前 token 数
    │
    ├─ 未超阈值 → 不触发 auto_compact，直接调 LLM
    │
    └─ 超过阈值 → 触发 auto_compact
            │
            ▼
        ┌───────────────────────────────────┐
        │  Layer 2: auto_compact            │  超阈值才执行
        │ LLM 生成结构化摘要 → 替换全部旧消息    │  开销高，需调 LLM 非流式
        └───────────────────────────────────┘
            │
            ▼
        上下文重置为：SystemMessage + 摘要消息
        （从几十条 → 2 条）
```

这个两层架构的好处是：**大部分情况下，micro_compact 就足够了，auto_compact 只在极端情况下才需要触发**。就像 JVM 中，大部分 GC 都是 Young GC，Full GC 很少发生，如果频繁发生 Full GC，说明需要调优参数了。

总结

上下文压缩是 Agent 长时间运行的关键基础功能，我们用两层架构来应对不同级别的上下文膨胀：

**Layer 1 - micro_compact（类似 Young GC）**：每轮自动执行，替换旧的工具调用内容（ToolResponse 和 ToolCall args）为 JSON 占位符，开销极低，无 LLM 调用。核心参数是 `keepRecentTools`（保留最近几轮）和 `maxToolLength`（触发压缩的长度阈值）。**Layer 2 Layer 2 - auto_compact（类似 Full GC）**：micro_compact 后 token 仍超阈值时触发，用 LLM 生成结构化摘要替换所有旧消息。开销高（额外调一次非流式 LLM），但效果彻底，从几十条消息压缩到 1 条摘要。核心参数是 `tokenThreshold`（需根据模型上下文长度合理设置）。

两层协作的好处是：大部分情况下 micro_compact 就够用了，auto_compact 只在极端情况下才触发。就像 JVM 中大部分 GC 都是 Young GC，Full GC 较少发生。

在实现过程中，我们解决了几个关键问题：

- **占位符格式必须统一为 JSON**，自然语言格式会导致模型解析困惑
- **压缩策略选择全部摘要而非精确选择**，避免了边界对齐的复杂度和半压缩半保留的质量缺陷
- **摘要时传入当前用户问题**，引导 LLM 有侧重地保留关键信息
- **对话文本、工具参数原样传入不做截断**，避免摘要 LLM 误判任务完成情况
- **摘要 Prompt 聚焦任务延续性**，确保 Agent 读到摘要后能无缝接续未完成的任务

这整套机制其实借鉴了一部分 Claude Code 的实现方式，并加以改造优化，但是两者的核心思路是一致的，用 LLM 摘要做智能压缩，而非简单截断。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a0448753fb9180001773e35
