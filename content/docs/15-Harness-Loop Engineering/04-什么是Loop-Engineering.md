---
title: "✅什么是Loop Engineering"
---

# ✅什么是Loop Engineering

![](assets/bcf1b60dc04c.png)

**Loop Engineering** 这个词在2026年6月由 OpenClaw 创始人 Peter Steinberger 和 Claude Code 负责人 Boris Cherny 几乎同时提出。

Peter 的原话是："You shouldn't be prompting coding agents anymore. You should be designing loops that prompt your agents."

Boris Cherny 则说："My job is to write loops."

随后 Google 工程师 Addy Osmani 在6月7日发了一篇博客正式系统化了这个概念（[https://addyosmani.com/blog/loop-engineering/](https://addyosmani.com/blog/loop-engineering/) ）

Addy 一句话定义最常被引用：

**"****Loop engineering is replacing yourself as the person who prompts the agent. You design the system that does it instead.****"** 循环工程，就是你不再手动prompt Agent，而是设计一个**程序化的循环系统**来驱动Agent自主迭代——定义目标、执行、验证、重复，直到完成。

Agent Loop VS Loop Engineering

需要先澄清一下，有的人误以为Loop Engineering说的就是Agent Loop，但是其实不是的。

我们前面介绍过ReAct Agent，这其实就是一种Agent Loop，Agent Loop 指的是 Agent 内部那个 reasoning ↔ acting 反复迭代的执行机制。

它相当于是在Agent内部不断循环，一直到直到给出 final answer 或耗尽 max_iters。落地到框架代码层面，其实就是一段while循环。

而，Loop Engineering（循环工程） 指的是更高层的一种**编排模式**：在已有 Agent Loop之上，加上**自动触发器、强制验证、跨次反馈改进**，让 Agent 从"等人按一下跑一次"变成"自动持续运转、且越跑越聪明"的生产系统。它不是一段代码，是一种系统设计思路。

解决什么问题？

作为开发者，实际在用 Cursor / Claude Code / Codex 这些coding agent的时候，你会发现一个很憋屈的现象：模型本身不弱，但**真正卡住生产力的不是模型，而是"你"**：

- 它跑一会儿要停下来等你确认
- 跑歪了你得手动纠偏
- 跑完一个任务你得手动开下一个
- 跨会话它就失忆，要你重新喂上下文
- 没人帮它"接 CI、看测试结果、提 PR、回评审意见"

例如你让AI帮你实现换一个XX管理系统，然后他就开始干活了，他运行之后，也许成功了，也许失败了，你需要来做验收或者迭代，看一下他实现的对不对，错了的话错在哪里。所以你经常会和你的AI说：不对重新写、还是报错、请说中文、不要改动某某文件、上次也犯过这个错。。。。

其实，这些问题，**可能并不是模型的问题，当然也不一定是人的问题，是循环系统设计的问题**——用户被迫扛了本该写在结构里的约束、验证、记忆和编排。

Loop Engineering 的存在，就是为了把"用户脱口而出的每一句重复抱怨"翻译成系统组件，让这些话**一次写进结构、永不再说第二遍**。Loop Engineering 的目标就是把这根瓶颈拆掉：**把"人是循环里的发动机"换成"人是循环的设计者和监督者"。**

从编程的角度来看就很好理解，Loop Engineering希望AI能自动的把需求分析、开发、测试、验收、调优、甚至发布流程都干了。

核心思想

Loop Engineering 把 Agent 看作一台**会自我触发、自我验证、自我修复的状态机**，工作模板大致是：

**触发 → 计划 → 执行 → 观察 → 验证 → 反馈 → 再循环**，直到目标判定为 done，或主动暂停等人类介入。

注意它不是"让模型多调几次"那么简单，关键差异是：循环的**入口、出口、约束、记忆**全部由你工程化地设计，而不是靠模型自己的"灵感"。

这点和 ReAct 这种"模型层面的循环"不同——ReAct 是 Agent 内部 reasoning↔acting 的小循环，Loop Engineering 是覆盖在多个 Agent、多个会话、多个工作树之上的**外部生产循环**。

怎么用

怎么在agent中把loop用起来呢。有以下几个组件：

**1）Automations（自动触发器）** — 让循环不再靠你点"运行"。来源可以是 cron、Webhook、文件改动、CI 失败、issue 新增、Slack @机器人等。**这是 Loop 区别于 Chat 的命门**：Chat 是 pull 模型，Loop 是 push 模型。

**2）Worktrees（隔离工作区）** — 每个 Agent 任务用独立的 git worktree / 容器 / 沙箱跑，互不污染。这样可以"开 8 个 Claude Code 同时**并行**修不同 issue"而不互相踩。

**3）Skills（技能/SOP）** — 把"做这类任务的标准流程"沉淀成可复用的技能包（可以是 markdown SOP、可以是 agentscope-java 那种 AgentSkill+resources）。**循环要稳定，前提是步骤可复现。**

**4）Connectors（连接器）** — MCP、API、CLI 工具，让 Agent 能真的去跑测试、读日志、提 PR、查 Jira、发 Slack。光会想不会动是没用的，循环必须能"摸到外部世界"。

**5）Sub-agents（子智能体）** — 把复杂任务拆给专门角色的子 Agent（Planner / Coder / Reviewer / Tester）。父 Agent 负责编排，子 Agent 负责专注。这跟 OpenAI Agents SDK、agentscope 多 Agent 编排是一脉相承的。

**6）Memory / State（持久状态）** — 跨循环不能失忆。短期靠 working memory，长期靠向量库 / 结构化 DB / plan notebook。**没有记忆的循环只是 while(true)，有记忆的循环才叫工程。**

把这 6 件配齐，你就拥有一台"睡觉时也在替你写代码"的机器。

以"夜间自动修测试"为例，串一遍 6 件套是怎么协同的：

Cron 凌晨 2 点触发（Automation）→ 拉最新主干代码进一个新 worktree（Worktree）→ 加载"修测试"技能包（Skill）→ Agent 跑 mvn test 拿失败列表（Connector）→ 把每个失败 case 派给一个 fix-test 子 Agent（Sub-agent）→ 子 Agent 改代码、再跑测试、循环到通过 → 把这次修过的失败模式写进长期记忆，下次先查再修（Memory）→ 通过则提 PR @你 review，未通过则降级标 "need human" 并停。**整个过程你睡觉，醒来看 PR 列表。**

好处是什么

Loop Engineering的好处：

**产能解耦于人在线时间**：一个人 + 多条循环 = 团队级产能，夜间 / 周末 / 多任务并行不再是奢侈。

**质量自带闭环**：循环里强制带验证步骤（测试、lint、eval、人审 gate），比一次性 prompt 出来的代码靠谱得多，因为"没通过就再来一轮"是写在结构里的。

**可观测、可回放、可改进**：循环跑完留 trace、留 eval 数据，OpenAI Cookbook 里那套 "Traces + Evals + Codex 三件套自我改进"就是 Loop Engineering 的官方教程实例——下一轮循环用上一轮的失败数据再训练 / 再调 prompt，**循环本身也在被循环优化**。

**组织化沉淀**：Skills、Sub-agents、记忆库都是可复用资产，越用越值钱，不像 prompt 那样一次性消耗。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a336432d31fed0001a3c003
