---
title: "✅如何构建LLM Wiki？"
---

# ✅如何构建LLM Wiki？

**Obsidian就是我们后端开发的IDEA，开发工具到位了之后，我们就开始指挥程序员（LLM）构建自己的代码仓（Wiki）。**

但是你要知道的是，如果没有指导过的 LLM，让它整理知识，它根本不知道规范。这个 wiki 是关于什么的？文件叫什么名字？写完放哪个目录？两份资料说法打架了信谁的？这些都得你告诉它。这份规范就是 `CLAUDE.md`，是整个 LLM Wiki 的核心。

搭一个能跑的 LLM Wiki，三步走：

1. **先建目录骨架**：把 raw/ 和 wiki/ 及其子目录搭出来
2. **写 CLAUDE.md**：立规矩，告诉 LLM 这个 wiki 关于什么、页面怎么组织、原则是什么
3. **配 commands**：定义 ingest / query / lint / save 四个动作

建立文件夹目录

为什么第一步是建目录，而不是先写 CLAUDE.md？因为 CLAUDE.md 里要写清楚source 页放哪、concept 页放哪，目录先存在，规矩才能写得具体。

在 Obsidian 的 vault 根目录下，按这个结构建：

```text
vault/
  raw/
    articles/      # 文本类资料：博客、论文、文档、Web Clipper 抓取的文章
    videos/        # 视频、播客转出来的文字稿
    assets/        # 图片、附件、截图
  wiki/
    sources/       # source 摘要页
    entities/      # 实体页
    concepts/      # 概念页
    synthesis/     # 综合分析页
    outputs/       # 问答归档页
```

raw/ 下按资料类型分（articles / videos / assets），wiki/ 下按页面类型分（sources / entities / concepts / synthesis / outputs）。这个地方注意不一定需要完全和我的分法一致，请根据自己的业务场景和需求来。

**一般两种方式**：

**手动建**：在 Obsidian 左侧文件树里右键新建文件夹，照着上面一层层建就行。结构清晰，CLAUDE.md 里能直接指明每种子页面去哪个目录。

![](assets/e79c57c33633.png)

**交给 Claude Code 建**：嫌麻烦的话，丢一段提示词给它：

```text
帮我在 vault 根目录下建立 LLM Wiki 的目录结构：
- raw/articles/、raw/videos/、raw/assets/
- wiki/sources/、wiki/entities/、wiki/concepts/、wiki/synthesis/、wiki/outputs/
每个目录建好即可，不需要往里面放文件。
```

注意，这里只建**空的目录骨架**。里面的文件（wiki/index.md、wiki/log.md、各种页面）现在都不用建，等第一次 ingest 的时候 LLM 会自己创建。先把架子搭好就行。

写 CLAUDE.md（Schema）

为什么 CLAUDE.md 是核心

Karpathy 在原文里说得很直接，schema 的作用是让 LLM 变成一个守规矩的 wiki 维护者，而不是一个普通聊天机器人。

`"This is the key configuration file — it's what makes the LLM a disciplined wiki maintainer rather than a generic chatbot."`

没有 CLAUDE.md，LLM 写出来的东西很快就会退化成乱七八糟的笔记堆，因为它不知道怎么写、写到哪、写成什么样。

还有一点 Karpathy 特别强调：schema 不是一次定死的。你和 LLM 会随着使用慢慢把它打磨出来，他管这叫 co-evolve（共同演化）。刚开始可以很简短，用着用着再补约定，需要不断去完善。

CLAUDE.md 主要内容

一份能用的 CLAUDE.md，至少要讲清楚下面几件事。

核心定位：这个 wiki 是关于什么的

告诉 LLM 两件事：**知识库的主题和边界**，以及 **LLM 自己的角色**。

主题决定了 LLM 怎么归类、怎么取舍。是个人技术笔记？网络安全攻防？法律知识？边界越清楚，LLM 越不会跑偏。

角色这条很关键。Karpathy 原文专门讲了分工：你负责筛选来源、提出问题、判断方向；LLM 负责摘要、交叉引用、记账、一致性维护。CLAUDE.md 里要写明白，LLM 是 wiki 维护者，不是聊天机器人，这样它才会主动去维护交叉引用、更新索引，而不是答完就完事。

