---
title: "✅PPT 生成智能体"
---

# ✅PPT 生成智能体

在前面的课程中，我们已经系统分析了当前市面上 **主流的 PPT 生成智能体实现方式**，并且重点拆解了 **豆包 PPT 的生成流程**，了解了一个成熟产品在需求澄清、内容规划、素材准备以及最终生成阶段的大致工作方式。

而从这一节课开始，我们将不再只是停留在需求分析层面，而是**进入真正的工程实现阶段**。

本节课的核心目标是：

**实现一个完整的 PPT 生成智能体，并深入理解在工程系统中，如何构建一个稳定、可编辑、可扩展、并且支持断点恢复的 PPT 生成 Agent。**

在这一节课中，我们将重点关注以下几个问题：

- 一个 **PPT 生成 Agent 的整体架构应该如何设计**
- 为什么要采用 **状态机 + 策略模式** 的设计
- 如何实现 **创建 PPT、修改 PPT、断点恢复** 三种意图能力

PPTBuilderAgent 整体架构

在整个系统中，`PPTBuilderAgent` 是 **PPT 生成智能体的主入口**。所有来自用户的 PPT 生成请求，最终都会进入这个 Agent，由它统一调度后续的执行流程。

系统架构如下：

```java
PPTBuilderAgent
        │
        │
        ├── IntentRecognizer
        │        │
        │        └── 判断用户意图
        │             CREATE / MODIFY / RESUME
        │
        ├── PptStateStrategyFactory
        │        │
        │        └── 根据状态选择策略
        │
        ├── AgentTaskManager
        │        │
        │        └── 管理任务生命周期
        │
        └── 各状态策略
                 │
                 ├── RequirementStrategy（需求澄清）
                 ├── SearchStrategy（信息收集）
                 ├── TemplateStrategy（模板选择）
                 ├── OutlineStrategy（大纲生成）
                 ├── SchemaStrategy（Schema生成）
                 ├── RenderStrategy（PPT渲染）
                 ├── SuccessStrategy（总结）
                 └── FailedStrategy（失败）
```

从职责上来看，`PPTBuilderAgent` 并不会直接去完成 PPT 的生成工作，而是更像一个 **流程调度中心**。它的主要任务是：解析用户意图、管理任务生命周期，并根据当前状态选择合适的策略来推进整个 PPT 的生成流程。

首先是**解析用户意图**。在真实的对话场景中，用户可能提出不同类型的需求，例如首次生成 PPT、对已有 PPT 进行修改，或者在任务中断后继续执行。因此 Agent 在接收到请求后，会先通过 **IntentRecognizer** 判断用户当前的真实意图，再决定系统应该进入哪一条执行路径，这一步本质上就是整个系统的**入口路由逻辑**。

其次是**驱动 PPT 生成流程的状态流转**。PPT 的生成并不是一次完成的，而是被拆分为多个阶段，例如需求分析、模板选择、大纲生成、内容设计以及最终渲染。PPTBuilderAgent 会根据当前任务所处的状态，通过 **PptStateStrategyFactory **选择对应的策略执行，并在完成后推进到下一个阶段，从而形成一个完整的**状态机执行流程**。

第三个职责是**管理任务生命周期**。由于 PPT 生成通常会涉及多次模型调用、素材搜索以及文件渲染等操作，整个任务可能持续较长时间。为了避免同一会话出现多个任务同时运行的问题，系统引入 **AgentTaskManager** 来统一管理任务，例如任务注册、任务取消以及任务完成后的清理，从而保证系统在复杂场景下依然稳定运行。

基于以上设计，整个系统的核心思想可以概括为一句话：

**Agent = 状态机 + 策略模式**

也就是说，PPT 的生成流程被抽象为一个**状态机**，每个阶段对应一个明确的状态；而每个状态具体的执行逻辑，则由对应的**策略类**完成。通过这种方式，可以将复杂流程拆分成多个独立模块，使系统结构更加清晰，同时也更容易扩展和维护。

