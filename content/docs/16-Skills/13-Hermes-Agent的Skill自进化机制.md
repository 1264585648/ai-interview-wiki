---
title: "✅Hermes Agent的Skill自进化机制"
---

# ✅Hermes Agent的Skill自进化机制

这几天（4月初级到四月中旬），Nous Research开源的Hermes Agent突然火起来了，github的star数在疯涨，热度高到有超越open claw的势头了。

为什么他这么火呢？主要是因为他解决了open claw中的这样一个痛点：

在使用 OpenClaw 完成一个任务后，无论过程中走了多少弯路、犯了多少错误，这些宝贵的经验都不会沉淀下来，都是用后即焚的。即使下次再遇到相同的任务，他还会从头再来一遍，把踩过的坑再踩一遍。即使你让它记录Memory，他也只是会记录一些简要的重点事项和用户习惯，并不会记录太多执行细节。

Hermes则引入了一种Skill自进化机制，来解决这个问题。

说的简单点，就是引入了一种动态的Skill沉淀的能力。在Hermes Agent中，每次完成复杂任务后，Hermes不会简单地丢弃对话历史，而是会启动一个“复盘”流程。它会回过头来审视整个执行轨迹，提取其中的关键步骤，特别是那些“踩过的坑”、有效的纠错手段以及人工验证过的最佳实践。

随后，系统将这套经验总结、抽象为一个结构化的Skill技能文件包。这就带来了一个根本性的转变：Skill 从“静态调用”变成了“动态生成”。

总结一下：**Skill 自进化是指 AI Agent 能够在执行任务的过程中自动创建新的技能，并在后续使用中持续改进这些技能的能力。**

在Hermes中，Skill生成的触发时机包括：

```text
# agent/prompt_builder.py 第 164-171 行
SKILLS_GUIDANCE = (
    "After completing a complex task (5+ tool calls), fixing a tricky error, "
    "or discovering a non-trivial workflow, save the approach as a "
    "skill with skill_manage so you can reuse it next time.\n"
    "When using a skill and finding it outdated, incomplete, or wrong, "
    "patch it immediately with skill_manage(action='patch') — don't wait to be asked. "
    "Skills that aren't maintained become liabilities."
)
```

| **触发条件** | **说明** |
| --- | --- |
| **复杂任务成功完成后** | 任务使用了 5+ 个工具调用 |
| **克服错误后** | 在解决错误后形成可复用的方法 |
| **用户纠正的方法奏效后** | 用户指导的方法被验证有效 |
| **发现非平凡的工作流** | 发现了复杂的工作流程 |
| **用户明确要求记住某个流程** | 用户主动要求保存为 Skill |

**触发原则**：

- 在困难/迭代任务后，Agent 会**主动提议**保存为 Skill
- 简单的一次性任务跳过
- 创建/删除前需要**用户确认**

入口函数：skill_manage()

```
def skill_manage(
    action: str,           # "create", "edit", "patch", "delete", "write_file", "remove_file"
    name: str,             # Skill 名称
    content: str = None,   # SKILL.md 完整内容（create/edit 时需要）
    category: str = None,  # 可选分类（如 "devops", "mlops"）
    ...
) -> str:
```

Skill 创建的核心步骤（_create_skill 函数）

```
def _create_skill(name: str, content: str, category: str = None) -> Dict[str, Any]:
```

Skill的创建有多种触发机制：

自动触发机制

自动触发完全依赖 **LLM 的自主决策**。通过在系统提示中植入指导文本，让 LLM 自己判断何时应该创建或更新 Skill。

在 Hermes Agent 中，系统会在每次对话开始时给 AI 发送一段"指导语"，告诉它什么情况下应该创建 Skill。AI 在工作的过程中，会自主决定什么时候调用创建工具。

首先，系统提示词注入：

```text
# agent/prompt_builder.py 第 164-171 行
SKILLS_GUIDANCE = (
    "After completing a complex task (5+ tool calls), fixing a tricky error, "
    "or discovering a non-trivial workflow, save the approach as a "
    "skill with skill_manage so you can reuse it next time.\n"
    "When using a skill and finding it outdated, incomplete, or wrong, "
    "patch it immediately with skill_manage(action='patch') — don't wait to be asked. "
    "Skills that aren't maintained become liabilities."
)
```

- 完成一项复杂任务（涉及5次以上工具调用）
- 修复一个棘手的错误
- 发现一种复杂且有效的工作流程后
- 使用某项技能时，若发现它已过时、不完整或存在错误，立即修正

系统提示组装：

