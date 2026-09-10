---
title: "✅LangChain4J中的RAG执行流程"
---

# ✅LangChain4J中的RAG执行流程

在下面这篇文章中，我们介绍过了关于RAG的模块化RAG的支持：

我们的这个项目就会围绕着这个机制来实现RAG的检索流程。

上一篇文档中，我们介绍了各个组件，我们在这里再来回顾一下他们，并且把整个流程串起来。然后我们基于这些组件逐一展开开始课程的学习。

RetrievalAugmentor是LangChain4j中RAG检索的核心组件，只有给一个AIService配置了RetrievalAugmentor之后，他才会做检索。

RetrievalAugmentor中包含了以下组件：

| **组件** | **作用** | **默认实现** |
| --- | --- | --- |
| **QueryTransformer** | 将用户的原始查询转换为一个或多个新查询，目的是提升检索质量。 | 直接返回原查询 |
| **QueryRouter** | 根据查询语义，将其路由到最合适的一个或多个 ContentRetriever（内容检索器） | 将查询发到所有检索器 |
| **ContentRetriever** | 接收一个 Query，从底层数据源中检索出相关内容，返回按相关性排序的 List&lt;Content&gt;。它是 RAG 流程中唯一必须由用户提供的组件（其他组件都有默认实现）。 | / |
| **ContentAggregator** | 将所有查询从所有检索器检索到的内容进行聚合、去重、排序，确保只返回最相关且不冗余的内容给 LLM | 使用 RRF 融合排序 |
| **ContentInjector** | 将聚合后的检索内容注入到原始用户消息中，构造增强提示词，使 LLM 能基于检索到的内容生成回答。 | 使用模板 &#123;&#123;userMessage&#125;&#125;\n\nAnswer using the following information:\n&#123;&#123;contents&#125;&#125; 将内容追加到用户消息末尾 |

用法：

```
DefaultRetrievalAugmentor.builder()
    .queryRouter(new DefaultQueryRouter(
        List.of(embeddingRetriever, fullTextRetriever, sqlRetriever, neo4jRetriever), chatModel))  // 自定义路由器和检索器
    .queryTransformer(queryTransformer)          // 自定义改写器
    .contentAggregator(contentAggregator)         // 自定义聚合器（多层去重+RRF）
    .contentInjector(contentInjector)             // 自定义注入模板
    .build();
```

实际执行流程：

```
public AugmentationResult augment(AugmentationRequest augmentationRequest) {
    // 从 UserMessage 提取原始查询
    Query originalQuery = Query.from(queryText, augmentationRequest.metadata());

    // 步骤1: 查询转换
    Collection<Query> queries = queryTransformer.transform(originalQuery);

    // 步骤2+3: 查询路由 + 内容检索（内部并行）
    Map<Query, Collection<List<Content>>> queryToContents = process(queries);

    // 步骤4: 内容聚合
    List<Content> contents = contentAggregator.aggregate(queryToContents);

    // 步骤5: 内容注入
    ChatMessage augmentedChatMessage = contentInjector.inject(contents, chatMessage);

    return AugmentationResult.builder()
        .chatMessage(augmentedChatMessage)
        .contents(contents)
        .build();
}
```

后面，我们就从头开始，以此开始介绍**QueryTransformer（查询改写）、QueryRouter（查询路由）、ContentRetriever（混合检索）、ContentAggregator（重排序）以及ContentInjector（内容注入）**

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69e33d88d31fed0001569f44