执行流程

在整个 PPT 生成系统中，我们并没有把所有逻辑写在一个流程里一次性执行，而是将整个生成过程**拆分为多个明确的阶段**，每一个阶段对应一个状态。系统通过状态机的流转来逐步推进任务执行。

状态机定义如下：

```java
public enum PptInstStatus {

    INIT("INIT", "初始化"),
    REQUIREMENT("REQUIREMENT", "需求澄清"),
    SEARCH("SEARCH", "信息收集"),
    OUTLINE("OUTLINE", "大纲生成"),
    TEMPLATE("TEMPLATE", "模板选择"),
    SCHEMA("SCHEMA", "Schema生成"),
    RENDER("RENDER", "PPT渲染"),
    SUCCESS("SUCCESS", "完成"),
    FAILED("FAILED", "失败");

}
```

整个任务的执行流程如下：

```java
INIT
 ↓
REQUIREMENT
 ↓
SEARCH
 ↓
TEMPLATE
 ↓
OUTLINE
 ↓
SCHEMA
 ↓
RENDER
 ↓
SUCCESS
```

如果在执行过程中出现异常，则任务会进入失败状态：

```text
任意状态
   ↓
FAILED
```

之所以采用这种**阶段化的执行流程**，主要是因为 PPT 的生成本质上是一个**多步骤、多模型调用的复杂任务**。例如需求分析、大纲生成、模板选择以及最终渲染，本身就属于不同类型的处理逻辑，如果全部耦合在一起，不仅代码复杂度会迅速增加，也很难进行维护和扩展。

通过将流程拆分为多个状态，每一个阶段只负责完成自己的一部分任务，系统结构会更加清晰。同时这种设计在工程上还有几个非常重要的优势。

首先是**支持断点恢复**。由于任务的状态会被持久化保存，如果系统中途出现异常或者服务重启，只需要读取当前状态，就可以从上一次执行的位置继续运行，而不需要重新生成整个 PPT。

其次是**便于监控和排查问题**。当任务执行失败时，可以很容易地定位到底是在哪一个阶段出现了问题，例如是在信息收集阶段失败，还是在渲染阶段失败，这对于线上系统的稳定性非常重要。

最后是**方便扩展能力**。如果未来需要增加新的处理步骤，例如自动生成图表、自动生成讲稿，或者增加素材处理阶段，只需要在状态机中新增一个状态，并接入对应的执行策略即可，而不需要重写整个流程。

因此，通过这种**状态驱动的执行流程设计**，我们不仅让 PPT 生成逻辑更加清晰，也为系统的稳定性、可维护性以及未来扩展能力打下了基础。

Agent 主入口

`PPTBuilderAgent` 的核心入口方法：

```java
public Flux<String> execute(String conversationId, String query)
```

执行流程：

1. 检查是否已有任务在执行
2. 注册任务到 `AgentTaskManager`
3. 识别用户意图
4. 根据意图进入不同流程

核心代码逻辑：

```java
public Flux<String> execute(String conversationId, String query) {

    Flux<String> checkResult = checkRunningTask(conversationId);
    if (checkResult != null) {
        return checkResult;
    }

    AgentTaskManager.TaskInfo taskInfo = registerTask(conversationId, sink);
    if (taskInfo == null) {
        return Flux.error(new IllegalStateException("该会话正在执行中，请稍后再试"));
    }

    PptIntentResult intentResult =
            pptIntentRecognizer.recognize(conversationId, query);

    switch (intentResult.getIntent()) {

        case CREATE_PPT:
            handleCreateIntent(conversationId, query, sink, thinkingBuffer);
            break;

        case MODIFY_PPT:
            handleModifyIntent(conversationId, query, sink, thinkingBuffer);
            break;

        case RESUME_PPT:
            handleResumeIntent(conversationId, query, sink, thinkingBuffer);
            break;
    }

    return sink.asFlux()
            .doFinally(signalType -> removeTask(conversationId));
}
```