```text
# run_agent.py 第 3374-3383 行
def _build_system_prompt(self, system_message: str = None) -> str:
    # ...
    # Tool-aware behavioral guidance: only inject when the tools are loaded
    tool_guidance = []
    if "memory" in self.valid_tool_names:
        tool_guidance.append(MEMORY_GUIDANCE)
    if "session_search" in self.valid_tool_names:
        tool_guidance.append(SESSION_SEARCH_GUIDANCE)
    if "skill_manage" in self.valid_tool_names:      # ← 检查 skill_manage 是否可用
        tool_guidance.append(SKILLS_GUIDANCE)         # ← 注入 Skill 指导
    if tool_guidance:
        prompt_parts.append(" ".join(tool_guidance))
```

**关键点**：

- 只有在 skill_manage 工具可用时才注入指导
- 指导文本成为系统提示的一部分
- LLM 每次响应都会"看到"这个指导

工具Schema强化：

```text
# tools/skill_manager_tool.py 第 683-701 行
SKILL_MANAGE_SCHEMA = {
    "name": "skill_manage",
    "description": (
        "Manage skills (create, update, delete). Skills are your procedural "
        "memory — reusable approaches for recurring task types.\n\n"
        # ===== 被动触发条件定义 =====
        "Create when: complex task succeeded (5+ calls), errors overcome, "
        "user-corrected approach worked, non-trivial workflow discovered, "
        "or user asks you to remember a procedure.\n"
        "Update when: instructions stale/wrong, OS-specific failures, "
        "missing steps or pitfalls found during use. "
        "If you used a skill and hit issues not covered by it, patch it immediately.\n\n"
        "After difficult/iterative tasks, offer to save as a skill. "
        "Skip for simple one-offs. Confirm with user before creating/deleting."
    ),
    ...
}
```

自动触发工作流程：

```text
用户输入
    │
    ▼
┌─────────────────────────────────────┐
│  系统提示包含 SKILLS_GUIDANCE        │
│  "After completing a complex task   │
│   (5+ tool calls)..."               │
└─────────────────────────────────────┘
    │
    ▼
LLM 处理任务
    │
    ├─── 工具调用 1 ────┐
    ├─── 工具调用 2 ────┤
    ├─── 工具调用 3 ────┤  LLM 自主计数
    ├─── 工具调用 4 ────┤  和判断
    ├─── 工具调用 5 ────┘
    │
    ▼
LLM 判断："这是一个复杂任务，应该保存为 Skill"
    │
    ▼
主动调用 skill_manage(action="create")
    │
    ▼
创建 Skill 文件
```

后台审查机制

除了自动触发外，还有一种后台审查机制的触发，即系统跟踪工具调用次数，达到阈值后自动启动后台审查，无需 LLM 主动决策。

在 Hermes Agent 中，系统会默默计数——每次 AI 使用工具（比如查资料、运行命令、读取文件）都会 +1。当累计达到 10 次后，系统会在后台自动启动一个"审查员"（另一个 AI 实例），让它回顾刚才的对话历史，判断是否需要创建或更新 Skill。这个审查是在后台悄悄进行的，不会打扰用户，如果发现值得保存的内容，会发送一个通知。

计数器初始化：

```text
# run_agent.py 第 1219 行 (AIAgent.__init__)
self._iters_since_skill = 0  # 自上次 skill 操作以来的迭代计数器
```

配置加载：

```text
# run_agent.py 第 1340-1346 行
# Skills config: nudge interval for skill creation reminders
self._skill_nudge_interval = 10  # 默认每 10 次工具调用触发一次
try:
    skills_config = _agent_cfg.get("skills", {})
    self._skill_nudge_interval = int(skills_config.get("creation_nudge_interval", 10))
except Exception:
```

迭代计数（核心）：

```text
# run_agent.py 第 8642-8646 行
# 在每次工具调用迭代后执行

# Track tool-calling iterations for skill nudge.
# Counter resets whenever skill_manage is actually used.
if (self._skill_nudge_interval > 0           # 功能已启用
        and "skill_manage" in self.valid_tool_names):  # 工具可用
    self._iters_since_skill += 1              # ← 计数器 +1
```

计数器重置条件：

```text
# run_agent.py 第 7416-7417 行
# 当实际调用 skill_manage 时重置计数器

elif function_name == "skill_manage":
    self._iters_since_skill = 0  # ← 重置计数器
```

触发判断：

