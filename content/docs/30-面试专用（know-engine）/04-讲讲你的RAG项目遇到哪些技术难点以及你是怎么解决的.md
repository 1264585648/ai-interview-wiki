---
title: "✅讲讲你的RAG项目遇到哪些技术难点，以及你是怎么解决的?"
---

# ✅讲讲你的RAG项目遇到哪些技术难点，以及你是怎么解决的?

（这部分的难点，可以等面试官主动问，但是建议把他们提前写到简历上，等着面试官）

分块语义被截断的问题

最开始我们用固定长度切分文档，但很快发现汽车知识库里大量内容是按 Markdown 标题层级组织的（比如「车型 → 配置 → 保养手册」），机械切分经常把一段完整的语义切碎，检索到的 chunk 上下文不完整，LLM 生成的回答就会丢信息。

为了解决这个问题，我自己实现了一个 MarkdownHeaderParentTextSplitter，按 Markdown 标题层级做语义切分，同时维护一个 header stack 来跟踪当前的标题层级。

更关键的是引入了**父子分块机制**：当某个 chunk 超过设定大小时，不是简单丢弃，而是保留完整的父块（标记 skipEmbedding=1，只存数据库不入库），然后对父块做二次切分生成子块，子块通过 PARENT_CHUNK_ID 关联回父块。检索的时候，命中了子块后会自动回溯找到父块的完整文本替换上来。同时还设计了 BROTHER_CHUNK_ID 来关联同一父块下的兄弟块，检索时一并召回，保证上下文的连贯性。

多源异构数据的路由与融合

我们的数据源不只有知识库文档，还有关系型数据库里的车辆结构化数据（订单、保险信息等），以及 Neo4j 图数据库里的实体关系（品牌→车型→版本→配件）。难点在于：用户的一句话可能查知识库、也可能查数据库，甚至同时需要两个来源。

我设计了一个 LLM 驱动的 **Query Router**，让大模型根据用户意图判断该路由到哪个数据源（relational_db、graph_db、knowledge_base），返回带有 confidence 和 reasoning 的路由决策。路由失败时，降级为全量检索。

路由解决了"去哪查"的问题，更难的是"结果怎么合"。

SQL 和 Cypher 返回的是精确的结构化数据，不适合跟向量检索的模糊结果一起走 RRF 融合 + Rerank，否则会被错误降权。所以我设计了一个 HybridContentAggregator：对结构化结果标记 skipRerank，直接透传；非结构化结果走完整的 RRF 融合（k=60）+ BGE-Reranker 精排。最终输出时结构化结果排在前面，非结构化结果紧随其后。这样既保留了结构化查询的精确性，又利用了语义检索的召回能力。

Rerank 模型的延迟与可靠性

Rerank 对 RAG 效果提升很大，但如果调用远程 API，额外增加的网络延迟在生产环境不可接受。并且还需要产生费用。

我们选择了 BGE-Reranker-v2-m3 的 ONNX 本地推理方案，直接在 Java 进程内加载 ONNX 模型做打分，零网络开销。具体实现上用单例 + 双重检查锁 + volatile 保证线程安全，并通过 @PostConstruct 在 Spring 容器启动时预加载模型，避免第一次请求的冷启动延迟。模型的最大序列长度设到 8192，可以覆盖较长的文档片段。

查询改写中的领域适配

通用的 query rewriting 效果在汽车场景下并不好。比如用户说"毛豆3保养多少钱"，"毛豆3"是 Model 3 的口语说法，普通改写处理不了；再比如用户连续对话中说"它多少钱"，需要结合历史才能知道"它"指哪款车。

我在 Query Transformer 里设计了 5 种改写策略并行工作：精简改写（去掉语气词）、抽象概念改写（把具体故障描述泛化为检索友好的查询）、拼写纠错、车型名称标准化（"毛豆3"→"Tesla Model 3"）、以及基于对话历史的上下文补全。整个改写 prompt 内置了 7 个 few-shot 示例，覆盖了各种典型场景。改写结果通过 Java 21 的虚拟线程异步写回数据库，不阻塞主流程。

文档处理管线的最终一致性

文档上传后需要经过"转换 → 切块 → 向量化"三个步骤，任何一个步骤失败都会导致知识无法检索到。一开始我们用同步调用，一旦向量化接口超时，前面的切块就白做了。

后来改成了 Spring 事件驱动 + 定时补偿的架构：每个步骤完成后发布 Spring Event，下一步通过 @TransactionalEventListener(AFTER_COMMIT) 监听，确保上一步事务提交后才执行。同时用 XxlJob 框架设了两个补偿任务——一个扫描卡在 CHUNKED 状态未向量化的文档重试 embedding，另一个清理旧版本的残留数据。再加上基于 Redis 的分布式锁（@DistributeLock）防止并发处理同一文档，以及 SHA-256 内容哈希做跨版本去重，整体保证了文档处理的最终一致性。