意图识别设计

目前根据PPT的操作行为，预判用户的意图，支持三种运行模式：

| 模式 | 说明 |
| --- | --- |
| CREATE_PPT | 新建 PPT |
| MODIFY_PPT | 修改 PPT |
| RESUME_PPT | 断点恢复 |

意图识别逻辑：

```java
public PptIntentResult recognize(String conversationId, String query) {

    AiPptInst latestInst = pptInstService.getLatestInst(conversationId);

    if (latestInst == null) {
        return new PptIntentResult(PptIntent.CREATE_PPT, "会话中无PPT实例");
    }

    if (needsResume(status, errorMsg, query)) {
        return new PptIntentResult(PptIntent.RESUME_PPT, "继续执行");
    }

    if (status == PptInstStatus.SUCCESS) {
        return recognizeWithLLM(query);
    }

    return new PptIntentResult(PptIntent.CREATE_PPT, "默认新建");
}
```

这样做的最大的好处就是：**虽然 PPT 是一个 workflow，但是依然可以像 真实助手一样持续对话。**

例如：

```text
用户：生成一个 AI 技术分享 PPT
Agent：生成完成

用户：把最后一些的标题换成“谢谢观看”
Agent：修改 PPT
```

创建 PPT 执行流程

创建流程：

```text
CREATE_PPT
  ↓
创建实例
  ↓
启动状态机
```

核心代码：

```java
private void handleCreateIntent(String conversationId, String query, ...) {

    AiPptInst inst =
            pptInstService.createInst(conversationId, query);

    PptStateStrategyFactory.getInstance()
            .executeNextState(inst, sink, query, thinkingBuffer, context);
}
```

第一步是 **创建 PPT 任务实例**。

系统会为当前会话创建一条 `AiPptInst` 记录，用于保存整个任务的执行状态，例如当前状态、用户需求、生成结果等信息。后续所有的执行流程，都会围绕这个实例展开。第二步是 **启动状态机执行流程**。

通过 `PptStateStrategyFactory` 调用 `executeNextState`，系统会根据当前状态选择对应的执行策略，并开始推进整个生成流程。

在创建完成之后，系统会自动进入第一个执行阶段。

策略模式

为了让每个阶段的逻辑保持独立，我为所有执行阶段定义了统一的策略接口：

```java
public interface PptStateStrategy {

    void execute(AiPptInst inst,
                 Sinks.Many<String> sink,
                 String query,
                 StringBuilder thinkingBuffer,
                 PptStateStrategyContext context);

    PptInstStatus getTargetStatus();
}
```

这个接口定义了每一个策略必须实现的两个核心能力。

**execute**

执行当前阶段的核心逻辑，例如生成大纲、搜索资料或渲染 PPT。所有状态的具体业务逻辑都在这里实现。

**getTargetStatus**

定义当前阶段执行完成后要进入的下一个状态，从而驱动状态机继续向前推进。

通过这个接口，我们将每一个阶段的逻辑都封装成了一个独立的策略类，例如：

- **RequirementStrategy**
- **SearchStrategy**
- **TemplateStrategy**
- **OutlineStrategy**
- **SchemaStrategy**
- **RenderStrategy**

这样每个策略只需要关注自己的业务逻辑，而不需要关心整个流程的流转。

策略工厂

为了根据状态选择正确的策略，实现了一个 **策略工厂**。

