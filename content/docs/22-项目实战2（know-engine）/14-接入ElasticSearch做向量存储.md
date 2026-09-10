---
title: "✅接入ElasticSearch做向量存储"
---

# ✅接入ElasticSearch做向量存储

我们项目中选择使用ES做向量数据库，方便后面我们基于ES做混合检索。这一篇介绍下如何在LangChain4J中接入ES。

增加依赖

首先，langchain4j-elasticsearch是一个针对langchain4j的es的包， 里面提供了一些相关的API可以使用。

```text
<dependency>
    <groupId>dev.langchain4j</groupId>
    <artifactId>langchain4j-elasticsearch</artifactId>
    <version>1.11.0-beta19</version>
</dependency>
```

`langchain4j-elasticsearch` 模块提供了与 Elasticsearch 的集成，将其作为**嵌入存储**和**内容检索器**使用。

它主要包含两个类：

- **ElasticsearchEmbeddingStore**：`EmbeddingStore` 接口的实现，使用 Elasticsearch 来存储和检索嵌入向量。
- **ElasticsearchContentRetriever**：`ContentRetriever` 接口的实现，使用 Elasticsearch 基于向量相似度搜索来检索相关文档。

ES部署

按照这篇文档中的方式，先把ES安装上：

定义ElasticsearchEmbeddingStore

```java

@Configuration
@EnableConfigurationProperties(ElasticSearchProperties.class)
public class ElasticSearchConfiguration {

    @Autowired
    private ElasticSearchProperties properties;

    public static final String INDEX_NAME = "know-engine-vector";

    @Bean(destroyMethod = "close")
    @ConditionalOnMissingBean
    public RestClient restClient() {
        return RestClient
                .builder(HttpHost.create(properties.getHost()))
                .build();
    }

    @Primary
    @ConditionalOnMissingBean
    @Bean
    public ElasticsearchEmbeddingStore elasticsearchEmbeddingStore(RestClient restClient) {
        return ElasticsearchEmbeddingStore.builder()
                .restClient(restClient)
                .indexName(INDEX_NAME)
                .build();
    }
}
```

有了这个ElasticsearchEmbeddingStore之后，我们就可以把向量化以后的chunk保存在es中了。

定义Embedding模型

有两向量存储了之后，我们还需要有一个向量模型，先把我们的Segment转成embedding，那么我们同样在刚刚的ElasticSearchConfiguration中定义一个EmbeddingModel

```java
@Autowired
private ElasticSearchProperties properties;



@Bean
public OpenAiEmbeddingModel openAiEmbeddingModel() {
    return OpenAiEmbeddingModel.builder()
            .modelName(properties.getModelName())
            .dimensions(properties.getDimensions())
            .baseUrl(properties.getBaseUrl())
            .maxSegmentsPerBatch(9)
            .apiKey(properties.getApiKey()).build();
}
```

这里需要用到几个参数：

- modelName：embedding模型的名称
- dimensions：向量的维度
- baseUrl：模型的baseurl

我们通过配置文件写入：

```text
elasticsearch:
  host: http://xx.xx.xx.xx:9200
  base-url: https://dashscope.aliyuncs.com/compatible-mode/v1
  model-name: text-embedding-v4
  api-key: @dashscope.api.key@
  dimensions: 1536
```

对应的ElasticSearchProperties定义如下：

```java

@ConfigurationProperties(prefix = ElasticSearchProperties.PREFIX)
public class ElasticSearchProperties {
    public static final String PREFIX = "elasticsearch";

    private String host;

    private String baseUrl;

    private String modelName;

    private String apiKey;

    private int dimensions;

    public String getHost() {
        return host;
    }

    public void setHost(String host) {
        this.host = host;
    }

    public String getBaseUrl() {
        return baseUrl;
    }

    public void setBaseUrl(String baseUrl) {
        this.baseUrl = baseUrl;
    }

    public String getModelName() {
        return modelName;
    }

    public void setModelName(String modelName) {
        this.modelName = modelName;
    }

    public String getApiKey() {
        return apiKey;
    }

    public void setApiKey(String apiKey) {
        this.apiKey = apiKey;
    }

    public int getDimensions() {
        return dimensions;
    }

    public void setDimensions(int dimensions) {
        this.dimensions = dimensions;
    }
}
```