三层架构和目录结构

把我们之前讲的三层架构写成 LLM 能读的指令，**附上完整的目录树**。

三层各自的权限要写清楚：

- **raw/ 完全不可变**：LLM 只读，永不修改。
- **wiki/ 由 LLM 完全拥有**：创建、更新、重构页面都由 LLM 来做
- **CLAUDE.md（schema）由人和 LLM 共同演进**

为什么权限要这么严格？因为 raw 是事实来源，是真相之源。一旦允许改 raw，就分不清"原文说了什么"和"LLM 理解成了什么"，整个 wiki 的可信度就崩了。

还有一个容易踩的坑：哪些 raw 已经被 ingest 过，这件事由 `wiki/log.md` 追踪，**不在 raw 层面做任何标记**。

其实一些开源的LLM Wiki项目也有一些比较巧妙的方式，比如新建一个待处理的文件夹和已处理的文件夹，把原始文档放在待处理文件夹，LLM处理完之后挪动到已处理文件夹中去，这种方式也是可以的。

![](assets/162b9a82bd08.png)

页面类型

wiki 里有 source、entity、concept、synthesis、output 这几种页面，每种管什么、长什么样，得在 CLAUDE.md 里定义清楚。常见的分法：

| 类型 | 目录 | 角色 | 何时创建 |
| --- | --- | --- | --- |
| **source** | `wiki/sources/` | 证据节点，一个来源对应一页 | 每次 ingest 一个 raw 文件 |
| **entity** | `wiki/entities/` | 知识节点：框架、工具、组织、人物 | 当某实体在 2+ 来源中出现 |
| **concept** | `wiki/concepts/` | 知识节点：方法、模式、术语 | 当某概念在 2+ 来源中出现 |
| **synthesis** | `wiki/synthesis/` | 高阶判断：跨源比较、阶段性结论 | 当查询/分析综合了多个来源 |
| **output** | `wiki/outputs/` | 有价值的问答归档 | 当查询答案有长期保存价值 |

核心原则

**raw 不可变**：LLM 只读 raw/，绝不修改原始资料。具体禁什么（不改 body、不改 frontmatter、不移动、不改名、不删除）要一条条列出来，免得 LLM 自作主张。ingest 状态由 log.md 追踪，不在 raw 上做标记。

**双链要求**：页面之间必须用 `[[]]` 互链，这是关系图谱的基础。而且要双份维护：正文里写行内 `wiki link`（给人看、给 Graph View 看），frontmatter 里也要填 `sources`、`related`、`supports`、`contradicts` 字段（给 Dataview 查询用）。两边都不能偷懒。**命名规范**：文件名用 kebab-case（全小写，单词之间用连字符 `-` 隔开，如 `llm-wiki.md`）。source 页的文件名可以带作者和年份，比如 `{author}-{year}-{short-title}.md`。中文标题不要塞进文件名，放在 frontmatter 的 `title` 字段里。这么干的好处：URL 友好，grep 方便。

**冲突处理**：两份资料对同一件事说法不同时，**永远不要静默抹平矛盾**。用 Obsidian 的 callout 语法把冲突标出来：

```text
> [!contradiction] 来源A vs 来源B
> [[sources/a]] 声称 X，但 [[sources/b]] 声称 Y。
> 当前状态：未解决 / 已解决（说明理由）
```

把双方观点、当前状态、判断理由都写清楚。这一条是 LLM Wiki 区别于普通笔记的关键，它逼着你面对分歧，而不是假装没有。

操作流程

ingest / query / lint / save 各自做什么、按什么步骤做、做完怎么验证。CLAUDE.md 里写一版概要就行，详细的可以放到 commands 里。

这里有个原则：每个操作完成后，**index.md 和 log.md 必须同步更新**，这是验证是否做完的指标。没更新 index 和 log，等于没做。

index.md 和 log.md 的规范

**index.md 是内容索引**。按页面类型分节，每条 = 链接 + tldr（一句话摘要）。LLM 每次 ingest 后更新。query 的时候，LLM 第一步就是读 index，靠 tldr 快速判断哪些页面相关，所以 tldr 写得好不好，直接决定检索效率。可以把它当成 wiki 的承重字段。