```java
public class PptStateStrategyFactory {

    private static final Map<PptInstStatus, PptStateStrategy> STRATEGY_MAP = new HashMap<>();

    static {
        STRATEGY_MAP.put(PptInstStatus.REQUIREMENT, new RequirementStrategy());
        STRATEGY_MAP.put(PptInstStatus.SEARCH, new SearchStrategy());
        STRATEGY_MAP.put(PptInstStatus.TEMPLATE, new TemplateStrategy());
        STRATEGY_MAP.put(PptInstStatus.OUTLINE, new OutlineStrategy());
        STRATEGY_MAP.put(PptInstStatus.SCHEMA, new SchemaStrategy());
        STRATEGY_MAP.put(PptInstStatus.RENDER, new RenderStrategy());
        STRATEGY_MAP.put(PptInstStatus.SUCCESS, new SuccessStrategy());
        STRATEGY_MAP.put(PptInstStatus.FAILED, new FailedStrategy());
    }

}
```

策略工厂的作用非常简单：

**根据当前状态，从 Map 中取出对应的策略并执行。**

例如：

- 当前状态是 `REQUIREMENT` → 执行 `RequirementStrategy`
- 当前状态是 `OUTLINE` → 执行 `OutlineStrategy`
- 当前状态是 `RENDER` → 执行 `RenderStrategy`

通过这种方式，整个系统就形成了一个非常清晰的执行结构：

```text
状态机
   ↓
策略工厂
   ↓
具体策略执行
```

这种设计有几个非常明显的优势。

**第一，状态和行为解耦。**

状态机只负责流程控制，而具体逻辑由策略实现。

**第二，扩展能力强。**

如果未来需要增加新的阶段，例如自动生成图表，只需要新增一个状态和策略即可。

**第三，代码结构清晰。**

每个策略文件都只负责一个阶段的逻辑，不会都融合在一起。

需求澄清（RequirementStrategy）

创建流程启动后，第一个执行阶段就是 **需求澄清**。

在真实场景中，用户给出的需求往往是比较模糊的，例如：

```text
帮我做一个 AI 行业趋势的 PPT
```

但一个完整的 PPT 其实还需要很多信息，例如：

- 目标受众
- 页数
- 样式风格

因此在 `RequirementStrategy` 中，系统会调用大模型对用户需求进行结构化整理，并生成一个完整的 PPT 需求描述。

这一阶段的核心目标是：

**将用户的自然语言需求，转化为结构化的 PPT 生成需求。**

```java
/**
 * 需求澄清提示词
 */
public static final String REQUIREMENT_PROMPT = """
        ## 角色
        你是专业的PPT需求澄清助手。名字叫做：豆豆，英文名叫dodo，你的责任是根据上下文及历史会话，帮助用户澄清他们的需求，确保所有必要信息都被收集。

        ## 任务
        分析用户需求，判断信息是否足够生成PPT：
        至少包含：
        1. 主题
        2. 页数
        3. 风格建议
        4. 受众群体

        ## 输出要求
        1. 自然语言流式输出，分析用户的需求
        2. 如果信息不足，提出需要询问的问题
        3. 如果信息完整，确认需求并直接输出：【开始生成PPT】以及需求分析
        4. 需求章节清晰有条理，不允许输出其他解释性的语句和追问语句
        5. 如果用户要求直接生成，则直接开始输出内容，不需要再询问用户澄清
        """;
```

这些信息会被保存到 `AiPptInst` 中，作为后续生成流程的重要输入。

当需求澄清完成后，状态机会自动推进到下一阶段，核心代码如下，就是状态机的推进：

```java
/**
 * 继续执行状态机
 */
private void continueStateMachine(AiPptInst inst, Sinks.Many<String> sink, String query,
                                   StringBuilder thinkingBuffer, PptStateStrategyContext context) {
    PptStateStrategyFactory.getInstance().executeNextState(inst, sink, query, thinkingBuffer, context);
}
```

而他的目标节点就是在类中定义的：

```java
 private static final PptInstStatus TARGET_STATUS = PptInstStatus.SEARCH;
```

也就是 **信息收集阶段**。

信息收集（SearchStrategy）

在需求澄清完成之后，系统就进入了下一阶段：**信息收集**。

