---
title: "✅Spring AI 和 LangChain4J的模块化RAG功能对比"
---

# ✅Spring AI 和 LangChain4J的模块化RAG功能对比

前面两个章节我们介绍过了Spring AI和LangChain4J中的模块化RAG的相关支持，我们把他们放一起做个简单的对比：

| **对比项** | **Spring AI** | **LangChain4J** |
| --- | --- | --- |
| **核心组件** | RetrievalAugmentationAdvisor | RetrievalAugmentor |
| **查询富化** | QueryTransformer （CompressionQueryTransformer） | QueryTransformer（CompressingQueryTransformer） |
| **查询重写** | QueryTransformer （RewriteQueryTransformer） | QueryTransformer |
| **查询翻译** | **QueryTransformer （TranslationQueryTransformer）** |  |
| **查询路由** |  | **QueryRouter（LanguageModelQueryRouter）** |
| **查询扩展** | QueryExpander （MultiQueryExpander） | QueryTransformer（ExpandingQueryTransformer） |
| **内容检索** | DocumentRetriever （VectorStoreDocumentRetriever） | **ContentRetriever（EmbeddingStoreContentRetriever、WebSearchContentRetriever）** |
| **混合检索** | 不支持 | **支持，利用QueryRoute+ContentRetriever可实现** |
| **内容聚合**<br>**（重排序）** | 不支持 | **ContentAggregator（DefaultContentAggregator、ReRankingContentAggregator）** |
| **上下文后处理**<br>**`（如文档合并等）`** | DocumentJoiner（ConcatenationDocumentJoiner） |  |
| **提示增强**<br>**（将检索结果与用户问题合并）** | QueryAugmenter（ContextualQueryAugmenter） | ContentInjector（DefaultContentInjector） |

同样都支持的功能：查询富化、查询重写、查询扩展、以及提示增强部分的功能。

SpringAI中支持，但是LangChain4j不支持的功能，主要是这个查询翻译。

而LangChain4j支持，但是Spring AI 不支持的主要有查询路由、内容聚合（重排序）、混合检索这3个，还有就是虽然都支持内容检索，但是Langchain4J除了支持向量数据库的检索外，还内置了搜索引擎的web检索。

总结下，**在RAG的支持上，如果要使用模块化RAG，来自由组装这些RAG的流程，LangChain4j要比Spring AI的功能更强大一些。**

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69999fdfd31fed0001142bae
