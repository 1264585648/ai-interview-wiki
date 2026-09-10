---
title: "✅实现 DeepResearch（上）"
---

# ✅实现 DeepResearch（上）

最近，大家可能已经注意到，各个大模型平台都在陆续推出一种新的能力形态。比如：**在豆包中叫做“深度研究”，在 Google Gemini 中叫做 “DeepResearch”**。这些功能已经不再只是简单地回答问题，而是会先对任务进行拆解，自主查资料、反复搜索和整理信息，最后给出一份看起来非常专业、结构完整的研究报告。

但实际上，这背后并不是什么全新的技术突破，也不是大模型突然变得更聪明了，而是**智能体的架构和工作方式发生了变化**。它从过去“一步一决策、边想边做”的模式，升级为“先想清楚要做什么，再一步一步把事情做完”。因此，在这一节课中，我们将重点分析 DeepResearch 背后的实现原理，并结合实际代码，讲清楚如何基于现有的 Agent 架构，自己动手实现一个 DeepResearch 能力。

![](assets/8d07c5195d70.png)

![](assets/159ef1c5044c.png)

什么是 DeepResearch？

在讲解之前，我们先搞清楚到底什么是 **DeepResearch** ？在复杂问题场景中，智能体需要解决的已不再是一次性问答，而是围绕一个目标持续推进的信息获取与分析过程。

**DeepResearch（深度研究）就是一种面向研究型任务的智能体工作模式，其核心目标是将一个开放性问题转化为一系列可执行、可验证、可迭代的研究步骤**，并最终输出**结构化、可复用的研究成果**。与普通问答或单轮搜索不同，DeepResearch 强调对问题整体结构的把握，以及对信息来源的持续验证和修正。

从任务特征上看，DeepResearch 通常具有以下共性：

- **研究目标复杂且无法一次完成**问题边界并不清晰，需要通过多轮信息收集与分析逐步收敛结论。
- **研究过程存在阶段性成果**中间步骤会形成可独立使用的阶段性结论，而不是一次性生成最终答案。
- **最终输出是系统化研究结果**输出形式通常是**分析报告、研究结论或决策依据**，而非零散文本。

DeepResearch 的关键价值，并不在于模型本身生成了多少内容，而在于它能够**从海量信息源中持续筛选、验证并提取与当前研究目标高度相关的有效信息**，从而显著降低人工查资料、做整理和交叉验证的成本。当然，这种模式下，反复的迭代、搜索、验证，大模型 token 的消耗是非常巨大的，也就是成本会非常高。

基本思想

DeepResearch 的关键，并不在于让模型多想几步，而在于将研究过程本身进行**显式的结构化和工程化**。它关注的其实就是：**研究应该如何一步步推进**。

从整体上看，一个完整的 DeepResearch 过程至少包含以下三个核心阶段：

- **研究规划（Plan）**在执行任何具体操作之前，智能体需要先对整体研究路径形成清晰认知，包括研究目标是什么、需要拆解成哪些阶段性任务、每一步依赖哪些前置结果，以及哪些步骤可以并行推进、哪些必须串行完成。只有在研究结构被明确之后，后续的搜索和分析才是有方向的，而不是盲目地调用工具。
- **执行与评估（Execute + Critique）**在执行阶段，系统严格按照规划结果调用搜索和分析工具，获取事实和证据。但执行并不是终点，执行完成后还必须引入评估与批判机制，对阶段性结果进行检查，例如信息是否充分、是否存在冲突、是否偏离研究目标。如果评估未通过，就需要基于反馈对研究路径进行调整，进入下一轮研究迭代。
- **迭代收敛与总结（Iterate + ****Summarize****）**DeepResearch 通常不是一轮完成的，而是通过多次迭代，反复循环逐步收敛。当系统判断研究目标已经被充分满足时，才会进入总结阶段，将多轮、多源的研究结果进行整合，输出一份结构清晰、逻辑完整、基于事实支撑的研究结论。