这一阶段的目标非常明确：**为后续 PPT 内容生成准备足够的资料和背景信息。**

很多时候，用户虽然已经给出了明确的主题，例如：

```text
生成一个 AI 行业趋势的 PPT
```

但如果直接让大模型生成 PPT 内容，往往会出现两个问题：

- 内容过于 **泛化**
- 缺乏 **最新数据和真实案例**

因此，在真正生成大纲和内容之前，我们会先进行一次 **信息搜集**，让模型先“做功课”，获取与主题相关的资料。这些资料可以使用我们前面使用过的搜索引擎工具来实现。这样在后续生成 PPT 大纲和内容时，就可以基于真实资料进行总结，而不是完全依赖模型的参数知识。

那么我们的要求就是根据前置环节生成的requirement，来去搜集相关的内容，核心提示词如下：

```java
public static final String getSearchInfoPrompt(String requirement) {
    String searchPrompt = """
            ## 角色
            你是专业的信息收集助手。

            ## 任务
            根据以下PPT主题，使用tavily搜索工具收集相关信息，并整理成简洁但是全面的总结。

            ## PPT主题
            %s

            ## 输出要求
            1. 使用tavily搜索工具查找相关信息
            2. 收集与主题相关的背景信息、关键数据、典型案例等
            3. 整理搜索结果，提供有价值的背景信息，方便后续生成大纲时使用
            4. 输出简洁的总结，不要包含过多无关信息
            5. 以自然语言形式输出，不要JSON格式
            6. 仅输出收集的内容信息，不要输出无关的解释或引导的话语
            """.formatted(requirement);
    return searchPrompt;
}
```

这个地方值得一提的是，因为我们需要的是全流式输出，而SpringAI在进行流式输出+工具调用的时候，稳定性很差，有一些bug，导致工具无法调用，所以这边直接使用我们自己开发SimpleReactAgent来做联网搜索并流式输出，并且收集最终的结果，保存至`AiPptInst` ，作为后续环节的输入。

```java
// 获取 SimpleReactAgent 并注入 tavily 搜索工具
SimpleReactAgent agent = SimpleReactAgent.builder()
        .chatModel(context.getChatModel())
        .tools(context.getToolCallbacks())
        .build();

// 流式输出搜索过程
StringBuilder searchResultBuffer = new StringBuilder();

Disposable disposable = agent.stream(searchPrompt)
          .doOnNext(chunk -> {
              searchResultBuffer.append(chunk);
              sink.tryEmitNext(context.createThinkingResponse(chunk));
          })
          .doOnComplete(() -> {
              log.info("信息收集完成，结果长度: {}", searchResultBuffer.length());
              String searchResult = searchResultBuffer.toString();
              // 过滤掉工具调用标记等非内容部分
              searchResult = cleanSearchResult(searchResult);
              context.getPptInstService().updateSearchInfo(inst.getId(), searchResult, TARGET_STATUS);
              sink.tryEmitNext(context.createThinkingResponse("\n✅相关信息收集完成，开始选择模板\n"));
              context.continueStateMachine(inst, sink, query, thinkingBuffer);
          })
          .doOnError(err -> {
              log.error("信息收集异常", err);
              // 失败时不回退状态，只更新错误信息，转到 FAILED
              context.getPptInstService().updateError(inst.getId(),
                      "信息收集失败: " + err.getMessage(), PptInstStatus.SEARCH);
              // 转到 FAILED 策略
              PptStateStrategyFactory.getInstance().executeFailedState(inst, sink, query, thinkingBuffer, context);
          })
          .subscribeOn(Schedulers.boundedElastic())
          .subscribe();
```

同时，完成后，继续执行状态机。

模板选择（TemplateStrategy）

在完成 **信息收集** 之后，系统就进入了下一阶段：**模板选择**。

这一阶段的目标非常明确：**根据用户需求，从系统已有模板中选择一个最合适的 PPT 模板。**

