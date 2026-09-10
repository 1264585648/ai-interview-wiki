---
title: "✅Think模型与输出解析"
---

# ✅Think模型与输出解析

在前面的课程中，我们的 dodo-agent 一直使用的是 qwen-plus 这种常规模型。常规模型直接输出回答内容，不包含任何思考过程，`processChunk` 中拿到的 `text` 就是最终的回复，处理起来比较简单。

但在上节课的效果演示中，我们提到为了使 SkillsReactAgent 的输出更加丰富，切换到了 MiniMax-M2.7 推理模型。相比 qwen-plus，MiniMax 能够输出思考过程（thinking），用户可以看到模型的推理链路，整体体验和精度会更好一些。

然而，切换到 Think 模型后，问题来了：**MiniMax 的思考内容和正式回答混在同一个 **`content`** 字段中，用 **`<think...>...</think/>`** 标签分隔**。如果不做处理，前端会把思考过程和正式回答混在一起展示，用户看到的就是一堆内容混杂的文本。

这个问题不仅仅存在于 MiniMax，市面上不同厂商的 Think 模型在输出格式、行为模式上都存在差异。如果将来要切换模型，解析逻辑也需要相应调整。因此，本节课我们就来系统梳理一下 Think 模型的核心概念、不同厂商模型的差异对比，以及 dodo-agent 中是如何处理的。

不同厂商 Think 模型的差异

不同厂商的 Think 模型在以下维度存在差异：

- **思考模式**：默认开启 or 可关闭 or 不可关闭
- **思考内容输出位置**：独立字段 or 嵌入 content 中
- **参数开关**：如何控制是否启用思考

对比情况

| 维度 | qwen-plus（常规模型） | qwen3.6-plus | MiniMax M2.x | DeepSeek V4 |
| --- | --- | --- | --- | --- |
| 模型类型 | 非推理模型 | 混合思考模型 | 思考模型 | 思考模型 |
| 默认思考 | 关闭 | 开启 | 开启 | 开启 |
| 能否关闭 | — | 能（<br>`enable_thinking=false`<br>） | **不能** | 能 |
| 思考内容位置 | — | `reasoning_content`<br>独立字段 | **嵌入 **<br>`content`<br>** 中**<br>（<br>`<think...>...</think/>`<br>标签） | `reasoning_content`<br>独立字段 |
| 开关方式 | `enable_thinking=true`<br>开启 | `enable_thinking`<br>/<br>`thinking_budget` | 无开关 | `"thinking"``: {`<br>`"type"``: ``"disabled"`<br>`    }` |
| 流式输出思考 | 支持（需开启） | 支持，独立字段 | 支持，混在<br>`content`<br>中 | 支持，独立字段 |

下面逐个解释这些差异。

qwen-plus

首先要明确一点：**qwen-plus 是通义千问的常规模型，不属于 Think 模型**。我们在之前课程中一直使用的就是它。

qwen-plus 默认不输出思考过程，但可以通过 `enable_thinking=true` 参数可选开启思考能力。开启后，思考内容会出现在独立的 `reasoning_content` 字段中：

```text
{
  "choices": [{
    "message": {
      "content": "最终回答内容",
      "reasoning_content": "思考过程..."
    }
  }]
}
```

流式输出时，`reasoning_content` 和 `content` 会分开发送，客户端可以通过字段名区分。

qwen3.6-plus（混合思考模型）

qwen3.6-plus 是通义千问的**混合思考模型**，思考模式**默认开启**。

核心参数：

- `enable_thinking`：`true`（默认）/ `false` 关闭思考
- `thinking_budget`：控制思考 token 预算
- `preserve_thinking`：是否在响应中保留思考内容

特殊机制：**Prompt 标签控制**：Qwen3 开源模型支持在 message 中使用 `/no_think` 标签来临时关闭思考：

```text
用户输入：请帮我写一个快排算法 /no_think
```

这种方式的优点是**无需修改 API 调用参数**，在提示词中即可控制，灵活性很高。这种方式，在我们企业内部用的也非常多，因为在早期版本中，框架层面不支持传递`enable_thinking`这种参数，但是我们可以通过prompt注入`/no_think`标签来解决问题，流式输出时，思考内容在 `reasoning_content` 字段中独立输出：

```text
{"choices":[{"delta":{"reasoning_content":"思考内容..."}}]}
{"choices":[{"delta":{"content":"最终回答..."}}]}
```

MiniMax M2.7（思考模型，不可关闭）

MiniMax 的 M2 系列模型（M2、M2.1、M2.5、M2.7）全部为**仅思考模式**，**不可关闭**。MiniMax 官方曾在 Issue #25 中被请求增加关闭思考的选项，但官方明确拒绝了，表示暂不支持。