这样看是不是很熟悉？它的整体工作方式与我们之前介绍的 **Plan & Execute** 模式在思想上是完全一致的。不同之处在于，**在研究型任务中，对工具能力和数据源质量的要求会显著提高，它需要接入更丰富、更可靠的数据来源，并支持多轮检索、交叉验证和迭代补充**。

当然 DeepResearch 的实现方式有很多，除了 Plan & Execute ，还包括 ReAct、多智能体也都可以实现。

**如何实现？**

目前常见的 DeepResearch 实现路径大致可以分为以下两大类：

1. **基于搜索引擎或外部检索工具**

这类方案主要通过调用搜索引擎、Web 检索服务或各类外部 API，不断从互联网或开放数据源中获取研究所需的信息。它的优势在于信息覆盖面广、时效性强，非常适合面向开放问题或需要获取最新资料的研究型任务。

1. **基于 RAG 知识库**

我接触过的任务中，这类方案也可以划分为两个场景：

- 从企业内部文档、领域专属资料或结构化知识库中进行检索与补充，它更适合对数据准确性、安全性和领域一致性要求较高的研究场景。实现逻辑其实与搜索引擎的是一致的，只是数据源不同而已。
- **对大文件的深入解读，比如用户提供了一个内容很多的PDF，需要让 Agent 辅助他进行解读学习，这类文件直接塞入大模型是不现实的，对模型的上下文、精度考验压力都非常大，那么这种就需要将文本内容向量化到数据库中，通过不断的提问+检索，来不断学习收敛，逼近目标。**

**接下来我们主要来讲通过接入搜索引擎工具 + PlanExecuteAgent + 流式管理 来实现 DeepResearch。**

**搜索引擎 MCP**

在 DeepResearch 场景中，**搜索引擎是整个研究流程的核心基础能力**。因此，在实现层面上，我们直接使用之前智能问答助手的MCP工具即可。

需要特别说明的是，在 DeepResearch 场景下，搜索并不是低频操作，而是会在 **Plan & Execute 的多个阶段被反复、大量调用**。这里我们直接使用 **streamable 调用方式**。Tavily 官方已经支持了这个能力，非常适合在高并发、长链路的 DeepResearch 研究流程中使用。

需求澄清

在 DeepResearch 的完整流程中，**需求澄清 是研究正式开始之前的第一步**。这点和PPTBuilderAgent是一样的，因为他们都是在定制化做一个特殊的长链条需求，这一阶段并不会真正执行搜索或分析，而是先判断用户的问题是否具备开展研究的条件。

在真实场景中，用户提出的问题往往存在以下情况：

- 问题范围过大，例如：“研究一下 AI”
- 研究目标不明确，例如：“分析一下某个行业”
- 研究对象不清晰，例如：“帮我看看苹果的发展”

如果在这种情况下直接进入搜索与分析阶段，Agent 很容易出现研究方向偏差，甚至在多个无关方向上不断搜索，既浪费时间，也消耗大量 Token 成本。因此，在 DeepResearch 系统中，我们会先通过一个独立阶段，对问题进行**需求分析与澄清**。

从系统角度来看，这一步其实只做一件事情：

**判断用户问题是否需要补充信息。**

如果信息不足，则暂停研究并向用户提问；如果信息已经足够清晰，则进入下一阶段继续研究。

实现方式

在代码中，这一阶段由 `clarifyRequirementPhase` 方法完成：

```java
private void clarifyRequirementPhase(
        OverAllState state,
        Sinks.Many<String> sink,
        AtomicBoolean finished,
        StringBuilder thinkingBuffer,
        Runnable onComplete)
```

当流程进入该阶段时，系统会先向前端输出一条思考信息，让用户知道 Agent 正在分析问题：

```java
emit(sink, finished, "\n🔍 正在分析您的需求...\n", "thinking", thinkingBuffer);
List<Message> messages = new ArrayList<>();

messages.add(new SystemMessage(PlanExecutePrompts.REQUIREMENT_CLARIFICATION));
messages.addAll(state.getMessages());
```

这里的消息主要包含两部分内容：