**PDF 处理的难度问题**

PDF 处理是我觉得工程上最脏的一块。核心难点不在文本提取本身，而在于**怎么把 PDF 里的视觉信息也变成可检索的知识**。

因为涉及到PDF的页头页尾、水印、图片、表格等问题，还有就是遇到扫描件等问题也不好处理。

我们的方案是**调用外部 MinerU 服务做 PDF 解析**，但我没有用简单的"返回纯 Markdown"模式，而是走了 ZIP 模式——MinerU 返回一个包含 Markdown 和所有提取出来的图片的 ZIP 包。拿到 ZIP 后要做一连串后处理：

首先是图片路径替换。Markdown 里的图片引用还是本地路径，比如 `[图片: images/chart_001.png]`，我需要把每张图片上传到 MinIO 对象存储，然后用正则 !\[(.*?)\]\(([^)]+)\) 匹配所有图片标签，把本地路径替换成 MinIO 的 URL。这里有个细节，替换的时候要用 Matcher.quoteReplacement() 防止 URL 里的特殊字符破坏正则。

更关键的一步是**让图片内容可被检索**。PDF 里经常有表格截图、流程图、仪表盘截图，这些内容纯文本提取完全拿不到。我对每张图片调用 qwen3-vl-plus 多模态模型生成文字描述，prompt 要求它描述场景、物体、布局、颜色、文字信息，输出纯文本。然后把生成的描述回填到 Markdown 的 alt text 里，变成 `[图片占位: 这张图是一个xxx]`。这样下游的切块和向量化就能把图片内容当作文本知识来处理了。

另外还有几个工程上的坑：中文文件名上传会导致编码乱码，我用 docTitle + docTitle.hashCode() 拼接来规避；大 PDF 解析耗时长，用 Apache HttpClient 5 替换了原来的 HttpURLConnection，配置了 30 秒连接超时和 5 分钟响应超时；ZIP 解压时做了路径穿越防护，用 entryPath.normalize().startsWith(extractPath.normalize()) 过滤恶意路径；临时文件的清理放到 Java 21 虚拟线程里异步执行，不阻塞主流程。

MinerU不支持多级标题解析

**LangChain4j 的 RRF 默认不去重排序**

这个问题排查花了挺长时间。RRF（Reciprocal Rank Fusion）的原理很简单：同一文档在多个检索列表中出现，按 1/(k+rank) 累加分数，最后按总分排序。理论上，被多个检索源同时命中的文档应该排到更前面。

但实际跑的时候发现，**同一篇文档在向量检索和全文检索里都被召回了，结果列表里却出现了两次，分数也没有合并。** 这意味着 RRF 的融合根本没生效。

我追进 LangChain4j 的源码，找到了根因：ReciprocalRankFuser 用一个 Map&lt;Content, Double&gt; 来累加分数，而 DefaultContent.equals() 委托给了 TextSegment.equals()，后者比较的是 **text + metadata**。问题是，同一篇文档从向量检索和全文检索回来时，metadata 里的 score 值和 embeddingId 是不同的——向量检索返回的是余弦相似度，全文检索返回的是 BM25 分数。这导致 equals() 返回 false，Map 把它们当成两个不同的 key，分数各自累加，永远不会融合。

**我的修复方案是自定义了 ****KnowEngineDefaultContent****，重写 ****equals()**** 和 ****hashCode()****，只比较 metadata 里的 ****EMBEDDING_ID**** 字段。** 这个 ID 是文档在 Elasticsearch 中的唯一标识，不管从哪个检索通道回来，同一篇文档的 ID 是一样的。然后自定义了 KnowEngineReciprocalRankFuser，接收 List&lt;KnowEngineDefaultContent&gt; 而不是 List&lt;Content&gt;。RRF 算法本身没改，改的是参与融合的对象的等价性判断。

在此基础上，我的 KnowEngineReRankingContentAggregator 做了两级融合：第一级用 LangChain4j 原生的 RRF 做同一个 query 下多路检索结果的融合；第二级用自定义的 KnowEngineReciprocalRankFuser 做跨 query 的融合（因为 Query Transformer 可能产生多个改写 query）。两级融合后再走 BGE-Reranker 精排、minScore 过滤、maxResults 截断。

**LangChain4j 的 ES 全文检索不支持过滤**

这个是个安全隐患。我们的系统有角色权限控制：VISITOR 只能看公开内容，OWNER 能看自己的文档，CUSTOMER_SERVICE 能看全部。每个 chunk 的 metadata 里存了 accessibleBy 字段，检索时通过 LangChain4j 的 Filter API 构建权限过滤条件。

