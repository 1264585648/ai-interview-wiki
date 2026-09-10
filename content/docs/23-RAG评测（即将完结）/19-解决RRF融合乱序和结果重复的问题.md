---
title: "✅解决RRF融合乱序和结果重复的问题"
---

# ✅解决RRF融合乱序和结果重复的问题

`know-engine` 采用多路召回 + RRF（Reciprocal Rank Fusion，倒数排序融合）+ Re-rank 的检索架构：

1. 多个 `ContentRetriever`（向量检索、全文检索、混合检索、SQL 结构化检索）针对同一 Query 各自返回一份 `List<Content>`；

1. 经 `ReciprocalRankFuser.fuse(...)` 按 `score = Σ 1/(k+rank)` 公式融合为统一列表；

1. 再交给 `ScoringModel`（BGE Reranker）做 Cross-Encoder 重排。

直接复用 langchain4j 自带的 `dev.langchain4j.rag.content.aggregator.ReciprocalRankFuser` 与 `ReRankingContentAggregator` 时，出现两个明显异常。

问题表现

1. 结果重复

同一段 chunk（同一 `chunkId`）在最终融合结果中**多次出现**。例如向量检索与全文检索都召回了 `chunkId=abc` 的片段，融合后仍能在结果列表里看到两条几乎相同的文本，挤占了 Top-K 名额。同一个现象，还会导致：

- 在某一路检索中排名靠前的 chunk，其 RRF 分并未被正确累加；
- 多路同一 chunk 被独立计分，最终排序和"加权后真实热度"不一致，靠前的不是真正高频/多路命中的片段。

2. 排序乱序

检索到的结果并没有按照分数倒序排列，实际上是乱序。

根因分析

langchain4j 原版 `ReciprocalRankFuser.fuse` 的核心逻辑：

```java

Map<Content, Double> scores = new LinkedHashMap<>();
for (List<Content> list : listsOfContents) {
    for (int i = 0; i < list.size(); i++) {
        Content content = list.get(i);
        double current = scores.getOrDefault(content, 0.0);
        scores.put(content, current + 1.0 / (k + i + 1));
    }
}
```

其依赖 `Map<Content, Double>` 来累加同一片段在各路召回中的分数。能否累加，取决于 `Content` 实例的 `equals/hashCode`。而 langchain4j 默认实现 `dev.langchain4j.rag.content.DefaultContent`：

- 由各 `Retriever` 在各自的 `retrieve()` 内通过 `Content.from(...)` 新建实例；
- 没有覆写 `equals/hashCode`，沿用 `Object` 的引用相等语义。

于是同一个 `chunkId` 经过两个不同 Retriever，会被构造为**两个不同的 Java 对象，而且在比较textSegment的时候，虽然text一样，但是metadata并不一样，因为不同的检索方式得分肯定有差异。**

所以进一步会导致：

- 在 `Map<Content, Double>` 中被视作两个不同 key；
- 分数无法叠加，每条只拿到自己单路的 `1/(k+rank)`；
- LinkedHashMap 保持插入顺序，但因为重复 key 无法折叠，结果列表既包含重复条目，又因为得分未叠加而**整体顺序失真**——最终在 Top-K 里看起来既"乱"又"重"。

简言之：RRF 算法本身没问题，问题是它隐含的"内容相等性"语义在 langchain4j 的默认实现中是缺失的。

---

解决方案

核心思路：把"内容相等性"显式定义为 `chunkId` 相等，让 RRF 内部的 Map 能正确把多路同一 chunk 折叠到同一个 key 上累加得分。1. 引入 `KnowEngineDefaultContent`继承 `DefaultContent`，仅基于元数据中的 `chunkId` 重写 `equals/hashCode`：

```java

public class KnowEngineDefaultContent extends DefaultContent {

    public KnowEngineDefaultContent(DefaultContent defaultContent) {
        super(defaultContent.textSegment(), defaultContent.metadata());
    }

    @Override
    public int hashCode() {
        return Objects.requireNonNull(
            this.textSegment().metadata().getString(MetadataKeyConstant.CHUNK_ID)
        ).hashCode();
    }

    @Override
    public boolean equals(Object o) {
        return Objects.equals(
            this.textSegment().metadata().getString(MetadataKeyConstant.CHUNK_ID),
            ((KnowEngineDefaultContent) o).textSegment().metadata().getString(MetadataKeyConstant.CHUNK_ID)
        );
    }
}
```

2. 定制 `KnowEngineReciprocalRankFuser`完整复刻 langchain4j 的 RRF 算法，但把入参类型收窄为 `List<KnowEngineDefaultContent>`，从签名上强制调用方先做包装：

```java

public static List<Content> fuse(Collection<List<KnowEngineDefaultContent>> listsOfContents, int k) {
    Map<Content, Double> scores = new LinkedHashMap<>();
    for (List<KnowEngineDefaultContent> single : listsOfContents) {
        for (int i = 0; i < single.size(); i++) {
            Content content = single.get(i);
            double current = scores.getOrDefault(content, 0.0);
            scores.put(content, current + 1.0 / (k + i + 1));
        }
    }
    List<Content> fused = new ArrayList<>(scores.keySet());
    fused.sort(Comparator.comparingDouble(scores::get).reversed());
    return fused;
}
```

由于 Map 的 key 此时使用的是 `KnowEngineDefaultContent`，`equals/hashCode` 已生效，多路同 chunk 会被自动合并，分数叠加，最后按合并后的 RRF 分**一次性降序排序**，乱序与重复同时被消除。

在 `KnowEngineReRankingContentAggregator.aggregate(...)` 中，先用原版 RRF 融合"同一 Query 跨 Retriever"的结果（这一步同 chunk 通常已经天然不重复），再把"跨 Query"的所有列表统一包装成 `KnowEngineDefaultContent` 后调用定制 RRF：

```java

Map<Query, List<Content>> queryToFusedContents = fuse(queryToContents);

List<List<KnowEngineDefaultContent>> wrapped = queryToFusedContents.values().stream()
        .map(contents -> contents.stream()
                .map(c -> new KnowEngineDefaultContent((DefaultContent) c))
                .toList())
        .toList();

List<Content> fusedContents = KnowEngineReciprocalRankFuser.fuse(wrapped);
```

随后再交给 `ScoringModel` 做 Re-rank、按阈值过滤、`limit(maxResults)` 截断。

**检索器检索结果的有序保障**

为了让"进入 RRF 的每一路列表本身就是按相关性排序的"，KnowEngineElasticsearchContentRetriever 在拼装父子/兄弟补全结果之后，追加了一道按 ES 原始 `score` 的降序兜底：

```java

finalContents = finalContents.stream()
        .sorted((c1, c2) -> Double.compare(
                (double) c2.metadata().get(ContentMetadata.SCORE),
                (double) c1.metadata().get(ContentMetadata.SCORE)))
        .collect(Collectors.toList());
```

RRF 的得分公式与"列表内相对排名"强相关，**输入有序 → RRF 才有意义**。

效果

修复后：

| 现象 | 修复前 | 修复后 |
| --- | --- | --- |
| 同一 chunk 是否会出现多次 | 是 | 否（按`chunkId`全局去重） |
| 多路同 chunk 的 RRF 分 | 各算各的，未叠加 | 正确累加为`Σ 1/(k+rank_i)` |
| 最终顺序 | 受重复条目干扰，与"多路热度"不一致 | 严格按累加后 RRF 分降序 |
| Top-K 信息密度 | 被重复内容稀释 | 显著提升 |

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a1abe8751b1440001b01f41