**这是与 qwen3.6-plus 和 DeepSeek V4 最大的差异所在**：MiniMax 将思考内容**直接嵌入 **`content`** 字段中**，使用 XML 标签 `<think...>...</think/>` 包裹：

```text
<think type="thinking">
这里是模型的思考过程...
</think/>
这里是最终的回答内容
```

这意味着：

- 客户端拿到的 `content` 字段中**混合了思考内容和正式回答**
- 需要自行解析 `<think...>` 和 `</think/>` 标签来区分
- 流式输出时，标签可能跨 chunk 分割，需要代码来正确解析

DeepSeek V4（思考模型）

DeepSeek V4 同样为思考模式，可关闭。但思考内容在**独立的 **`reasoning_content`** 字段**中输出，与 `content` 分离：

```text
{
  "choices": [{
    "message": {
      "content": "最终回答",
      "reasoning_content": "思考过程..."
    }
  }]
}
```

也就是说，DeepSeek V4 的 `content` 字段本身就是干净的正式回答，客户端无需额外解析。

参数开关方式

不同模型和 SDK 控制思考的参数方式各不相同：

| 方式 | 适用场景 | 示例 |
| --- | --- | --- |
| `enable_thinking`<br>顶级参数 | 阿里云百炼 API 直接调用 | `"enable_thinking": true` |
| `extra_body`<br>参数 | OpenAI  SDK | `extra_body={"enable_thinking": true}` |
| Prompt 标签<br>`/no_think` | Qwen3 开源模型 | 在 message 中添加<br>`/no_think` |

dodo-agent 如何处理 MiniMax 的 Think 标签

了解了不同模型的差异后，我们来看看 dodo-agent 是如何处理的。

我们的项目使用的是 MiniMax 模型，因此需要处理 `<think...>...</think/>` 标签。为此我们实现了 `ThinkTagParser` 工具类，提供两个核心能力。

ThinkTagParser 概览

```java
public final class ThinkTagParser {

    // 能力一：流式解析 — 在 processChunk 中逐 chunk 拆分思考/正文
    public static ParseResult parse(String chunk, boolean inThink) { ... }

    // 能力二：非流式去标签 — 一次性去除所有 think 标签
    public static String stripThinkTags(String input) { ... }

    public record Segment(boolean thinking, String content) {}
    public record ParseResult(List<Segment> segments, boolean inThink) {}
}
```

两个方法分别对应两种场景：

- `parse`：用于**流式输出**时逐 chunk 拆分思考内容和正文
- `stripThinkTags`：用于**非流式调用**后去除所有 think 标签（如 JSON 解析前、保存结果前）

流式解析：parse 方法

在 SkillsReactAgent 的 `processChunk` 中，我们需要把 MiniMax 输出的每个 chunk 实时拆分为"思考内容"和"正式回答"，分别推送给前端。

为什么需要状态机？因为 MiniMax 的流式输出中，思考内容会跨越多个 chunk：

```text
Chunk 1: <think type="thinking">        ← 完整的开始标签
Chunk 2: 我需要分析用户的需求...         ← 思考内容，没有任何标签
Chunk 3: 首先考虑使用哪个技能...         ← 思考内容，没有任何标签
Chunk 4: </think/>                       ← 完整的结束标签
Chunk 5: 我来帮你做PPT...               ← 正式回答，没有任何标签
```

Chunk 2 和 Chunk 3 本身不包含任何标签，仅看当前 chunk 无法判断它们是思考内容还是正式回答。必须依赖上一个 chunk 结束时的状态：如果上一个 chunk 打开了 `<think>` 标签，那当前 chunk 就是思考内容；如果已经关闭了，那就是正式回答。所以 `parse` 方法需要接收一个跨 chunk 的 `inThink` 状态：

```java
// ThinkTagParser.java
public static ParseResult parse(String chunk, boolean inThink) {
    List<Segment> segments = new ArrayList<>();
    boolean currentInThink = inThink;
    int index = 0;

    while (index < chunk.length()) {
        int thinkStartIdx = chunk.indexOf("<think", index);
        int thinkEndIdx = chunk.indexOf("</think", index);

        // 找到下一个标签位置（开始或结束）
        // 将标签前的文本归入当前状态（thinking 或 normal）
        // 遇到开始标签 → 切换为 thinking 状态
        // 遇到结束标签 → 切换为 normal 状态

        // 返回 ParseResult(segments, currentInThink)
    }
}
```

核心思路：

- 接收当前 chunk 和上一次的 `inThink` 状态
- 查找 `<think` 开始标签和 `</think` 结束标签
- 将文本拆分为 `Segment` 列表，每个 Segment 标记为 thinking 或 normal
- 返回新的 `inThink` 状态，供下一个 chunk 使用

