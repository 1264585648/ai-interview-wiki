---
title: "✅Claude Code中的Skills实现原理"
---

# ✅Claude Code中的Skills实现原理

[claude-code-main.zip](https://tcs-devops.aliyuncs.com/storage/103s4e3faf61f89a400a4e6cc78222dddf88?Signature=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJBcHBJRCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9hcHBJZCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9vcmdhbml6YXRpb25JZCI6IiIsImV4cCI6MTc4OTYxMTM0NywiaWF0IjoxNzg5MDA2NTQ3LCJyZXNvdXJjZSI6Ii9zdG9yYWdlLzEwM3M0ZTNmYWY2MWY4OWE0MDBhNGU2Y2M3ODIyMmRkZGY4OCJ9.a5JRhYUSYHgzyibPB8rRAvQ3PWESDtsTzM4W76W2WEk&download=claude-code-main.zip)

Claude Code的源码泄露了，我下载了一份，放到上面的链接了。

省流版

**相比于OpenCode，CC的实现有几个特点（或者叫优势也行）**

**1、没有单独定义一个Skill的数据模型，而是复用了Command类型，把所有用****`/`**** 触发的都叫做Command**

**2、支持多种Skill的集成方式，包括了内置的，以及插件类型的Skill，以及常见的包路径扫描方式。并且是多路并行同时加载的。**

**3、Skill的描述声明过程中，会看token的情况，如果"预算"不足，会精简skill的描述（截断或者干脆不提供）**

**4、Skill支持多种执行方式，包括inline、fork和remote，尤其是fork这种，可以让skill只在隔离的子agent中运行。**

**以上，3、4两个点，都是上下文管理的手段，可见，CC真的是在上下文工程上做的很极致。**

一、数据模型

在CC中，Skill 在代码中并没有一个独立的 Skill 类型，而是复用了 Command（命令）类型。Claude Code 里所有可以被 /xxx 触发的东西都是 Command，显然，skill也是一个可以通过`/` 触发的东西。

**CommandBase**（所有命令共有的字段）在 src/types/command.ts 中定义：

```text
type CommandBase = {
  name: string                       // 名字，如 "commit"
  description: string                // 简短描述
  isHidden?: boolean                 // 是否对用户隐藏
  userInvocable?: boolean            // 用户能否通过 /xxx 触发
  disableModelInvocation?: boolean   // 是否禁止模型主动调用
  loadedFrom?: 'skills' | 'plugin' | 'bundled' | 'mcp' | ...  // 从哪里加载的
  whenToUse?: string                 // 告诉模型什么时候应该用这个 Skill
  // ...
}
```

**PromptCommand**（Skill 专有的字段）：

```text
type PromptCommand = {
  type: 'prompt'  // 标识这是一个"提示词型"命令，即 Skill
  contentLength: number   // Markdown 内容的字符数
  allowedTools?: string[]// 这个 Skill 运行时允许使用哪些工具
  model?: string      // 是否要求切换模型（如强制用 Opus）
  effort?: EffortValue       // 推理投入级别
  context?: 'inline' | 'fork'  // 执行模式（下面会详细讲）
  hooks?: HooksSettings      // Skill 附带的 hook
  paths?: string[]        // 只在操作特定文件时才激活
  source: 'builtin' | 'plugin' | 'bundled' | ...
  
  // 核心方法：把 SKILL.md 内容转换为注入对话的提示词
  getPromptForCommand(args: string, context: ToolUseContext): Promise<ContentBlockParam[]>
}
```

二、Skill 的发现与加载

在CC中，Skill 有四个来源，所有来源的 Skill 最终汇集到 getCommands()（src/commands.ts）函数中。这个函数用 memoize 做了缓存，同一个工作目录只加载一次：

```text
const loadAllCommands = memoize(async (cwd) => {
  // 四条管道并行执行
  const [skills, pluginCommands, workflowCommands] = await Promise.all([
    getSkills(cwd),         // 包含 ① ② ③
    getPluginCommands(),    // 插件命令
    getWorkflowCommands(),  // Workflow 命令
  ])
  
  // 按优先级拼接（先出现的优先）
  return [
    ...skills.bundledSkills,        // ① 内置最高优先
    ...skills.builtinPluginSkills,  // ② 内置插件
    ...skills.skillDirCommands,     // ③ 目录 Skill
    ...workflowCommands,
    ...pluginCommands,
    ...skills.pluginSkills,         // ④ 插件 Skill
    ...COMMANDS(),                  // 硬编码的命令（/help、/clear等）
  ]
})
```

系统在启动时会从以下这四个地方寻找 Skill：

**1、Bundled Skills（内置 Skill）**

这些 Skill 直接硬编码在源代码中（src/skills/bundled/），编译后成为二进制的一部分。比如 verify Skill：

```
// src/skills/bundled/verify.ts
registerBundledSkill({
  name: 'verify',
  description: 'Verify a code change does what it should',
  files: SKILL_FILES,   // 附属的参考文件
  async getPromptForCommand(args) {
    return [{ type: 'text', text: SKILL_BODY }]
  },
})
```

特点是**不依赖磁盘文件，启动最快**

2、**目录 Skills（用户自定义 Skill）**

系统会在三个层级扫描 .claude/skills/ 目录：

```text
~/.claude/skills/              ← 用户全局 Skill
项目/.claude/skills/            ← 项目级 Skill
<managed-path>/.claude/skills/ ← 组织管理的 Skill
```

加载流程（src/skills/loadSkillsDir.ts）：

```text
-- loadSkillsFromSkillsDir

扫描 .claude/skills/ 下的子目录
    ↓ 对每个子目录，读取 SKILL.md
    ↓ parseFrontmatter() 解析 YAML 头（---之间的内容）
    ↓ parseSkillFrontmatterFields() 提取元数据
    ↓ createSkillCommand() 构造 Command 对象
    ↓ 通过 realpath() 做符号链接去重
    ↓
返回 Command[]
```

**3、插件 Skills**

通过 getPluginSkills()（src/utils/plugins/loadPluginCommands.ts）从已安装的插件中加载。插件结构中有 skillsPath 和 skillsPaths 指向 skill 目录。与目录 Skill 的加载逻辑完全相同，只是会自动加上插件名作为命名空间前缀（如 ms-office-suite:pdf）。

**4、MCP Skills**

MCP 服务器可以提供 prompt 资源，系统会把它们包装成 Skill。这通过 mcpSkillBuilders.ts 中的一个"写一次读多次的注册表"来桥接，避免 MCP 模块和 Skill 加载模块之间产生循环依赖。

三、Skill 的注册

模型本身不知道有哪些 Skill可以用，所以系统必须主动告诉它。CC中通过**两层注入**完成：

**第一层：Skill 列表**

在每轮对话开始前，getSkillListingAttachments()（src/utils/attachments.ts）会把可用 Skill 的"目录"以 attachment 的形式注入：

```text
当前可用 skills：
- commit: Create a git commit with a well-crafted message
- review-pr: Review a pull request and provide feedback
- pdf: Advanced PDF document toolkit for content extraction...
```

这个列表有几个设计要点：

1. **有预算限制**：列表占用的 token 不超过上下文窗口的 1%（约 8000 字符）。超出时会智能截断描述，内置 Skill 的描述优先保留完整。
2. **增量发送**：系统跟踪每个 agent 已经见过哪些 Skill（sentSkillNames Map），只发送新增的。这样当运行时动态发现了新 Skill，只需要补发新增部分。
3. **分级截断策略**（formatCommandsWithinBudget()）：
4. 预算充足 → 所有 Skill 显示完整描述（每条最多 250 字符）
5. 预算紧张 → 内置 Skill 保留完整描述，其他 Skill 截断描述
6. 预算极度紧张 → 内置 Skill 保留描述，其他 Skill 只显示名字

**第二层：系统提示词中的使用指引**

在 src/constants/prompts.ts 的 getSessionSpecificGuidanceSection() 中，有一段话教模型怎么用 Skill：

```text
/<skill-name> (e.g., /commit) is shorthand for users to invoke a user-invocable skill.
When executed, the skill gets expanded to a full prompt.
Use the Skill tool to execute them.
IMPORTANT: Only use Skill for skills listed in its user-invocable skills section - 
do not guess or use built-in CLI commands.
```

加上 SkillTool 自身的 prompt（src/tools/SkillTool/prompt.ts），模型就知道了：

- 有一个叫 Skill 的工具可以用
- 该怎么调用（传入 skill 名字和可选参数）
- 什么时候该用、什么时候不该用

四、Skill 的调用执行

Skill 有两个入口：**用户手动触发**和**模型主动调用**。

入口 1：用户输入 /commit -m "fix bug"

```text
- processSlashCommand.tsx

用户输入 "/commit -m fix bug"
    ↓ parseSlashCommand() 解析出命令名 "commit" 和参数 "-m fix bug"
    ↓ findCommand() 在已注册命令中查找
    ↓ 找到了，类型是 'prompt' → 走 Skill 路径
    ↓ 调用 getPromptForCommand("-m fix bug", context) 展开提示词
    ↓ 展开后的内容作为 UserMessage 注入对话
    ↓ 模型看到这段指令，开始执行
```

入口 2：模型判断需要使用 Skill，主动调用 SkillTool

Claude Code 中模型能做的所有事情都通过"Tool"来完成——读文件用 FileRead、执行命令用 Bash、搜索用 Grep。Skill 也不例外，模型想调用 Skill，就必须发出一个对 Skill 工具的 tool_use 请求。

```text
{
  "type": "tool_use",
  "name": "Skill",
  "input": { "skill": "pdf", "args": "generate report" }
}
```

SkillTool 就是这个工具的实现。接收模型发出的"我想用某个 Skill"的请求，经过验证和权限检查后，找到对应的 Skill，展开它的内容，然后把内容注入到对话中。

SkillTool 自己**不做任何业务逻辑**，它做的是"调度"——找到 Skill、检查权限、决定执行方式、管理返回结果。

然后 SkillTool（src/tools/SkillTool/SkillTool.ts）按以下流程处理：

```text
① validateInput
   → Skill 名字存在吗？
   → 是 prompt 类型吗？
   → 有没有被禁止模型调用（disableModelInvocation）？
   → 任何一项不满足就直接拒绝
         ↓
② checkPermissions
   → 先查 deny 规则（用户可以配置禁止某些 Skill）
   → 再查 allow 规则
   → 如果 Skill 只有"安全属性"（没有 hooks、没有 allowedTools 等
      可能影响安全的东西），自动放行
   → 否则弹窗询问用户
         ↓
③ call（实际执行）
   → 根据 command.context 决定执行模式（Inline、Fork、Remote）
```

SkillTool 的 prompt（src/tools/SkillTool/prompt.ts）是模型理解如何调用它的关键：

```
export const getPrompt = memoize(async (_cwd: string): Promise<string> => {
  return `Execute a skill within the main conversation

When users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.

When users reference a "slash command" or "/<something>" (e.g., "/commit", "/review-pr"), they are referring to a skill. Use this tool to invoke it.

How to invoke:
- Use this tool with the skill name and optional arguments
- Examples:
  - \`skill: "pdf"\` - invoke the pdf skill
  - \`skill: "commit", args: "-m 'Fix bug'"\` - invoke with arguments
  - \`skill: "review-pr", args: "123"\` - invoke with arguments
  - \`skill: "ms-office-suite:pdf"\` - invoke using fully qualified name

Important:
- Available skills are listed in system-reminder messages in the conversation
- When a skill matches the user's request, this is a BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response about the task
- NEVER mention a skill without actually calling this tool
- Do not invoke a skill that is already running
- Do not use this tool for built-in CLI commands (like /help, /clear, etc.)
- If you see a <${COMMAND_NAME_TAG}> tag in the current conversation turn, the skill has ALREADY been loaded - follow the instructions directly instead of calling this tool again
`
})
```

Skill执行模式

**Inline（内联展开，默认模式）**

Skill 的内容直接展开到当前对话上下文中。就像有人在对话中间插入了一段"专家指令"。

```text
对话上下文：[用户消息] [助手回复] [用户消息] ...
                                        ↓ 调用 Skill
对话上下文：[用户消息] [助手回复] [用户消息] [Skill内容（作为UserMessage）] ...
```

**Fork（子 agent 分叉执行）**

Skill 在一个**隔离的子 agent** 中运行，有自己独立的 token 预算和消息历史。执行完毕后，只把最终结果文本返回给主对话。

```text
主对话 ─────────────┬──────────────── 继续主对话
                     │
                     ├→ 子Agent开始执行 Skill
                     │   [独立的上下文和 token 预算]
                     │   [执行多个工具调用...]
                     │   [完成]
                     │        ↓
                     ←── 结果文本返回
```

为什么需要 Fork？因为**有些 Skill 非常复杂**（比如做完整的代码审查），需要大量的工具调用和推理。如果在主对话的上下文中展开，会消耗大量 token，挤压其他对话内容。Fork 模式让复杂 Skill 有自己的"工作空间"。

**Remote（远程加载，实验性）**

从远程存储（GCS/AKI）加载 Skill 内容，用于官方精选的 Skill 库。加载后走 Inline 模式注入。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69cbb058d31fed0001413620