```text
# run_agent.py 第 11338-11344 行
# 在响应用户完成后执行

# Check skill trigger NOW — based on how many tool iterations THIS turn used.
_should_review_skills = False
if (self._skill_nudge_interval > 0           # 1. 功能已启用
        and self._iters_since_skill >= self._skill_nudge_interval  # 2. 达到阈值
        and "skill_manage" in self.valid_tool_names):  # 3. 工具可用
    _should_review_skills = True
    self._iters_since_skill = 0              # ← 重置计数器
```

启动后台审查：

```text
# run_agent.py 第 11356-11366 行
# Background memory/skill review — runs AFTER the response is delivered
# so it never competes with the user's task for model attention.
if final_response and not interrupted and (_should_review_memory or _should_review_skills):
    try:
        self._spawn_background_review(
            messages_snapshot=list(messages),
            review_memory=_should_review_memory,
            review_skills=_should_review_skills,  # ← 触发 Skill 审查
        )
    except Exception:
        pass  # Background review is best-effort
```

后台审查执行：

```text
# run_agent.py 第 2371-2469 行
def _spawn_background_review(
    self,
    messages_snapshot: List[Dict],
    review_memory: bool = False,
    review_skills: bool = False,
) -> None:
    """Spawn a background thread to review the conversation for memory/skill saves."""
    import threading

    # 选择审查提示词
    if review_memory and review_skills:
        prompt = self._COMBINED_REVIEW_PROMPT
    elif review_memory:
        prompt = self._MEMORY_REVIEW_PROMPT
    else:
        prompt = self._SKILL_REVIEW_PROMPT  # ← Skill 专用提示词

    def _run_review():
        review_agent = None
        try:
            with contextlib.redirect_stdout(_devnull), \
                 contextlib.redirect_stderr(_devnull):
                
                # ===== 创建 Fork 的 Review Agent =====
                review_agent = AIAgent(
                    model=self.model,
                    max_iterations=8,        # 限制迭代次数
                    quiet_mode=True,         # 静默模式
                    platform=self.platform,
                    provider=self.provider,
                )
                
                # 禁用嵌套触发（避免无限循环）
                review_agent._memory_nudge_interval = 0
                review_agent._skill_nudge_interval = 0

                # 执行审查
                review_agent.run_conversation(
                    user_message=prompt,
                    conversation_history=messages_snapshot,
                )

            # ===== 扫描审查结果 =====
            actions = []
            for msg in getattr(review_agent, "_session_messages", []):
                if msg.get("role") != "tool":
                    continue
                data = json.loads(msg.get("content", "{}"))
                if not data.get("success"):
                    continue
                
                message = data.get("message", "")
                if "created" in message.lower() or "updated" in message.lower():
                    actions.append(message)

            # ===== 通知用户 =====
            if actions:
                summary = " · ".join(dict.fromkeys(actions))
                self._safe_print(f"  💾 {summary}")  # 终端显示
                if self.background_review_callback:
                    self.background_review_callback(f"💾 {summary}")

        finally:
            if review_agent:
                review_agent.close()

    # 启动后台线程
    threading.Thread(target=_run_review, daemon=True, name="bg-review").start()
```

Skill 审查专用提示词：

```text
# run_agent.py 第 2347-2355 行
_SKILL_REVIEW_PROMPT = (
    "Review the conversation above and consider saving or updating a skill if appropriate.\n\n"
    "Focus on: was a non-trivial approach used to complete a task that required trial "
    "and error, or changing course due to experiential findings along the way, or did "
    "the user expect or desire a different method or outcome?\n\n"
    "If a relevant skill already exists, update it with what you learned. "
    "Otherwise, create a new skill if the approach is reusable.\n"
    "If nothing is worth saving, just say 'Nothing to save.' and stop."
)
```

后台审查触发工作流程：

```text
用户输入
    │
    ▼
工具调用循环
    │
    ├─── 每次迭代后 ───► _iters_since_skill += 1
    │
    ▼
响应用户完成
    │
    ▼
检查触发条件
    │
    ├─── _iters_since_skill >= 10? ─── 否 ─── 继续等待
    │
    └─── 是 ───► _should_review_skills = True
                  │
                  ▼
         调用 _spawn_background_review()
                  │
                  ▼
         创建 Fork Review Agent
                  │
                  ▼
         执行 _SKILL_REVIEW_PROMPT
                  │
                  ▼
         LLM 审查对话历史
                  │
    ┌─────────────┴─────────────┐
    ▼                           ▼
 Nothing to save.           调用 skill_manage
    │                           │
    ▼                           ▼
   结束                    创建/更新 Skill
                               │
                               ▼
                          显示 💾 通知
```

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69e0c1433fb91800015923bf