在 SkillsReactAgent 的 `processChunk` 中，调用方式如下：

```java
// SkillsReactAgent.java - processChunk
private void processChunk(ChatResponse chunk, Sinks.Many<String> sink, RoundState state) {
    // ... 省略 tool_call 处理 ...

    String text = gen.getOutput().getText();
    if (text != null && !text.isEmpty()) {
        // 使用 ThinkTagParser 拆分思考内容和正常文本
        ThinkTagParser.ParseResult parseResult = ThinkTagParser.parse(text, state.inThink);
        state.inThink = parseResult.inThink();

        for (ThinkTagParser.Segment segment : parseResult.segments()) {
            if (segment.thinking()) {
                // 思考内容 → 发送 Thinking 事件
                sink.tryEmitNext(new AgentStreamEvent.Thinking(segment.content()).toJSON());
            } else {
                // 正式回答 → 发送 Text 事件
                sink.tryEmitNext(new AgentStreamEvent.Text(segment.content()).toJSON());
                state.textBuffer.append(segment.content());
            }
        }
    }
}
```

通过 `state.inThink` 跨 chunk 维护状态，每个 Segment 根据 `thinking` 标记分发为不同的事件类型。前端收到 `thinking` 类型就渲染到折叠区域，收到 `text` 类型就渲染到正文区域。对比一下，之前使用 qwen-plus（常规模型）时的 `processChunk` 是这样的：

```java
// 之前使用 qwen-plus 的 processChunk（简化版）
if (text != null) {
    sink.tryEmitNext(createTextResponse(text));
    state.textBuffer.append(text);
}
```

因为 qwen-plus 不会输出 think 标签，所以直接把所有文本当作正式回答即可。切换到 MiniMax 后，需要额外引入 ThinkTagParser 来拆分，但核心的 React 循环、工具调用、轮次调度等逻辑完全不变。

事件模型：AgentStreamEvent

**下节课详细讲解，本节课先了解**：拆分后的内容通过 `AgentStreamEvent` 统一格式化后推送到前端：

```java
public sealed interface AgentStreamEvent permits
        AgentStreamEvent.Thinking,   // 思考过程
        AgentStreamEvent.Text,       // 正常文本
        AgentStreamEvent.ToolStart,  // 工具开始执行
        AgentStreamEvent.ToolEnd,    // 工具执行完成
        AgentStreamEvent.Error,      // 错误
        AgentStreamEvent.Complete {  // 执行完成
}
```

每种事件类型都实现了 `toJSON()` 方法，输出统一格式的 JSON：

```text
// Thinking 事件
{"type":"thinking","content":"模型的思考内容..."}

// Text 事件
{"type":"text","content":"正式回答内容..."}

// ToolStart 事件
{"type":"tool_start","toolName":"bash","toolCallId":"xxx","arguments":"..."}

// ToolEnd 事件
{"type":"tool_end","toolName":"bash","toolCallId":"xxx","result":"..."}

// Complete 事件
{"type":"complete"}
```

前端只需要根据 `type` 字段分发到不同的渲染逻辑即可。

非流式去标签：stripThinkTags 方法

`stripThinkTags` 用于非流式场景：一次性拿到完整的 LLM 输出后，需要去除所有 think 标签。

这个方法主要用在 PPT 生成的各个策略中，每个策略阶段都可能调用 LLM，而 MiniMax 的输出中会包含 think 标签。

**JSON 解析场景（最关键）**

`SchemaStrategy` 和 `TemplateStrategy` 需要将 LLM 输出解析为 JSON 对象。如果不去除 think 标签，JSON 解析会直接失败：

```java
// SchemaStrategy.java - 生成 PPT Schema
String json = ThinkTagParser.stripThinkTags(
    chatModel.call(new Prompt(prompt)).getResult().getOutput().getText());
PptSchema pptSchema = converter.convert(json);  // 如果不去标签，这里会报错
```

```java
// TemplateStrategy.java - 选择模板
String json = ThinkTagParser.stripThinkTags(
    chatModel.call(new Prompt(prompt)).getResult().getOutput().getText());
TemplateSelectionResult result = converter.convert(json);
```

`stripThinkTags` 的实现逻辑：

```java
public static String stripThinkTags(String input) {
    if (input == null || input.isEmpty()) {
        return input;
    }
    String endTag = "</think/>";
    int lastIndex = input.lastIndexOf(endTag);
    String result;
    if (lastIndex != -1) {
        // 找到最后一个 </think/>，取其后面的内容
        result = input.substring(lastIndex + endTag.length()).trim();
    } else {
        result = input;
    }
    // 再用正则清除可能残留的 <think...>...</think/> 对
    result = result.replaceAll("(?s)<think.*?</think/>", "").trim();
    return result;
}
```