| 消息类型 | 作用 |
| --- | --- |
| System Prompt | 需求澄清规则 |
| 历史消息 | 用户问题及上下文 |

然后通过流式方式调用模型：

```java
Disposable disposable = chatClient.prompt()
        .messages(messages)
        .stream()
        .content()
        .doOnNext(chunk -> {
            responseBuffer.append(chunk);
            emit(sink, finished, chunk, "thinking", thinkingBuffer);
        })
        .doOnComplete(() -> handleClarificationComplete(
                responseBuffer, sink, finished, thinkingBuffer, onComplete))
        .subscribeOn(Schedulers.boundedElastic())
        .subscribe();
```

这样做的好处是，用户可以实时看到 Agent 的分析过程，而系统也会在后台缓存完整结果，用于后续判断。

判断研究是否可以开始

当模型输出结束后，系统会进入结果处理逻辑：

```java
private void handleClarificationComplete(...)
```

首先获取模型的完整输出内容：

```java
String response = responseBuffer.toString();
```

然后通过一个简单规则判断研究是否可以开始：

```java
boolean needsMoreInfo = response.contains("【需要补充信息】");
```

如果需要补充信息，则暂停研究流程：

```java
if (needsMoreInfo) {

    String pauseMessage =
            "⏸【暂停深入研究】"
            + response.replace("【需要补充信息】", "").trim();

    sink.tryEmitNext(createTextResponse(pauseMessage));

    complete(sink, finished);
}
```

此时系统会返回类似这样的内容：

```text
⏸【暂停深入研究】

为了更好开展研究，请补充以下信息：
1. 研究对象是哪个行业或公司？
2. 关注技术发展还是商业应用？
3. 是否需要行业对比分析？
```

整个 DeepResearch 流程会暂停，等待用户补充问题。如果问题信息已经足够，则继续执行后续流程：

```java
else {

    emit(sink, finished,
            "✅ 信息充足，准备生成研究主题\n",
            "thinking",
            thinkingBuffer);

    onComplete.run();
}
```

此时流程将进入下一阶段：研究主题生成

研究主题生成

当系统确认**用户信息已经足够开展研究**后，就会进入下一阶段：**研究主题生成（Research Topic Generation）**。

这一阶段的目标就是：**把用户问题整理成一个清晰、可执行的研究主题。**

构建发送给大模型的消息上下文，包括：

- 研究主题生成提示词 `RESEARCH_TOPIC_GENERATION`
- 用户历史对话（如果有）
- 用户原始问题

```java
messages.add(new SystemMessage(PlanExecutePrompts.RESEARCH_TOPIC_GENERATION));

if (CollectionUtils.isNotEmpty(state.getMessages())) {
    messages.addAll(state.getMessages());
}

messages.add(new UserMessage(
        "<original_question>" + state.getQuestion() + "</original_question>"
));
```

然后通过 **流式调用 LLM** 生成研究主题，并实时返回给前端：

```java
.doOnNext(chunk -> {
    topicBuffer.append(chunk);
    emit(sink, finished, chunk, "thinking", thinkingBuffer);
})
```

生成完成后，会进入 `handleResearchTopicComplete` 方法处理结果：

```java
String topic = topicBuffer.toString();
state.setRefinedResearchTopic(topic);

emit(sink, finished, "\n✅ 研究主题已生成\n\n", "thinking", thinkingBuffer);
onComplete.run();
```

这里主要做两件事：

**保存研究主题**

```java
state.setRefinedResearchTopic(topic);
```

后续研究流程都会围绕这个主题展开。

**进入下一阶段**

```java
onComplete.run();
```

流程继续推进到 **研究任务规划阶段**。这一阶段的作用本质上是：**把“用户问题”转化为“标准研究主题”，为后续任务拆解和深度研究提供基础。**

**DeepReseach 整体流程：**

```text
需求澄清
   ↓
研究主题生成
   ↓
执行循环（核心）
   ↓
最终报告生成
```

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69aed6d1a7c8ff00016cc8b8