**log.md 是时间线**。append-only（只追加不修改），每条格式统一：`## [YYYY-MM-DD] op | title`。这个格式的好处是可以 grep，`grep "^## \[" log.md | tail -5` 一行命令就能看最近 5 条操作。log 还有一个重要用途：**追踪哪些 raw 已经被 ingest**，避免重复处理。

Claude Code 自动生成

CLAUDE.md 内容不少，但你其实完全不用自己写。把 Karpathy 原文和你的需求丢给 Claude Code，让它生成一版，你再基于它给的基础上慢慢调整。

**参考提示词**（直接粘进 Claudian 对话框，方括号里换成你自己的主题）：

```text
请参考 raw/articles/llm-wiki.md（Karpathy 的 LLM Wiki 原文），帮我生成一份 CLAUDE.md，放在 vault 根目录，用于指导 LLM 构建和维护这个 wiki。

要求覆盖以下内容：
1. 核心定位：这个 wiki 是关于 [你的主题，比如"网络安全领域的攻防知识"] 的
2. 三层架构：raw/（只读原始资料）、wiki/（LLM 编写的知识）、schema（本文件）
3. 目录结构：wiki/ 下分 sources/ entities/ concepts/ synthesis/ outputs/，附目录树
4. 页面类型：source / entity / concept / synthesis / output 各自的字段和模板
5. 核心原则：raw 不可变、双链要求、kebab-case 命名、冲突标注（标注分歧 + 双方观点）
6. 操作流程：ingest / query / lint / save 的步骤
7. index.md 和 log.md 的格式约定（log.md 要可 grep）

立足于 Karpathy 原文的理论，但结合我的实际主题调整。
```

生成后放 vault 根目录就行。Claude Code 启动时会自动加载它当系统提示词的一部分。

![](assets/a9341db91212.png)

![](assets/54c0d794fadf.png)

这样你的 CLAUDE.md 就有了一个初版。但也别指望一次写好，这是个长期维护、不断调整的过程，用着用着你会不断往里补约定。

设置 commands

Claude Code 的 commands 机制

Claude Code 支持自定义 slash 命令：在 `.claude/commands/` 目录下放一个 `.md` 文件，**文件名就是命令名**。比如 `ingest.md` 对应 `/ingest`，`query.md` 对应 `/query`。在对话框里敲 `/ingest`，就等于执行这个文件里的指令。

每个 command 文件就是一个 prompt，告诉 LLM 执行这个命令时该做什么、按什么步骤做。本质上是把反复要说的话固化成一个快捷指令，免得每次都手动描述一遍流程。

命令文件可以放在两个位置：

- `.claude/commands/`：**项目级**，跟着项目走，可以随 git 共享给团队
- `~/.claude/commands/`：**用户级**，登录用户的所有项目都能用

LLM Wiki 的命令一般放项目级，跟着 vault 走。

一个 command 文件的最小结构：

```text
---
description: "一句话说明这个命令干什么"
---

# 命令名

执行 XX 操作。

## 步骤
1. 第一步...
2. 第二步...
```

开头的 frontmatter 里写个 `description`，Claude Code 会在命令补全时展示这句话，方便你记起这个命令是干嘛的。

ingest：把资料编译进 wiki

ingest 是 LLM Wiki 增长的唯一入口。你把一份新资料丢进 raw/，LLM 读完，提炼成结构化的 wiki 页面，并和已有的知识网接上。没有 ingest，wiki 就一直是空的。

Karpathy 在原文里是这么描述的：

`"the LLM reads the source, discusses key takeaways with you, writes a summary page in the wiki, updates the index, updates relevant entity and concept pages across the wiki, and appends an entry to the log. A single source might touch 10-15 wiki pages."`

意思是 ingest 不是简单存个档。LLM 要做一整串事：读全文 → 跟你确认重点 → 写一篇 source 摘要页 → 把里面的实体/概念拆成独立页面（或更新已有的）→ 维护交叉引用 → 更新 index.md → 在 log.md 记一笔。Karpathy 说一份资料可能牵动 10 到 15 个页面，因为新知识得和旧知识接上网，不是丢进去就完事。