算法分两步：

1. 先找到最后一个 `</think/>` 标签，取其后面的所有内容（因为最终回答在最后一个思考块之后）
2. 再用正则 `(?s)<think.*?</think/>` 清除可能残留的标签对

**文本保存场景**

`SuccessStrategy`、`FailedStrategy` 等策略在保存 LLM 输出到会话或数据库时，也需要去除 think 标签，避免将思考过程保存为正式回答：

```java
// SuccessStrategy.java
saveResultToSession(context, inst,
    ThinkTagParser.stripThinkTags(llmResponse.toString()), thinkingBuffer);
```

为什么需要特殊处理

通过上面的对比可以看出，不同模型的思考内容输出方式完全不同：

| 模型 | 思考内容位置 | 解析方式 |
| --- | --- | --- |
| MiniMax | 嵌入 content 中，XML 标签分隔 | 需要 ThinkTagParser |
| qwen3.6-plus / DeepSeek | `reasoning_content`<br>独立字段 | SDK 自动分离，无需额外处理 |
| qwen-plus | 默认无思考 | 无需处理 |

因此，如果我们的项目切换到其他模型（如 qwen3.6-plus），`ThinkTagParser` 的大部分逻辑就不再需要了。但是他们的think在当前代码中是无法输出的，因为 SDK 会直接将思考内容放在 `reasoning_content` 字段中，我们没有获取到。

Spring AI 对 reasoning_content 的内置支持

上面提到，DeepSeek V4、qwen3.6-plus 等模型会将思考内容放在独立的 `reasoning_content` 字段中。实际上，**Spring AI 已经内置了对 **`reasoning_content`** 的支持**，无需我们手动解析。Spring AI 底层基于 OpenAI 兼容协议，当 API 响应中包含 `reasoning_content` 字段时，Spring AI 会自动将其映射到 `AssistantMessage` 的 metadata 中，key 为 `reasoningContent`：

```java
// 流式输出时，获取思考内容
String reasoning = (String) message.getMetadata().get("reasoningContent");
String content = message.getText(); // 正式回答，已经是干净的
```

这意味着：

- 对于使用 `reasoning_content` 字段的模型（如 DeepSeek V4），Spring AI 会**自动分离**思考内容和正式回答
- 客户端可以直接从 metadata 中获取思考过程，`content` 字段本身就是干净的正式回答
- 无需像我们处理 MiniMax 那样手动解析标签

**那为什么 dodo-agent 不用这种方式？** 因为 dodo-agent 当前使用的是 MiniMax M2.7，它的思考内容是嵌入在 `content` 字段中的，不走 `reasoning_content`，他的实现相对比较复杂，所以以这个模型来演示给大家看比较合适。那么 Spring AI 的内置支持帮不上忙，我们必须用 `ThinkTagParser` 手动解析。如果将来切换到 DeepSeek V4 或 qwen3.6-plus，就可以直接利用 Spring AI 的内置能力，省去 `ThinkTagParser` 的大部分工作。

前端如何处理 Think 内容

dodo-agent 的前端采用了分阶段流式输出的方式，后端通过 SSE 将数据推送到前端，数据中包含 `type` 字段标识内容类型：

- `thinking` 类型：展示为可折叠的思考过程区域
- `text` 类型：展示为正式回答内容
- `tool_start` / `tool_end` 类型：展示工具调用状态

前端在流式接收过程中，会根据 `type` 字段将内容分别追加到 thinking 区域或正式回答区域，并维护时间线（timeline）用于展示完整的执行过程。

前端部分主要借助 AI 辅助编写。具体的前后端流式交互机制、分阶段输出的完整实现细节，将在后续课程中详细讲解。

总结

本节课的核心要点：

1. **切换 Think 模型的动机**：之前用 qwen-plus 不带思考，为使 SkillsReactAgent 输出更丰富，切换到 MiniMax-M2.7
2. **不同模型差异比较大**：MiniMax 将思考内容嵌入 content 中，而 qwen3.6-plus 和 DeepSeek 使用独立字段，这是最核心的差异
3. **ThinkTagParser 两个能力**：`parse` 用于流式逐 chunk 拆分，`stripThinkTags` 用于非流式一次性去除标签
4. **processChunk 的改造**：引入 ThinkTagParser 后，从直接输出文本变为拆分 thinking/text 两种事件
5. **因地制宜**：切换模型时解析层需要调整，因此封装为独立工具类非常重要。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69faec2ca7c8ff0001af2362
