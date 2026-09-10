---
title: "✅Agent Skills到底是如何实现的？"
---

# ✅Agent Skills到底是如何实现的？

如果你用过 Claude Code 这种类似的 Code Cli，那么一定知道他们都有强大的 Skills 技能系统。Claude Code 启动时会自动加载 `~/.claude/skills/` 目录下的技能，当用户提出某个专业领域的问题时，Claude Code 会自动加载对应的技能指令，按照技能中的指引来完成任务。比如你想让它帮你做一个 PPT，它会加载 PPT 技能，按照技能中的工作流一步步完成。

Anthropics 官方在 GitHub 上开源了一系列 Skills（[https://github.com/anthropics/skills），](https://github.com/anthropics/skills），涵盖)涵盖了 PPT 制作、代码审查、技术画图、安全扫描等多个领域。这些 Skills 本质上就是文件目录，包含了专业领域的知识、工作流程和操作指引。

那么问题来了，**能不能在我们的 dodo-agent 中 web 端实现类似 Claude Code 的 Skills 能力？** 答案当然是可以的。**我们这节课就要手搓一套 Agent Skills 系统，并把它集成到 ReactAgent 架构中。**

在之前的课程中，我们已经基于 ReactAgent 实现了 WebSearchReactAgent、FileReactAgent，它们各自集成了不同的工具。而 SkillsReactAgent 的目标是把 Skills、搜索、文件系统、Bash 等多种能力整合到一起，通过 Skills 系统让 Agent 具备按需获取专业领域知识的能力。

其中 ReactAgent 的轮次调度、流式输出、工具调用等基础机制在前面的课程中已经详细讲过，这里不再赘述，直接聚焦 Skills 的实现。

Skills 架构概览

核心设计思路

Skills 系统采用**两阶段加载**策略：

```text
第一阶段（轻量）：启动时扫描技能目录 → 提取元数据（名称+描述） → 格式化为系统提示词
第二阶段（按需）：LLM 判断需要某个技能 → 调用 read_skill 工具 → 加载完整技能内容
```

为什么要分两个阶段？因为一个技能的完整内容可能有几千甚至上万 token。以官方的 PPT 技能为例，

[`https://github.com/anthropics/skills/tree/main/skills/pptx`](https://github.com/anthropics/skills/tree/main/skills/pptx)`SKILL.md` 文件包含了从安装 python-pptx 到创建演示文稿、添加图表、应用主题等完整的工作流指引，内容非常长。如果把所有技能的完整内容都塞进系统提示词，会带来三个问题：

1. **Token 浪费**：每次对话都携带全部技能内容，但大部分技能根本用不到
2. **干扰 LLM 判断**：过多的上下文信息会让 LLM 的注意力分散，降低决策准确度
3. **响应延迟**：系统提示词越长，模型的首 token 响应时间越慢

所以两阶段加载的本质是：**用最少的 Token 告诉 LLM 有哪些技能可用，等 LLM 真正需要时再加载完整内容**。

包结构

Skills 模块的代码组织如下：

```java
agent/agent/skills/
├── SkillsReactAgent.java        ← 集成 Skills 的 React Agent
└── manual/                      ← 手动开发的 Skills 实现
    ├── SkillManager.java        ← 技能管理器（统一入口）
    ├── SkillPromptFormatter.java← 提示词格式化器
    ├── config/
    │   └── SkillConfig.java     ← 配置类（技能目录等）
    ├── model/
    │   ├── SkillMetadata.java   ← 技能元数据
    │   └── SkillLoadingException.java
    ├── registry/
    │   ├── SkillRegistry.java   ← 注册表接口
    │   ├── AbstractSkillRegistry.java ← 基类
    │   └── FileSystemSkillRegistry.java ← 文件系统实现
    └── tool/
        └── ReadSkillTool.java   ← read_skill 工具
```

接下来逐层拆解。

技能元数据：SkillMetadata

核心思路

SkillMetadata 是技能的名片，它不包含技能的完整内容，只包含 LLM 在**判断是否需要某个技能**时所需的关键信息，名称和描述。这就像一本书的目录，告诉你有哪些章节，但不会把所有内容都展示出来。

实现细节

```java
public record SkillMetadata(
        String name,           // 技能名称，如 "pptx"
        String description,    // 技能描述，用于 LLM 判断是否匹配用户意图
        Path skillPath,        // 技能目录路径
        SkillSource source,    // 技能来源（PROJECT/USER）
        List<String> allowedTools, // 技能允许使用的工具列表
        Path skillFile         // SKILL.md 文件的完整路径
) {
    public enum SkillSource {
        PROJECT,  // 项目内置技能
        USER      // 用户自定义技能
    }
}
```

这里使用了 Java 的 `record` 类来定义元数据，因为元数据本质上就是一个**不可变的数据载体**。关键字段的作用：

- **name**：技能的唯一标识，也是 `read_skill` 工具的入参，直接对应文件系统中的目录名
- **description**：一段简洁的功能描述，会被注入到系统提示词中供 LLM 判断
- **skillFile**：指向 `SKILL.md` 文件的路径，按需加载完整内容时直接读取这个文件

另外还有两个字段是**预留设计，当前并未实际使用**：

- **SkillSource**：标识技能来源（PROJECT 项目内置 / USER 用户自定义），目前 `FileSystemSkillRegistry` 在构建时统一硬编码为 `PROJECT`，没有任何地方读取这个值。预留的目的是未来支持多来源技能的优先级管理，比如用户自定义技能可以覆盖同名项目技能
- **allowedTools**：从 SKILL.md 的 YAML frontmatter 中解析出来的工具白名单，`SkillMetadata` 中也提供了 `isToolAllowed()` 方法。但目前没有用，所有技能都可以使用全部工具。预留的目的是未来实现技能级别的工具权限控制，比如某个技能只允许使用 `read_file` 和 `bash`，不允许使用 `write_file`

技能注册表：SkillRegistry

核心思路

有了元数据定义，接下来的问题就是：**技能从哪里来？如何被发现和加载？**

我们通过 **SkillRegistry（技能注册表）** 来解决这个问题。注册表负责扫描技能目录、解析技能文件、缓存元数据和内容。整体采用**接口+抽象基类+具体实现**的三层结构：

```java
SkillRegistry（接口）
    ↓
AbstractSkillRegistry（抽象基类 - 懒加载+缓存）
    ↓
FileSystemSkillRegistry（具体实现 - 文件系统扫描）
```

实现细节

**SkillRegistry 接口**定义了注册表的核心操作：

```java
public interface SkillRegistry {
    List<SkillMetadata> listAll() throws SkillLoadingException;
    SkillMetadata get(String name) throws SkillLoadingException;
    boolean contains(String name);
    int size();
    String readSkillContent(String name) throws SkillLoadingException;
    void reload() throws SkillLoadingException;
    void clearCache();
}
```

- **listAll / get**：查询操作，获取全部或指定技能的元数据
- **readSkillContent**：按需加载技能的完整内容，这是第二阶段加载的核心方法
- **reload / clearCache**：支持热更新，重新加载技能目录（暂未使用）

**AbstractSkillRegistry 抽象基类**提供了缓存和懒加载机制：

```java
public abstract class AbstractSkillRegistry implements SkillRegistry {

    protected final Map<String, SkillMetadata> metadataCache = new ConcurrentHashMap<>();
    protected final Map<String, String> contentCache = new ConcurrentHashMap<>();
    protected volatile boolean loaded = false;

    @Override
    public List<SkillMetadata> listAll() throws SkillLoadingException {
        ensureLoaded();  // 首次调用时才真正加载
        return List.copyOf(metadataCache.values());
    }

    @Override
    public String readSkillContent(String name) throws SkillLoadingException {
        // 先查内容缓存
        if (cacheEnabled && contentCache.containsKey(name)) {
            return contentCache.get(name);
        }
        ensureLoaded();
        SkillMetadata metadata = metadataCache.get(name);
        if (metadata == null) {
            throw SkillLoadingException.notFound(name);
        }
        String content = loadContent(metadata);  // 子类实现具体的文件读取
        if (cacheEnabled) {
            contentCache.put(name, content);
        }
        return content;
    }

    protected void ensureLoaded() throws SkillLoadingException {
        if (!loaded) {
            synchronized (this) {
                if (!loaded) {
                    loadSkills();  // 子类实现具体的扫描逻辑
                    loaded = true;
                }
            }
        }
    }

    protected abstract void loadSkills() throws SkillLoadingException;
    protected abstract String loadContent(SkillMetadata metadata) throws SkillLoadingException;
}
```

这里有两个重要的设计要点：

- **双重检查锁定的懒加载**：`ensureLoaded()` 使用 `volatile + synchronized` 实现线程安全的懒加载，技能目录在首次访问时才扫描，而不是在应用启动时
- **两级缓存**：`metadataCache` 缓存技能元数据，`contentCache` 缓存技能完整内容。元数据缓存是必须的（每次请求都要查询），内容缓存可以避免重复读取磁盘

**FileSystemSkillRegistry** 是注册表的具体实现，负责从本地文件系统发现和加载技能：

```java
public class FileSystemSkillRegistry extends AbstractSkillRegistry {

    private static final String SKILL_MD_FILE = "SKILL.md";

    @Override
    protected void loadSkills() throws SkillLoadingException {
        Map<String, SkillMetadata> newMetadata = new HashMap<>();
        for (Path dirPath : directories) {
            loadSkillsFromDirectory(dirPath, newMetadata);
        }
        metadataCache.putAll(newMetadata);
    }

    private void loadSkillsFromDirectory(Path dirPath, Map<String, SkillMetadata> metadataMap)
            throws SkillLoadingException {
        try (var stream = Files.list(dirPath)) {
            stream.forEach(subDir -> {
                if (!Files.isDirectory(subDir)) return;

                Path skillFile = subDir.resolve(SKILL_MD_FILE);
                if (!Files.exists(skillFile)) return;

                String skillName = subDir.getFileName().toString();
                String content = Files.readString(skillFile);
                SkillMetadata metadata = parseSkillMetadata(skillName, content, subDir, skillFile);
                metadataMap.put(skillName, metadata);
            });
        }
    }
}
```

扫描逻辑非常直观：

1. 遍历配置的技能目录
2. 对于目录下的每个子目录，检查是否存在 `SKILL.md` 文件
3. 如果存在，读取文件内容，解析元数据，放入缓存

以官方的 PPT 技能为例，它的目录结构如下：

```java
~/.claude/skills/
└── autumnsgrove-pptx/        ← 目录名就是技能名
    ├── SKILL.md              ← 技能文件（必须）
    ├── examples/             ← 示例（可选）
    ├── references/           ← 参考资料（可选）
    └── scripts/              ← 辅助脚本（可选）
```

FileSystemSkillRegistry 扫描后，会为这个目录生成一个 SkillMetadata，name 为 "autumnsgrove-pptx"，description 从 SKILL.md 中提取。

**元数据解析**的关键在于从 `SKILL.md` 文件中提取 description：

```java
private String extractDescription(String name, String content) {
    // 优先从 YAML frontmatter 中提取
    String frontmatter = extractFrontmatter(content);
    if (frontmatter != null) {
        Yaml yaml = new Yaml();
        Map<String, Object> data = yaml.load(frontmatter);
        if (data != null && data.containsKey("description")) {
            return data.get("description").toString();
        }
    }
    // 回退：取第一段非标题文本
    String withoutFrontmatter = removeFrontmatter(content);
    // ...解析第一段正文
}
```

它支持两种描述提取方式：

1. **YAML frontmatter**：如果 SKILL.md 文件开头有 `---` 包裹的 YAML 块，从中读取 `description` 字段
2. **正文回退**：如果没有 frontmatter，取正文的第一段非标题文本作为描述

以官方 PPT 技能的 SKILL.md 为例，它的开头是这样的：

```text
---
name: pptx
description: "Professional PowerPoint presentation creation, editing, and automation with support for layouts, templates, charts, images, and formatting."
---

# PowerPoint (PPTX) Skill

## Overview
This skill provides comprehensive PowerPoint presentation creation...
```

FileSystemSkillRegistry 会从 YAML frontmatter 中提取 `description` 字段，这段描述最终会被注入到系统提示词中。当用户说"帮我做一个 PPT"时，LLM 就能根据这段描述判断应该加载这个技能。

提示词格式化：SkillPromptFormatter

核心思路

有了技能元数据列表，下一步就是把它们格式化为一段系统提示词，让 LLM 知道当前有哪些技能可用。这就是 SkillPromptFormatter 的职责。

实现细节

```java
public final class SkillPromptFormatter {

    public static String format(List<SkillMetadata> skills) {
        if (skills == null || skills.isEmpty()) {
            return "";
        }

        String skillList = skills.stream()
                .map(s -> "- **" + s.name() + "**：" + s.description())
                .collect(Collectors.joining("\n"));

        return """
                ## 可用技能列表

                【重要说明】技能不是工具！技能是使用指南和指令集合。
                当你需要使用某个技能时，必须先调用 read_skill 工具加载技能内容。
                技能内容加载后，按照技能中的指令来完成任务。

                **可用技能：**
                %s

                **正确的使用流程：**
                1. 用户要求使用某个技能
                2. 调用 read_skill("技能名称") 来获取技能的完整指令
                3. 仔细阅读返回的技能内容
                4. 按照技能中的指令来完成任务
                5. 绝对不要把技能名称当作工具来调用！

                **示例：**
                  用户："使用 pdf 技能"
                  助手：[调用 read_skill("pdf")]
                  工具：返回 PDF 提取指令
                  助手：[按照指令提取 PDF 内容]
                """.formatted(skillList);
    }
}
```

这段提示词的设计有几个关键点：

- **技能不是工具**：防止 LLM 把技能名称直接当作工具调用，因为这是一个**非常常见的大模型直觉**
- **正确的使用流程**：明确告诉 LLM 应该先调用 `read_skill`，再按指令执行，分两步走
- **示例对话**：用一个具体的例子演示完整的调用链路

最终生成的提示词会被追加到 SkillsReactAgent 的系统提示词末尾，与 ReactAgent 的基础系统提示词合并为一个完整的 SystemMessage。

技能加载工具：ReadSkillTool

核心思路

ReadSkillTool 是整个 Skills 系统中**唯一一个暴露给 LLM 的工具**。它的职责非常简单：接收技能名称，返回该技能的完整内容。它是连接 LLM 和 SkillRegistry 的桥梁。

实现细节

ReadSkillTool 使用 Spring AI 的 `FunctionToolCallback` 来创建工具回调：

```java
public class ReadSkillTool implements Function<ReadSkillTool.Request, ReadSkillTool.Result> {

    private final SkillRegistry skillRegistry;

    public static ToolCallback create(SkillRegistry skillRegistry) {
        return FunctionToolCallback.builder("read_skill", new ReadSkillTool(skillRegistry))
                .description(DESCRIPTION)
                .inputType(Request.class)
                .build();
    }

    @Override
    public Result apply(Request request) {
        String skillName = request.skill();
        try {
            String content = skillRegistry.readSkillContent(skillName);
            return new Result(skillName, content, true, null);
        } catch (SkillLoadingException e) {
            return new Result(skillName, null, false, e.getMessage());
        }
    }

    public record Request(
            @JsonProperty(required = true)
            @JsonPropertyDescription("The name of the skill to load")
            String skill
    ) {}

    public record Result(
            @JsonProperty("skill") String skill,
            @JsonProperty("content") String content,
            @JsonProperty("success") boolean success,
            @JsonProperty("error") String error
    ) {}
}
```

这里有几个值得关注的实现细节：

核心逻辑就是一行 `skillRegistry.readSkillContent(skillName)`，具体的文件读取和缓存由 Registry 层处理，工具层保持薄而轻。

技能管理器：SkillManager

核心思路

SkillManager 是整个 Skills 模块的**统一入口**，它把 Config、Registry、PromptFormatter 这些组件组装在一起，对外提供简洁的 API。

实现细节

```java
public class SkillManager {

    private final SkillConfig config;
    private final SkillRegistry registry;
    private final Function<List<SkillMetadata>, String> promptFormatter;

    public static SkillManager create(SkillConfig config) {
        if (config == null) {
            return null;
        }
        return new SkillManager(config);
    }

    private SkillManager(SkillConfig config) {
        this.config = config;
        this.registry = buildSkillRegistry(config);
        this.promptFormatter = config.getPromptFormatter() != null
                ? config.getPromptFormatter()
                : SkillPromptFormatter::format;
    }

    private static SkillRegistry buildSkillRegistry(SkillConfig config) {
        FileSystemSkillRegistry.Builder builder = FileSystemSkillRegistry.builder();
        for (var dirPath : config.getDirectories()) {
            builder.addDirectory(dirPath);
        }
        return builder.autoReload(config.isAutoReload()).build();
    }

    public String formatPrompt() {
        List<SkillMetadata> skills = getSkills();
        if (skills.isEmpty()) {
            return "";
        }
        return promptFormatter.apply(skills);
    }

    public SkillRegistry getRegistry() {
        return registry;
    }
}
```

SkillManager 的组装过程：

```java
SkillConfig（配置技能目录路径）
      ↓
buildSkillRegistry()  →  FileSystemSkillRegistry（扫描目录，发现技能）
      ↓
promptFormatter       →  SkillPromptFormatter（格式化为系统提示词）
      ↓
SkillManager（统一入口）
```

`formatPrompt()` 是 SkillManager 最核心的方法——先获取所有技能的元数据列表，再通过格式化器生成系统提示词片段。`promptFormatter` 支持自定义注入，默认使用内置的 `SkillPromptFormatter::format`。

与 ReactAgent 的整合

核心思路

前面讲了 Skills 模块自身的实现，接下来看它如何与 SkillsReactAgent 整合。整合的核心思路是：**技能列表注入系统提示词，read_skill 作为工具注册，Agent 在 React 循环中自动判断和调用**。ReactAgent 的基础机制在前面的课程中已经讲过，这里不再赘述。

实现细节

整合逻辑在 AgentController 的 `initManualSkillsReactAgent()` 方法中：

```java
private SkillsReactAgent initManualSkillsReactAgent() {
    // 1. 配置技能目录，构建 SkillManager
    SkillConfig skillConfig = SkillConfig.builder()
            .addDirectory(skillsDirectory)
            .build();
    SkillManager skillManager = SkillManager.create(skillConfig);

    // 2. 将技能列表格式化为系统提示词的一部分
    String skillsPrompt = skillManager.formatPrompt();
    log.info("手动 Skills 模式：加载了 {} 个技能", skillManager.getSkillCount());

    // 3. 创建 ReadSkillTool 作为独立的工具回调
    ToolCallback readSkillTool = ReadSkillTool.create(skillManager.getRegistry());

    // 4. 合并工具：搜索 + 文件 + read_skill + 文件系统 + Bash
    ToolCallback[] allTools = ToolMergeUtils.mergeTools(
            webSearchToolCallbacks,
            ToolCallbacks.from(fileContentService),
            new ToolCallback[]{readSkillTool},
            FileSystemTools.create(),
            GrepTool.create(),
            BashTool.create()
    );

    // 5. 构建 SkillsReactAgent
    return SkillsReactAgent.builder()
            .name("manual-skills")
            .chatModel(chatModel)
            .tools(allTools)
            .systemPrompt(skillsPrompt)
            .sessionService(sessionService)
            .taskManager(taskManager)
            .maxRounds(10)
            .build();
}
```

整个整合流程分为五步：

**第一步：创建 SkillManager**。传入技能目录路径，SkillManager 内部会构建 FileSystemSkillRegistry。

**第二步：生成技能提示词**。调用 `skillManager.formatPrompt()` 获取格式化后的提示词片段，包含所有可用技能的名称和描述。

**第三步：创建 ReadSkillTool**。将 Registry 传给 ReadSkillTool，使其能够在 LLM 调用时读取技能完整内容。

**第四步：合并所有工具**。将 read_skill 与搜索工具、文件工具、文件系统工具、Bash 工具等合并，形成完整的工具集。

**第五步：构建 Agent**。把工具集和技能提示词传给 SkillsReactAgent，其中 `systemPrompt` 参数就是技能提示词。

在 SkillsReactAgent 内部，技能提示词是这样注入的：

```java
private Flux<String> streamInternal(String conversationId, String question, String fileId) {
    // ...
    // 加载基础系统提示词（角色定义、工具调用规则等）
    String fullSystemPrompt = ReactAgentPrompts.getSkillsPrompt();
    // 追加技能提示词
    if (StringUtils.isNotBlank(systemPrompt)) {
        fullSystemPrompt = fullSystemPrompt + "\n" + systemPrompt;
    }
    messages.add(new SystemMessage(fullSystemPrompt));
    // ...
}
```

基础系统提示词和技能提示词被拼接为一个完整的 SystemMessage，避免发送多个 SystemMessage 导致部分大模型 API 报错。

**比如：MiniMax模型的的API不允许传递多个SystemMessage，否则会报错400，这个是与大模型的chattemplate有关，需要注意，但是像qwen-plus这种是可以支持多个systemmessage的。**

完整执行流程

将所有组件串联起来，当用户说"帮我做一个 PPT，人工智能的发展趋势主题，10 页"时，完整的执行流程如下：

```java
1. 应用启动阶段
   AgentController.initManualSkillsReactAgent()
   ├─ SkillManager.create(config)
   │   └─ FileSystemSkillRegistry（懒加载，尚未扫描目录）
   ├─ skillManager.formatPrompt()
   │   └─ 触发首次扫描 → 提取多个技能的元数据（如 autumnsgrove-pptx、spring-ai 等）
   │   └─ SkillPromptFormatter.format() → 生成技能列表提示词
   └─ ReadSkillTool.create(registry)

2. 用户发送请求
   "帮我做一个 PPT，人工智能的发展趋势主题，10 页，科技风"
   ↓
   SkillsReactAgent.streamInternal()
   ├─ 拼接 SystemMessage（基础提示词 + 技能列表提示词）
   ├─ 注册工具集（search + loadContent + read_skill + write_file + bash + ...）
   └─ 进入 React 循环

3. Round 1 - LLM 判断需要技能
   LLM 分析用户意图 → 匹配到 "autumnsgrove-pptx" 技能
   → 输出 ToolCall: read_skill("autumnsgrove-pptx")

4. 工具执行
   ReadSkillTool.apply("autumnsgrove-pptx")
   → registry.readSkillContent("autumnsgrove-pptx")
   → 读取 SKILL.md 文件 → 返回完整 PPT 制作指引
   （包含 python-pptx 的安装、创建演示文稿、添加幻灯片、应用主题等完整工作流）

5. Round 2 - LLM 按照技能指引执行
   LLM 阅读 PPT 技能指引 → 按指引调用 write_file、bash 等工具
   → ToolCall: write_file("create_ppt.py", "python代码...")
   → ToolCall: bash("python create_ppt.py")

6. Round N - 最终答案
   LLM 总结执行结果 → 输出自然语言回复
   "PPT 已创建完成！文件路径：output/ai_trends.pptx"
```

总结

Skills 系统的核心设计可以归纳为一句话：**轻量元数据注入提示词 + 渐进式按需加载完整内容**。

从工程实现的角度看，整个系统分为四层：

1. **配置层**（SkillConfig）：定义技能目录路径等基础配置
2. **注册表层**（SkillRegistry / FileSystemSkillRegistry）：扫描文件系统、解析 SKILL.md 的 YAML frontmatter、缓存元数据和内容
3. **工具层**（ReadSkillTool）：通过 FunctionToolCallback 将注册表能力暴露为 LLM 可调用的 `read_skill` 工具
4. **整合层**（SkillManager + SkillPromptFormatter + SkillsReactAgent）：将技能列表注入系统提示词，将 read_skill 注册为工具，在 React 循环中实现自动判断和调用

这种设计的优势在于：

- **Token 高效**：只有被使用的技能才会加载完整内容，避免系统提示词无限膨胀
- **扩展性强**：新增技能只需要在目录下添加一个文件夹目录，包含`SKILL.md`文件，无需修改任何代码
- **与 ReactAgent 解耦**：Skills 模块是独立的，可以被任何 Agent 集成使用
- **兼容官方 Skills**：直接支持 Anthropic 官方开源的 Skills 格式（如<br>[https://github.com/anthropics/skills](https://github.com/anthropics/skills)<br>中的技能），拿来即用

效果演示

为了展示 Skills 的实际运行效果，这里直接选用 MiniMax-M2.7 推理模型。相比 qwen-plus，MiniMax 能够输出思考过程（thinking），整体输出更加丰富。而且在编写 Python 代码方面，MiniMax 的表现也更加突出。不过线上的MiniMax响应比较慢，非常耗时，尤其是生成python代码的时候，大量的代码，需要编写很长的时间才能完成。

以 PPT 制作为例，当用户提出"帮我做一个 PPT，人工智能的发展趋势主题，10 页，科技风"时，MiniMax 的执行过程如下：

1. 先思考分析用户需求，匹配到 `autumnsgrove-pptx` 技能
2. 调用 `read_skill("autumnsgrove-pptx")` 加载完整的 PPT 技能指引
3. 按照技能指引，编写 Python 代码调用 python-pptx 生成 PPT（这步操作会非常耗时）
4. 通过 `write_file` 写入 Python 脚本，再通过 `bash` 执行

整个过程不需要任何人工干预，LLM 根据技能指引自主完成了从分析需求到生成文件的完整流程。

**踩坑：maxTokens 截断问题**

在测试过程中发现一个问题：MiniMax 在调用 `write_file` 工具时，参数经常为空（`arguments={}`）。排查后发现，根本原因是 `application.yml` 中配置的 `maxTokens: 5000` 限制了模型的单次输出长度。

在 Agent Skills 场景中，当模型按照技能指引编写 Python 代码时，代码量往往很大，再加上工具调用的 JSON 结构，很容易突破 5000 token 的限制。一旦被截断，工具调用的 arguments 就不完整，最终表现为参数为空。

解决方案很简单——直接把 `application.yml` 中的 `maxTokens` 配置去掉，让模型输出不受限制：

```yaml
spring:
  ai:
    openai:
      chat:
        options:
          model: MiniMax-M2.7
          temperature: 0.7
          # maxTokens: 5000   ← 删掉或注释掉即可
```

这个问题在之前的 WebSearchReactAgent 中不会出现，因为搜索工具的参数都很短。但到了 Skills 场景，模型需要生成大段代码，token 消耗会远超预期。所以如果你的 Agent 涉及代码生成类的场景，一定要注意 `maxTokens` 的设置。

![](assets/302f0c52d168.gif)

![](assets/f8f7ca8b20c2.png)

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69faeb84a7c8ff0001af2250