对应到步骤：

1. 查阅 log.md，确认哪些 raw 还没被处理过
2. 完整读 raw 文件
3. 跟你讨论关键发现，确认重点方向
4. 在 wiki/sources/ 写一篇 source 摘要页（200-500 字）
5. 把里面出现的实体/概念拆成 entity / concept 页（2+ 来源建完整页，首次出现建 stub）
6. 维护交叉引用，更新相关页面的 sources / related 字段
7. 更新 index.md，追加新页面条目
8. 在 log.md 追加一条 ingest 记录

这个命令的完整定义可以是这样（同样可以让 Claude Code 帮你生成）：

````text
---
description: "处理 raw/ 中的新来源，编译为 wiki 页面"
---

# Ingest 操作

处理 `raw/` 中的新来源，将其编译为结构化的 wiki 页面。

## 执行步骤

1. **查阅 `wiki/log.md`**：确认哪些 raw 文件尚未被 ingest（log 中有 ingest 记录的跳过）
2. **扫描 `raw/` 各子目录**：`articles/`、`videos/` 中查找待处理文件
3. **确定 ingest unit**：
   - 用户明确指定的文件
   - 同一主题的相关文件作为一组
   - 默认：单个文件为一个 unit（推荐 batch size 1-5）
4. **完整阅读来源**：读取 raw 文件全文
5. **与用户讨论**：分享关键发现，确认重点方向，询问用户想强调什么
6. **创建 source 页**（`wiki/sources/`）：
   - 使用 source 模板
   - 填写 frontmatter（含 `raw_note`、`external_url`）
   - 核心摘要 200-500 字
   - 列出可抽取实体和概念（带 `[[]]` 链接）
   - 标注与现有 wiki 的连接
7. **创建/更新 entity 页**（`wiki/entities/`）：
   - 实体在 2+ 来源中出现 → 完整页面
   - 首次出现 → stub 页面
8. **创建/更新 concept 页**（`wiki/concepts/`）：
   - 概念在 2+ 来源中出现 → 完整页面
   - 首次出现 → stub 页面
9. **维护交叉引用**：
   - 更新所有相关页面的 `sources`、`related` 字段
   - 确保无 dangling wikilink
10. **更新 `wiki/index.md`**：添加新页面条目（链接 + tldr）
11. **追加 `wiki/log.md`**：
    ```
    ## [YYYY-MM-DD] ingest | 标题
    - 处理详情
    - raw 文件：filename.md
    ```

## 质量检查

完成前自检：
- [ ] 所有新页面包含完整 frontmatter（含 tldr）
- [ ] 所有 `[[]]` 链接指向已存在的页面（无 dangling）
- [ ] source 页面包含反方观点/数据缺口（如适用）
- [ ] index.md 和 log.md 已更新
- [ ] **raw 文件未被修改**（不移动、不改名、不改内容）

## 重要约束

- raw 文件**完全不可变**，不修改、不移动、不重命名
- 处理状态由 `wiki/log.md` 的 ingest 记录追踪，不在 raw 层面做任何标记
- raw 文件按类型存放：`articles/`、`videos/`、`assets/`。新建 source 页面时 `raw_note` 字段需包含完整子目录路径（如 `[[raw/articles/filename]]`）
````

query：基于 wiki 回答问题

query 是基于已经编译好的 wiki 回答你的问题。注意，**不是从 raw 重新检索**，而是从 LLM 整理好的 wiki 里读。这就是 LLM Wiki 和 RAG 的根本区别：RAG 每次从原始文档临时拼凑答案，query 是从已经结构化的知识里综合。

Karpathy 原文：

`"The LLM searches for relevant pages, reads them, and synthesizes an answer with citations."`

步骤是：先读 index.md，通过每条 tldr 快速判断哪些页面相关 → 拉取这些页面的完整内容 → 综合出答案，每个关键论断带上 `[[]]` 引用，标出置信度 → 如果 wiki 信息不够，再回溯读相关 source 页的原始资料。