在企业级 PPT 生成系统中，模板其实是非常关键的一部分。因为企业通常都会有自己的 **统一设计规范**，例如：

- Logo 固定位置
- 页面布局结构
- 字体与配色规范
- 首页、章节页、内容页样式

如果完全让模型自由生成页面结构，很容易出现 **设计风格不统一**、**排版混乱** 等问题。还有就是为什么要把模板选择放在这个流程位置上，主要是因为，后续的内容大纲生成必须是要按照模板的格式来准备的，否则可能就会导致，生成内容的不兼容，因此在我们的实现中采用了一种非常典型的 ToB 设计方式：

**先选择模板，再根据模板结构生成内容。**

这样既能够保证生成的 PPT **符合模板规范**，同时不同模板也能够提供一定的 **样式多样性**。

在 `TemplateStrategy` 中，系统首先会从数据库中获取所有可用模板：

```java
List<AiPptTemplate> templates = context.getPptTemplateService().getAllTemplates();
```

每一个模板都会包含一些基础信息，例如：

- `templateCode`：模板唯一标识
- `templateName`：模板名称
- `styleTags`：适用风格标签
- `slideCount`：模板页数
- `templateDesc`：模板说明

随后系统会将这些模板信息整理成一段文本，提供给大模型进行分析：

```java
StringBuilder templatesInfo = new StringBuilder();
for (AiPptTemplate template : templates) {
    templatesInfo.append(String.format("""
                    --------------------------------
                    template_code: %s
                    模板名称: %s
                    适用风格: %s
                    模板页数: %d
                    模板说明: %s
                    """,
            template.getTemplateCode(),
            template.getTemplateName(),
            template.getStyleTags(),
            template.getSlideCount(),
            template.getTemplateDesc()
    ));
}
```

接着系统会构造模板选择提示词，将 **用户需求** 与 **模板信息** 一起提供给模型：

```java
String prompt = PptBuilderPrompts.getTemplateSelectionPrompt(
        requirement,
        templatesInfo.toString()
);
```

模型的任务就是根据用户需求，从这些模板中选择一个最合适的模板，并返回对应的 `templateCode`。为了保证模型输出的稳定性，这里使用了 **结构化解析工具**`BeanOutputConverter` 来解析模型返回结果：

```java
BeanOutputConverter<TemplateSelectionResult> converter =
        new BeanOutputConverter<>(new ParameterizedTypeReference<>() {});
```

随后调用模型进行模板选择：

```java
String json = context.getChatModel()
        .call(new Prompt(prompt))
        .getResult()
        .getOutput()
        .getText();

TemplateSelectionResult result = converter.convert(json);
```

模型最终会返回类似这样的结构化结果：

```text
templateCode: tech_blue
reason: 该模板适合科技行业报告
```

得到模板结果之后，系统会将选择结果保存到当前 PPT 实例中：

```java
context.getPptInstService()
        .updateTemplateCode(inst.getId(), result.getTemplateCode(), TARGET_STATUS);
```

继续执行状态机。

大纲生成（OutlineStrategy）

在完成 **模板选择** 之后，系统就进入了下一阶段：**大纲生成**。

这一阶段的目标就是：

**根据用户需求、搜索资料以及模板，生成整个 PPT 的章节大纲。**

在实际制作 PPT 的过程中，大纲是非常关键的一步。因为 PPT 的整体结构、章节顺序以及内容逻辑，基本都是在这一阶段确定的。后续每一页 PPT 的具体内容，实际上都是在这个大纲基础上的进一步展开。

因此在 `OutlineStrategy` 中，系统会综合利用前面几个阶段生成的信息：

- **需求澄清阶段生成的 requirement**
- **信息收集阶段得到的 searchInfo**
- **模板选择阶段确定的 template**

这些信息会共同作为大纲生成的输入。