向量检索（KNN）模式下，LangChain4j 的 ElasticsearchEmbeddingStore.search() 是支持 filter 参数的，filter 会被翻译成 ES 的 KNN filter，没问题。但切到全文检索模式时，我发现 **LangChain4j 默认的 ****fullTextSearch()**** 方法直接构建了一个简单的 ****match**** 查询，完全忽略了 filter 参数。** 这意味着全文检索会返回用户无权访问的文档，是个权限穿透漏洞。

我在 KnowEngineElasticsearchContentRetriever 里自己实现了 doFullTextQuery() 方法，用 ES 原生 Java Client API 手动构建查询。核心是一个 bool 查询：must 里放 match 查询做文本匹配，filter 里放 terms 查询做权限过滤。

这里有个技术细节是 **怎么把 LangChain4j 的 Filter 树转换成 ES 的 terms 查询**。LangChain4j 的 Filter 是一个树结构，权限过滤通常表达为 Or(IsEqualTo("VISITOR"), IsEqualTo("OWNER")) 这种形式。我写了一个递归方法 extractFilterValues()，遍历这棵 Filter 树，遇到 IsEqualTo 节点就取出 comparisonValue()，遇到 Or 节点就递归左右子树，最终收集到所有的权限值字符串，传给 ES 的 terms 查询。

这样就实现了全文检索模式下的权限过滤，和向量检索模式下的行为保持一致。

专有名词相关问题回答的不好

**核心问题：****向量检索依赖语义相似度，对专有名词、精确短语、编号等缺乏精确匹配能力；且在面对极短查询时，因语义上下文有限，容易导致召回内容过于宽泛。**

比如我们课程讲的内容中，针对『超级桌面』这个内容的检索。超级桌面本身就是一个汽车领域的专有名词，而和他相似的词有很多，比如典型的3D桌面，手机桌面，车机桌面，桌面。

单纯靠向量检索的话，包含这些关键词的文档得分都挺高的。使得检索效果差。比如这个case：

为了解决这个问题，我们引入了关键词检索，基于BM25做精确匹配，这样针对一些特定的专业术语，就能有很好的召回效果。

**意图识别不准确**

意图识别是整条 RAG 链路的第一个环节，如果识别错了，后面的检索和生成全白搭。我们定义了 7 种意图：售前咨询、售后维修保养、车辆使用与技术指导、投诉与维权、汽车营销政策、闲聊通用问答、其他。

最早版本的 prompt 很简单，大概 55 行，就是一个平铺的指令列表加意图定义，没有 CoT、没有 few-shot、没有消歧规则。效果不太好，主要翻车在几类容易混淆的场景上。

我重点分析了几个高频混淆对，然后在新 prompt 里针对性地加了消歧规则：

**"怎么换雨刮"vs"雨刮坏了去你们店换一下多少钱"**——前者是用户想自己动手（技术指导），后者是要进店服务（售后维修）。区分关键是用户的**行为意图**：DIY 还是进店。

**"屏幕黑屏了怎么办"vs"新车就黑屏了，太坑了"**——前者是求助（技术指导），后者是发泄不满（投诉）。区分关键是**情绪强度**，不是问题本身。

**"我想买辆 SUV"vs"能不能便宜点"**——前者是购买意向（售前），后者是价格谈判（营销政策）。区分关键是用户在生命周期中的位置。

新 prompt 做了几个结构性改进：一是引入了 5 步流水线（相关性判断 → CoT 推理 → 意图分类 → 实体抽取 → JSON 输出），让 LLM 按步骤思考而不是直接跳到结论；二是在 CoT 环节设计了 4 步推理框架（关键词检测 → 生命周期定位 → 消歧分析 → 实体扫描）；三是加了 5 个 few-shot 示例，覆盖 DIY 教程、带订单号的投诉、进店维修、非汽车话题、技术原理等典型场景；四是在输出里加了 reasoning 字段，方便排查错误 case。

工程上也做了配套设计。意图识别用的是一个带会话记忆的 AiService，保留了最近 10 条消息的上下文，这样"它多少钱"这种指代性的追问能正确识别意图。识别完之后，**主动调用 ****evictCache()**** 清除 Redis 里的会话缓存**，防止意图识别阶段 LLM 的回复（比如"我判断这是一个售前问题"）污染到后续 RAG 对话的上下文。

评测时遇到的问题

1、召回率低

2、上下文准确率低

3、答案正确率低

4、忠诚度低

详见：[../23-RAG评测（即将完结）/15-✅know-engine评测问题与优化（bad case）.md?spm=a2cl9.thoughts_devops2020_goldlog_.0.0.191a13e2Uclr35](../23-RAG评测（即将完结）/15-✅know-engine评测问题与优化（bad case）.md?spm=a2cl9.thoughts_devops2020_goldlog_.0.0.191a13e2Uclr35)

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a46627c74e4030001d182ce