这里有个 Karpathy 点出的关键洞察：**好的答案值得回填进 wiki**。你做的一次比较、一个分析、发现的一个联系，不该消失在聊天记录里。这就是下面 save 命令的由来。

完整定义：

```text
---
description: "基于 wiki 内容回答问题，附带引用"
---

# Query 操作

基于已有的 wiki 内容回答用户的问题。优先从编译好的 wiki 综合答案，而非从 raw 重新检索。

## 执行步骤

1. **读取 `index.md`**：通过 tldr 快速扫描所有页面，定位与问题相关的页面
2. **拉取相关页面**：读取相关 wiki 页面的完整内容
3. **检查是否需要回溯 raw**：
   - 如果 wiki 信息不足以回答，查看相关 source 页面的 `raw_note`，回溯阅读原始资料
   - 如果 wiki 中存在矛盾标注，需要展示双方观点
4. **综合回答**：
   - 每个关键论断**必须引用 `[[]]` 页面**作为出处
   - 标注置信度（high/medium/low）
   - 如果存在矛盾，明确展示
5. **建议归档**：
   - 如果这个问答有长期价值，建议用户用 `/save` 归档
   - 如果发现 wiki 中缺少某个应该有页面的概念/实体，建议下次 ingest 时补充

## 注意事项

- **永远优先从 wiki 回答**，而不是从 raw 重新检索
- 如果 wiki 完全没有覆盖这个问题，明确告知用户，建议添加相关来源
- 如果 wiki 信息过时（explored: false 且 date_modified 较久），提醒用户可能需要更新
```

lint：给 wiki 巡检

wiki 长时间会积累各种毛病：两份资料矛盾但没标注、链接断了指向不存在的页面、某个页面没有任何入链成了孤儿、新资料推翻了旧结论但旧页面没更新。lint 就是定期让 LLM 给整个 wiki 做一次健康检查，出一份报告。

Karpathy 原文列了一份检查清单：

`"Look for: contradictions between pages, stale claims that newer sources have superseded, orphan pages with no inbound links, important concepts mentioned but lacking their own page, missing cross-references, data gaps that could be filled with a web search."`

翻译过来就是六类问题：

- **矛盾**：两份资料对同一件事说法不同，得标注出来
- **过时**：新资料推翻了旧结论，旧的还没更新
- **孤儿页**：没有任何页面链接到它（index/log 除外）
- **缺失页面**：被多次提到但没有独立页面的概念
- **断链**：`[[]]` 指向的页面不存在
- **信息缺口**：哪里缺数据，可以补一份新资料

lint 会生成一份报告，告诉你哪里要补、哪里要改。低风险的问题（比如 index 漏了条目）可以自动修，高风险的（比如矛盾标注、内容过时）只报告不动手，留给你判断。Karpathy 还说 LLM 擅长建议新问题和新资料，这正好是 raw/ 下一批素材的来源。

完整定义：

```text
---
description: "wiki 健康检查：查找孤儿页、悬空链接、缺失字段等问题"
---

# Lint 操作

对整个 wiki 执行健康检查，发现问题并生成报告。

## 检查项

### 1. 结构完整性
- [ ] **Dangling wikilinks**：扫描所有 `[[]]` 链接，检查目标页面是否存在
- [ ] **孤儿页面**：没有任何入站链接的页面（index.md、log.md 除外）
- [ ] **index.md 同步**：检查 wiki/ 下所有 .md 文件是否都在 index.md 中列出

### 2. Frontmatter 合规
- [ ] **必填字段**：每个页面是否有 title、tldr、type、status、date_created、date_modified
- [ ] **type 合法**：type 值是否为 source/entity/concept/synthesis/output 之一
- [ ] **explored 门控**：所有页面 explored 是否为 false（AI 不应设置 true）

### 3. 内容质量
- [ ] **矛盾未标注**：检查是否有两个 source 页面提出冲突结论但未用 callout 标注
- [ ] **bias checks 缺失**：concept/synthesis/source 页面是否缺少反方观点/数据缺口
- [ ] **stub 僵局**：status 为 stub 的页面是否长时间未扩充
- [ ] **过时内容**：date_modified 超过 6 个月且 explored: false 的页面

### 4. 队列状态
- [ ] **pending_review 堆积**：长时间处于 pending_review 状态的 raw 文件
- [ ] **raw/index.md 准确性**：文件实际位置与 index.md 记录是否一致

## 输出

1. 生成报告到 `wiki/lint-report-YYYY-MM-DD.md`
2. **低风险问题自动修复**：index.md 缺失条目、简单 typo 等
3. **高风险问题仅报告**：矛盾标注、内容过时等需要用户判断
4. 追加 `wiki/log.md`：`## [YYYY-MM-DD] lint | 检查结果摘要`
```

save：沉淀优质的回答

save 不是 Karpathy 原文里的独立操作，是从 query 派生出来的。Karpathy 说：

`"good answers can be filed back into the wiki as new pages"`

意思是好的答案该回填成 wiki 页面。你做的一次跨源比较、一个有深度的问答，如果就让它在聊天记录里躺着，下次还得重新问一遍，太浪费。save 就是把这些有价值的内容归档进 wiki。

具体怎么做：先判断这次内容是**跨源综合**（→ synthesis/）还是**单次问答**（→ outputs/），用对应模板写成结构化的 wiki 页面（不是把聊天记录原样复制），更新交叉引用和 index/log。让一次性的探索变成持久的知识。

完整定义：

```text
---
description: "将对话中有价值的内容归档到 wiki"
---