这样，我们就有了embeddingModel和embeddingStore了。就可以做嵌入和存储了。

```java

@RestController
@RequestMapping("/know/engine")
public class KnowEngineController {

    @Autowired
    private KnowEngineApplicationService knowEngineApplicationService;


    @Autowired
    private OpenAiEmbeddingModel openAiEmbeddingModel;


    @RequestMapping("/retriever")
    public String retriever(String query) {
        return knowEngineApplicationService.chat(query,"1");
    }

    @Autowired
    private RestClient restClient;

    @RequestMapping("/adder")
    public String adder(String query) throws IOException {

        EmbeddingStore<TextSegment> embeddingStore = ElasticsearchEmbeddingStore.builder()
                .restClient(restClient)
                .indexName("know-engine")
                .configuration(ElasticsearchConfigurationScript.builder().build())
                .build();

        TextSegment segment1 = TextSegment.from("I like football.", new Metadata(Map.of("version", "1")));
        Embedding embedding1 = openAiEmbeddingModel.embed(segment1).content();
        embeddingStore.add(embedding1, segment1);

        TextSegment segment2 = TextSegment.from("The weather is good today.");
        Embedding embedding2 = openAiEmbeddingModel.embed(segment2).content();
        embeddingStore.add(embedding2, segment2);

        Embedding queryEmbedding = openAiEmbeddingModel.embed("What is your favourite sport?").content();

        Filter version = metadataKey("version").isEqualTo("1");

        EmbeddingSearchResult<TextSegment> relevant = embeddingStore.search(
                EmbeddingSearchRequest.builder()
                        .queryEmbedding(queryEmbedding)
                        .filter(version)
                        .build());

        EmbeddingMatch<TextSegment> embeddingMatch = relevant.matches().get(0);

        System.out.println(embeddingMatch.score()); 
        System.out.println(embeddingMatch.embedded().text()); 

        return embeddingMatch.embedded().text();
    }
}
```

运行结果：

```
0.8060765
I like football.
```

通过[http://xx.xx.xx.xx:9200/know-engine/_mapping](http://139.129.32.11:9200/know-engine/_mapping) 能查看索引的定义：

有三个字段：metadata、text、vector

```json
{
    "know-engine": {
        "aliases": {

        },
        "mappings": {
            "properties": {
                "metadata": {
                    "properties": {
                        "version": {
                            "type": "text",
                            "fields": {
                                "keyword": {
                                    "type": "keyword",
                                    "ignore_above": 256
                                }
                            }
                        }
                    }
                },
                "text": {
                    "type": "text",
                    "fields": {
                        "keyword": {
                            "type": "keyword",
                            "ignore_above": 256
                        }
                    }
                },
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
            }
        },
        "settings": {
            "index": {
                "routing": {
                    "allocation": {
                        "include": {
                            "_tier_preference": "data_content"
                        }
                    }
                },
                "number_of_shards": "1",
                "provided_name": "know-engine",
                "creation_date": "1772092603766",
                "number_of_replicas": "1",
                "uuid": "jeWusJ7GRNy1mCoMZwsCpg",
                "version": {
                    "created": "8537000"
                }
            }
        }
    }
}
```

1. `vector` (向量字段)

这是该配置中最关键的部分，用于 AI 语义搜索。

- `type`: dense_vector：表示存储的是稠密向量数据。
- `dims`: 1536：向量的维度是 **1536**。
- `similarity`: cosine：使用**余弦相似度**来计算向量之间的距离。
- `index_options` (索引算法)：
- `type`: int8_hnsw：使用了 **HNSW** 算法进行近似搜索，并且使用了 `int8` 量化。量化可以显著减少内存占用并提高搜索速度，同时保持较高的精度。
- `m`: 16：HNSW 图中每个节点的邻居数量。
- `ef_construction`: 添加一个节点时查找的最相邻doc构建邻居，默认为100。

2. `text` (文本字段)

- `type`: text：用于存储实际的文本内容。
- `fields.keyword`：同时包含一个 `keyword` 子字段。这意味着该字段既支持全文检索（分词），也支持精确匹配（如排序或聚合）。

3. `metadata` (元数据字段)

- 这是一个对象类型，目前包含一个 `version` 字段，用于记录数据的版本信息。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69c7926151b144000162f894
