---
title: "✅通过 minScore 解决召回准确率低的问题"
---

# ✅通过 minScore 解决召回准确率低的问题

现象

部分 Query 即便经过查询改写、混合检索（KNN + 全文）、BGE-RERANKER 重排序，仍会把语义相关度极低的分片喂给 LLM。不仅可能出现错误回答，还会导致召回准确率降低。

比如我们在测试的时候发现，经过重排序后有分数小于0的上下文也会保留下来。

![](assets/fc286c5acc21.png)

原因是因为我们只设置了maxResult，这使得`KnowEngineReRankingContentAggregator` 默认仅按 `maxResults` 截断，不会按分数过滤。

```text
KnowEngineReRankingContentAggregator.builder()
        .scoringModel(scoringModel)
        .maxResults(5)
        .querySelector(queryToContents -> queryToContents.keySet().iterator().next())
        .build()
```

也就是说，原方案li里 Reranker 的精排能力**只用了一半**：知道哪些分片更相关，但不知道哪些分片"已经差到不该用"。

修复方案

在 `KnowEngineReRankingContentAggregator` 构建时，显式传入 `minScore(0.6)` —— 这里的 `minScore` 作用于 **BGE-RERANKER 的输出分数**，是真正的语义相关度：

```java

ContentAggregator contentAggregator = new ProgressAwareContentAggregator(
        KnowEngineReRankingContentAggregator.builder()
                .scoringModel(scoringModel)
                .maxResults(5)
                .minScore(0.6)  // 关键：精排阈值
                .querySelector(queryToContents -> queryToContents.keySet().iterator().next())
                .build(),
        processCallback, chatParam.assistantMessageId(), chatMessageService
);
```

阈值选取依据

BGE-RERANKER-v2-m3 在 RAG 场景下的分数语义大致如下（经过 sigmoid 归一化）：

| Rerank 分数区间 | 语义相关度 | 是否纳入上下文 |
| --- | --- | --- |
| 0.8 | 强相关，几乎可直接当作答案出处 | ✅ |
| 0.6 ~ 0.8 | 相关，包含可用信息 | ✅ |
| 0.4 ~ 0.6 | 弱相关，可能噪声 | ❌ |
| &lt; 0.4 | 几乎无关 | ❌ |

`minScore = 0.6` 是经验值，对应 "至少包含可用信息" 这条线，既能滤掉绝大部分噪声，又不会过度截断（实测命中率仍能维持 maxResults 上限附近）。后续可基于业务侧 BadCase 反馈做动态调整。

与 ES `minScore` 的协同

做了以上优化后，我们最终形成"两道阈值"的过滤管道：

```text

原始数据
   ↓
[ES KNN minScore=0.5]   粗筛：剔除向量空间明显不相关的分片
   ↓
[ES 全文检索 + 混合]      召回：保证召回率
   ↓
[BGE-RERANKER 精排]      精排：基于 cross-encoder 语义打分
   ↓
[Aggregator minScore=0.6]  精筛：基于精排分数过滤低相关度
   ↓
[maxResults=5]           截断：控制 LLM 上下文长度
   ↓
进入 LLM 生成
```

这是典型的 **粗筛 → 精排 → 精筛** 三段式漏斗：

- 粗筛（ES）追求召回率，阈值松；
- 精排（Reranker）追求排序质量；
- 精筛（Aggregator minScore）追求最终上下文质量，阈值严。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a1f02aac71a89000141750c