# Save 操作

将当前对话中有价值的内容（问答、分析、发现）归档到 wiki，使其成为持久知识。

## 执行步骤

1. **判断类型**：
   - **跨源综合分析**（综合了多个来源的比较、结论）→ `wiki/synthesis/`
   - **有价值问答**（基于 wiki 回答的问题）→ `wiki/outputs/`
2. **确定 slug**：从内容中提炼 kebab-case 文件名
3. **创建页面**：
   - 使用 synthesis 或 output 模板
   - 填写完整 frontmatter（含 tldr、sources、related）
   - 正文整理为结构化的 wiki 内容（不是聊天记录的简单复制）
4. **更新交叉引用**：
   - 在相关页面的 `related` 字段中添加新页面
   - 在 `wiki/index.md` 添加条目
5. **追加 `wiki/log.md`**：`## [YYYY-MM-DD] save | 标题`

## 质量检查

- [ ] 内容已结构化为 wiki 格式（标题、列表、表格），不是原始聊天记录
- [ ] 所有关键论断有 `[[]]` 引用
- [ ] frontmatter 完整（含 tldr）
- [ ] index.md 和 log.md 已更新
```

怎么创建这些命令

两种方式，你可以去`.claude/commands/` 目录下放上面介绍的这几个`.md` 文件，也可以直接丢一段提示词给 Claude Code，让它去帮你生成也可以：

```text
参考 raw/articles/llm-wiki.md 里 Karpathy 对 ingest / query / lint 三个操作的描述，
帮我在 .claude/commands/ 下生成这四个 command 文件（ingest / query / lint / save），
每个文件包含 description 和具体执行步骤。
```

最终你的 `.claude/commands/` 目录下就会多出这几个文件。

![](assets/cf192da30b97.png)

总结

这一节把 LLM Wiki 的架构就搭起来了，主要三个步骤：

1. **建目录**：raw/ 和 wiki/ 及其子目录，把架子搭出来
2. **写 CLAUDE.md**：立规矩，不用手写，让 Claude Code 参考 Karpathy 原文生成
3. **配 commands**：ingest 把资料编译进 wiki，query 基于 wiki 回答问题，lint 给 wiki 体检，save 把有价值的对话沉淀成页面

你可以理解为这个过程有点像我们在IDEA（obsidian）上，新建了一个springboot项目的脚手架（LLM Wiki），接下来我们需要做的就是，在这个脚手架上去开发具体的业务（也就是导入我们的知识库文档，使用ingest等命令来构建）。

Karpathy 原文中的一段话：

`"You and the LLM co-evolve this over time."`

`（你和 LLM 一起，随时间共同演化。）`

CLAUDE.md 和 commands 都不是一次定死的，是用着用着和 LLM 一起调出来的。下一节我们跑一次 ingest， 看下 wiki 是怎么从无到有的。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a40f9fdc71a890001618034
