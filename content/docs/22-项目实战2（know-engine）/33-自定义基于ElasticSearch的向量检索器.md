---
title: "✅自定义基于ElasticSearch的向量检索器"
---

# ✅自定义基于ElasticSearch的向量检索器

ES的语义相似度检索，采用的是KNN的方式，在ES的官网中（[https://www.elastic.co/docs/solutions/search/vector/knn](https://www.elastic.co/docs/solutions/search/vector/knn) ） 提到，ES支持两种 kNN 搜索方法

![image.png](assets/0b314e1d72d0.png)

分别是：

**近似 kNN（Approximate kNN）——推荐用于生产环境**

- 使用 `knn` 查询选项或 `knn` 查询 DSL。
- **底层索引结构**：默认使用 **HNSW（Hierarchical Navigable Small World）图算法**
- **优点**：低延迟、高扩展性，适合大规模数据。
- **要求**：`dense_vector` 字段需启用 `index: true`（Elasticsearch 8.0+ 默认开启）。

**精确 kNN（Exact kNN）——适用于小数据集**

- 使用 `script_score` + 向量函数（如 `cosineSimilarity`）。
- **暴力搜索**：遍历所有文档计算相似度。
- **缺点**：性能差，不适用于大数据。
- **适用场景**：数据量小、需 100% 精确结果，或配合强过滤条件缩小范围。

还记得我们在文档 中讲解的时候，提到ES会自动创建一个索引，索引中包含的vector字段，他的定义如下：

```json
"vector": {
      "type": "dense_vector",
      "dims": 1536,
      "index": true,
      "similarity": "cosine",
      "index_options": {
           "type": "int8_hnsw",
           "m": 16,
           "ef_construction": 100
      }
}
```

- `type`: dense_vector：表示存储的是稠密向量数据。
- `dims`: 1536：向量的维度是 **1536**。
- `index` ：true是开启高性能向量搜索（kNN）的“开关”。告诉 Elasticsearch **“不要只把向量当作文本存起来，请为它建立 HNSW 导航图，以便我能以毫秒级的速度进行近似搜索。”**
- `similarity`: cosine：使用**余弦相似度**来计算向量之间的距离。

- `index_options` (索引算法)：
- `type`: int8_hnsw：`int8` 是数据的**存储格式**（还支持float、byte等）**，****将每个数字转换为 8 位**整数。每个数字只占用 **1 字节** 内存。`hnsw`是数据的索引结构，这是一种**近似最近邻搜索**算法。是kNN的一种优化手段。

**为什么推荐 ****`int8_hnsw`****？**

在 Elasticsearch 8.x 版本中，`int8_hnsw` 经常被作为**默认推荐**或**首选**配置，因为它解决了向量数据库最大的痛点——**内存成本**。

| 特性 | 普通`hnsw`<br>(float32) | `int8_hnsw`<br>(推荐) |
| --- | --- | --- |
| **内存占用** | 高 (100%) | **低 (约 25%)** |
| **搜索速度** | 快 | **极快**<br>(数据更紧凑，CPU 缓存命中率更高) |
| **搜索精度** | 100% (基准) | **~99%+**<br>(几乎无感知的微小损失) |
| **适用场景** | 对精度有极端要求的科研场景 | **绝大多数生产环境、推荐系统、语义搜索** |

`index_options` (索引算法)：

- **`m`**: 控制HNSW 图中每个节点的邻居数量。

`m` 表示一个节点的邻居数量，默认值为16。邻居数量越多，召回率会相应提高，但这将对性能产生较大影响，并增加内存占用。如果对召回率有严格要求，可以将其设置为64或更大的值。

`index_options` (索引算法)：

- **`ef_construction`**: 在插入新向量、建立索引时，算法不会盲目地随便找几个邻居，而是会先在一个“候选池”里进行一轮搜索。`ef_construction` 就定义了这个**候选池的大小**。

`ef_construction`的值越大，构建出的图结构更合理、连接质量更高。这意味着在未来的向量搜索中，算法更容易通过导航图找到真正的最近邻，从而获得**更高的召回率（Recall）和搜索精度**。但是在建立索引时，算法需要计算和比较更多的节点，导致**索引构建的时间显著变长**。如果对召回率有严格的要求，可以将其设置为512或更大的值。

那么也就是说，默认情况下，ES会使用 `HNSW` 算法进行近似 `knn` 搜索。

在检索的介绍时，我们提到过ES的混合检索：

这里面会用到ElasticsearchConfigurationKnn来初始化一个Retriever，除了这个ElasticsearchConfigurationKnn，还有一个实现是ElasticsearchConfigurationScript，这两个就是分别做近似kNN（HNSW）和精确kNN（`script_score` + 向量函数）实现的。

所以，我们在构造ElasticsearchContentRetriever时，如果更看重精确度，则可以采用ElasticsearchConfigurationScript，但是他的效率会差一些。

```text
embeddingRetriever = ElasticsearchContentRetriever
.builder()
        .restClient(restClient)
        .embeddingModel(openAiEmbeddingModel)
        .configuration(ElasticsearchConfigurationScript.builder().build())
        .maxResults(MAX_RESULT)
        .indexName(INDEX_NAME)
        .minScore(MIN_SCORE)
        .build();
```

那如果更看重速度，可以适当牺牲一点精确度，或者是精确度影响也不大的话，可以使用ElasticsearchConfigurationKnn。

```text
embeddingRetriever = ElasticsearchContentRetriever
.builder()
        .restClient(restClient)
        .embeddingModel(openAiEmbeddingModel)
        .configuration(ElasticsearchConfigurationKnn.builder().build())
        .maxResults(MAX_RESULT)
        .indexName(INDEX_NAME)
        .minScore(MIN_SCORE)
        .build();
```

实际的工程实践是：

**使用ES做RAG的检索召回时，先采用近似KNN，及HNSW来检索，如果发现召回率比较差，则可以考虑先优化其他的，比如提示词、比如分段、比如做查询重写等等，以及多路召回，混合检索等。然后再考虑优化m和ef_construction这两个参数，最后再考虑使用精确knn，因为他会影响性能。即：**

- **先易后难**：从最简单的提示词开始。
- **先外后内**：先优化检索层之外的环节。
- **性能优先**：将影响性能的“重操作”放在最后。

那么，我们借助ElasticsearchConfigurationKnn实现一个我们自己的ContentRetriever，之所以要自定义，是因为在这里除了检索，还需要完善父子分块的检索处理。所以需要做定制。

代码实现如下：

```text
package cn.hollis.llm.mentor.know.engine.rag.modules;

import cn.hollis.llm.mentor.know.engine.document.service.KnowledgeSegmentService;
import dev.langchain4j.data.embedding.Embedding;
import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.model.embedding.EmbeddingModel;
import dev.langchain4j.rag.content.Content;
import dev.langchain4j.rag.content.ContentMetadata;
import dev.langchain4j.rag.content.retriever.ContentRetriever;
import dev.langchain4j.rag.content.retriever.elasticsearch.ElasticsearchContentRetriever;
import dev.langchain4j.rag.query.Query;
import dev.langchain4j.store.embedding.EmbeddingSearchRequest;
import dev.langchain4j.store.embedding.EmbeddingSearchResult;
import dev.langchain4j.store.embedding.elasticsearch.*;
import dev.langchain4j.store.embedding.filter.Filter;
import org.elasticsearch.client.RestClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;

import static cn.hollis.llm.mentor.know.engine.rag.constant.MetadataKeyConstant.BROTHER_CHUNK_ID;
import static cn.hollis.llm.mentor.know.engine.rag.constant.MetadataKeyConstant.PARENT_CHUNK_ID;
import static dev.langchain4j.store.embedding.filter.MetadataFilterBuilder.metadataKey;

/**
 * KnowEngine Elasticsearch 内容检索器
 * <p>
 * 基于 Elasticsearch 的向量检索实现，支持以下特性：
 * <ul>
 *   <li><b>向量检索 (KNN)</b>：使用 Embedding 模型将查询文本向量化，进行相似度搜索</li>
 *   <li><b>全文检索</b>：支持 Elasticsearch 全文搜索</li>
 *   <li><b>混合检索</b>：结合向量检索和全文检索（需 Elasticsearch 相应许可证）</li>
 *   <li><b>关联内容扩展</b>：自动检索兄弟分段 (brother chunk) 和父分段 (parent chunk) 内容</li>
 * </ul>
 * <p>
 * <b>关联内容扩展机制：</b>
 * <ul>
 *   <li>兄弟分段：具有相同父分段的其他子分段，用于获取完整上下文</li>
 *   <li>父分段：从 Redis 中读取父分段的完整文本，替换子分段以获得更完整的语义</li>
 * </ul>
 * <p>
 *
 * @see ElasticsearchContentRetriever
 * @see ContentRetriever
 */
public class KnowEngineElasticsearchContentRetriever extends AbstractElasticsearchEmbeddingStore implements ContentRetriever {

    private static final Logger log = LoggerFactory.getLogger(ElasticsearchContentRetriever.class);
    private final EmbeddingModel embeddingModel;
    private final int maxResults;
    private final double minScore;
    private final Filter filter;
    private final KnowledgeSegmentService knowledgeSegmentService;

    /**
     * Creates an instance of ElasticsearchContentRetriever using a RestClient.
     *
     * @param configuration  Elasticsearch retriever configuration to use (knn, script, full text, hybrid, hybrid with reranker)
     * @param restClient     Elasticsearch Rest Client (mandatory)
     * @param indexName      Elasticsearch index name (optional). Default value: "default".
     *                       Index will be created automatically if not exists.
     * @param embeddingModel Embedding model to be used by the retriever
     * @param maxResults     Maximum number of results to retrieve
     * @param minScore       Minimum score threshold for retrieved results
     * @param filter         Filter to apply during retrieval
     */
    public KnowEngineElasticsearchContentRetriever(
            ElasticsearchConfiguration configuration,
            RestClient restClient,
            String indexName,
            EmbeddingModel embeddingModel,
            final int maxResults,
            final double minScore,
            final Filter filter,
            KnowledgeSegmentService knowledgeSegmentService) {
        this.embeddingModel = embeddingModel;
        this.maxResults = maxResults;
        this.minScore = minScore;
        this.filter = filter;
        this.knowledgeSegmentService = knowledgeSegmentService;
        this.initialize(configuration, restClient, indexName);
    }

    /**
     * 根据查询条件检索相关内容
     * <p>
     * 根据当前配置的检索模式执行内容检索，支持以下三种模式：
     * <ul>
     *   <li><b>全文检索</b>：当配置为 {@link ElasticsearchConfigurationFullText} 时，直接执行全文搜索</li>
     *   <li><b>混合检索</b>：当配置为 {@link ElasticsearchConfigurationHybrid} 时，结合向量检索和全文检索</li>
     *   <li><b>向量检索（默认）</b>：将查询文本向量化后进行 KNN 相似度搜索</li>
     * </ul>
     * <p>
     * 在向量检索模式下，检索结果还会进行关联内容扩展：
     * <ul>
     *   <li>兄弟分段扩展：根据 brotherChunkId 检索同一父分段下的其他兄弟分段，补全上下文</li>
     *   <li>父分段替换：根据 parentChunkId 从 Redis 中读取父分段的完整文本，替换子分段以获得更完整的语义</li>
     * </ul>
     *
     * @param query 查询对象，包含待检索的文本内容
     * @return 检索到的内容列表，包含原始检索结果及扩展的关联内容
     */
    @Override
    public List<Content> retrieve(final Query query) {
        // 全文检索模式：直接执行全文搜索并返回结果
        if (configuration instanceof ElasticsearchConfigurationFullText) {
            log.debug("Using a full text search query");
            return this.fullTextSearch(query.text()).stream()
                    .map(t -> Content.from(
                            t,
                            Map.of(
                                    ContentMetadata.SCORE, t.metadata().getDouble(ContentMetadata.SCORE.name()),
                                    ContentMetadata.EMBEDDING_ID,
                                    t.metadata().getString(ContentMetadata.EMBEDDING_ID.name()))))
                    .toList();
        }
        // 将查询文本转换为向量
        Embedding referenceEmbedding = embeddingModel.embed(query.text()).content();
        // 构建向量搜索请求，设置查询向量、最大返回数量、最低相似度分数和过滤条件
        EmbeddingSearchRequest request = EmbeddingSearchRequest.builder()
                .queryEmbedding(referenceEmbedding)
                .maxResults(maxResults)
                .minScore(minScore)
                .filter(filter)
                .build();

        // 混合检索模式：结合向量检索和全文检索
        if (configuration instanceof ElasticsearchConfigurationHybrid) {
            return mapResultsToContentList(this.hybridSearch(request, query.text()));
        }

        // 向量检索模式（默认）：执行 KNN 向量相似度搜索
        List<Content> searchContents = mapResultsToContentList(this.search(request));
        // 去重并按文本内容排序
        searchContents = searchContents.stream().distinct().sorted(Comparator.comparing(content -> content.textSegment().text())).toList();
        List<Content> finalContents = new ArrayList<>(searchContents);

        // 兄弟分段缓存和父分段缓存，避免重复查询
        Map<String, List<Content>> brotherDocMap = new HashMap<>();
        Map<String, List<Content>> parentDocMap = new HashMap<>();

        Iterator<Content> iterator = searchContents.iterator();

        for (; iterator.hasNext(); ) {
            Content content = iterator.next();
            // 兄弟分段扩展：检索具有相同 brotherChunkId 的其他兄弟分段
            String brotherChunkId = content.textSegment().metadata().getString(BROTHER_CHUNK_ID);
            if (brotherChunkId != null) {
                List<Content> cachedBrotherDocs = brotherDocMap.get(brotherChunkId);
                if (cachedBrotherDocs != null) {
                    // 命中缓存，直接使用已检索的兄弟分段
                    finalContents.addAll(cachedBrotherDocs);
                } else {
                    // 未命中缓存，按 brotherChunkId 过滤检索兄弟分段
                    Filter brotherFilter = metadataKey(BROTHER_CHUNK_ID).isEqualTo(brotherChunkId);
                    request = EmbeddingSearchRequest.builder()
                            .filter(brotherFilter)
                            .build();
                    List<Content> brotherDocs = mapResultsToContentList(this.search(request));
                    brotherDocMap.put(brotherChunkId, brotherDocs);
                    finalContents.addAll(brotherDocs);
                }
            }

            // 父分段替换：用父分段的完整文本替换子分段，获取更完整的语义
            String parentChunkId = content.textSegment().metadata().getString(PARENT_CHUNK_ID);
            if (parentChunkId != null) {
                List<Content> cachedParentDocs = parentDocMap.get(parentChunkId);
                if (cachedParentDocs != null) {
                    // 如果已经缓存中有过这个父分段了，说明已经用过了，这里就不用再加了，避免重复
                    finalContents.remove(content);
                } else if (knowledgeSegmentService != null) {
                    // 读取 parentChunk 的文本内容
                    String segmentText = knowledgeSegmentService.getTextByChunkId(parentChunkId);
                    if (segmentText != null) {
                        // 用父分段文本构造新的 Content，替换当前的子分段内容
                        TextSegment parentSegment = TextSegment.from(segmentText, content.textSegment().metadata());
                        Content parentContent = Content.from(parentSegment, content.metadata());
                        List<Content> parentDocs = List.of(parentContent);
                        parentDocMap.put(parentChunkId, parentDocs);
                        finalContents.remove(content);
                        finalContents.addAll(parentDocs);
                    } else {
                        log.warn("parentChunk not found in Redis, chunkId: {}", parentChunkId);
                        finalContents.remove(content);
                    }
                }
            }
        }
        return finalContents;
    }

    private List<Content> mapResultsToContentList(EmbeddingSearchResult<TextSegment> searchResult) {
        List<Content> result = searchResult.matches().stream()
                .filter(f -> f.score() > minScore)
                .map(m -> Content.from(
                        m.embedded(),
                        Map.of(
                                ContentMetadata.SCORE, m.score(),
                                ContentMetadata.EMBEDDING_ID, m.embeddingId())))
                .toList();
        log.debug("Found [{}] relevant documents in Elasticsearch index [{}].", result.size(), indexName);
        return result;
    }

    public static KnowEngineElasticsearchContentRetriever.Builder builder() {
        return new KnowEngineElasticsearchContentRetriever.Builder();
    }

    public static class Builder {

        private RestClient restClient;
        private String indexName = "default";
        private ElasticsearchConfiguration configuration =
                ElasticsearchConfigurationKnn.builder().build();
        private EmbeddingModel embeddingModel;
        private int maxResults;
        private double minScore;
        private Filter filter;
        private KnowledgeSegmentService knowledgeSegmentService;

        /**
         * @param restClient Elasticsearch RestClient.
         * @return builder
         */
        public KnowEngineElasticsearchContentRetriever.Builder restClient(RestClient restClient) {
            this.restClient = restClient;
            return this;
        }

        /**
         * @param indexName Elasticsearch index name (optional). Default value: "default".
         * @return builder
         */
        public KnowEngineElasticsearchContentRetriever.Builder indexName(String indexName) {
            this.indexName = indexName;
            return this;
        }

        /**
         * @param configuration the configuration to use
         * @return builder
         */
        public KnowEngineElasticsearchContentRetriever.Builder configuration(ElasticsearchConfiguration configuration) {
            this.configuration = configuration;
            return this;
        }

        public KnowEngineElasticsearchContentRetriever.Builder embeddingModel(EmbeddingModel embeddingModel) {
            this.embeddingModel = embeddingModel;
            return this;
        }

        public KnowEngineElasticsearchContentRetriever.Builder maxResults(int maxResults) {
            this.maxResults = maxResults;
            return this;
        }

        public KnowEngineElasticsearchContentRetriever.Builder minScore(double minScore) {
            this.minScore = minScore;
            return this;
        }

        public KnowEngineElasticsearchContentRetriever.Builder filter(Filter filter) {
            this.filter = filter;
            return this;
        }


        public KnowEngineElasticsearchContentRetriever.Builder stringRedisTemplate(KnowledgeSegmentService knowledgeSegmentService) {
            this.knowledgeSegmentService = knowledgeSegmentService;
            return this;
        }

        public KnowEngineElasticsearchContentRetriever build() {
            return new KnowEngineElasticsearchContentRetriever(
                    configuration, restClient, indexName, embeddingModel, maxResults, minScore, filter, knowledgeSegmentService);
        }
    }
}
```

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69e4a7333fb91800015ba30f