```java
/**
 * 大纲生成提示词模板
 * 根据需求、模板结构、模板名称和搜索信息生成大纲
 */
public static final String getOutlinePrompt(String requirement, String templateSchema, String templateName, String searchInfo) {
    return """
            ## 角色
            你是专业的PPT内容大纲生成专家。你根据PPT的生成需求、选定模板的结构以及收集的相关信息，生成详细的PPT内容大纲。

            ## 任务
            请根据需求、模板结构和搜索信息生成PPT内容大纲。模板结构定义了可用的页面类型和字段，你需要根据这些来规划大纲。充分利用搜索到的信息来丰富大纲内容。

            ## PPT需求
            %s

            ## 搜索相关信息（可用于补充）
            %s

            ## 选定模板
            模板名称：%s

            ## 模板结构
            %s

            ## 输出要求
            输出详细的PPT大纲结构，包括每页的主题和要点。
            使用清晰的结构化格式，每页内容以"--- Page X ---"开头，其中X是页码。
            每页应包含：
            1. 页面类型（COVER/CATALOG/CONTENT/COMPARE/END等，根据模板结构）
            2. 页面标题
            3. 主要内容要点（充分参考搜索信息，使内容更加丰富准确）

            页面类型说明：
            - COVER: 封面页，包含主标题、副标题、作者信息
            - CATALOG: 目录页，列出主要章节
            - CONTENT: 内容页，展示主要内容（可以重复使用，根据用户的页数需求来选择复制多份）
            - COMPARE: 对比页，用于对比两个事物（可以重复使用，根据用户的页数需求来选择复制多份）
            - END: 结束页，感谢或总结

            示例格式：
            --- Page 1 ---
            类型：COVER
            标题：演示文稿名称
            副标题：副标题或说明
            作者：作者姓名

            --- Page 2 ---
            类型：CATALOG
            标题：目录
            - 目录项1
            - 目录项2
            - 目录项3

            --- Page 3 ---
            类型：CONTENT
            标题：内容标题
            - 主要观点1
            - 主要观点2
            - 主要观点3

            ## 要求：
            不要有任何其他解释性的内容，只输出内容大纲。
            """.formatted(requirement, searchInfo, templateName, templateSchema);
}
```

可以看到提示词中有一个比较重要的提示：

**CONTENT: 内容页，展示主要内容（可以重复使用，根据用户的页数需求来选择复制多份）**

这是什么意思？其实目的就是说，我们的模板可能只准备了5页：封面、目录、内容1、内容2、结尾，那我生成的PPT用户要求是10页、20页怎么办？那是不是内容页应当是可以赋值使用的，只是其中的文本和配图的差异，这个设计就是出于这个来考虑的。

接着就利用大模型，根据**requirement、searchInfo以及template来生成出每页的详细内容，这样模型在生成大纲时，就能够同时考虑 内容逻辑 和 模板结构，从而生成更合理的 PPT 页面规划。**

```java
String prompt = PptBuilderPrompts.getOutlinePrompt(
        requirement,
        templateSchema,
        template.getTemplateName(),
        searchInfo
);
```

当模型生成完成之后，会执行完成回调：

```java
.doOnComplete(() -> {
    log.info("大纲生成完成");

    context.getPptInstService()
            .updateOutline(inst.getId(), outlineContent.toString(), TARGET_STATUS);

    sink.tryEmitNext(context.createThinkingResponse("\n✅ 大纲生成完成，开始设计PPT详细内容\n"));

    context.continueStateMachine(inst, sink, query, thinkingBuffer);
})
```

这里主要完成三件事情：

1. **保存生成的大纲内容**
2. **更新任务状态为 SCHEMA**
3. **继续推进状态机**

随后系统就会进入下一阶段。

后面就是这个智能体最核心的两个环节，分别是Schema生成（SchemaStrategy）和PPT渲染（RenderStrategy），我们单独在下一章节进行介绍。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69aed344d31fed000124f49d
