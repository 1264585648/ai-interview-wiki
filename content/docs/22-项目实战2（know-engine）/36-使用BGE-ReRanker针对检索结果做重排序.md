---
title: "✅使用BGE-ReRanker针对检索结果做重排序"
---

# ✅使用BGE-ReRanker针对检索结果做重排序

我们之前讲过，LangChain4J中的ContentAggregator是有重排序的实现的，默认采用RRF算法做融合。

DefaultContentAggregator

它的主要工作是**融合（Fusion）**。当你的 RAG 流程中有多个检索器（例如，一个向量检索器和一个关键词检索器）或多个查询时，它会使用RRF算法。

**工作原理**：RRF 算法不关心检索器返回的原始相似度分数，只关注文档在各自结果列表中的**排名位置**。它会给排名靠前的文档更高的权重，然后将来自不同列表的同一文档的权重相加，最终得到一个综合排名。

但是这个默认实现有一个关键的问题，那就是他只做融合，他会把所有的检索结果都给到LLM，比如多个检索器，比如向量检索检索到5个文档，全文检索也检索到5个文档，那么RRF之后，就是会保留10个文档，这样会导致内容太多了，其实模型可能根本不需要这么多文档的。

ReRankingContentAggregator

除了默认实现外，还有ReRankingContentAggregator一个实现，他的工作原理是先融合，然后再做精排和过滤。

- **融合**：首先，它会像 `DefaultContentAggregator` 一样，使用 RRF 算法将多个检索结果列表合并成一个。
- **精排与过滤**：然后，调用配置的 `ScoringModel`（如 Jina、Cohere、BGE 等）对每个内容片段与查询的相关性进行精确评分。最后，根据新的分数重新排序，并可以过滤掉低于设定阈值的低质量内容。

想要使用ReRankingContentAggregator的话，需要提供一个ScoringModel，通过这个 ScoringModel 为每个文档评分，排序并过滤低分文档。

比如我们在文档中介绍过，LangChain4j官方支持了一些重排序的模型。（[https://github.com/langchain4j/langchain4j/tree/main/docs/docs/integrations/scoring-reranking-models](https://github.com/langchain4j/langchain4j/tree/main/docs/docs/integrations/scoring-reranking-models) ）：

![image.png](assets/629fa6e87314.png)

如果想用的话，可以申请官方的API来调用。但是我们，如果想要使用更加优质的rerank模型，比如比较牛逼的、适合中文的BGE-Reranker、Qwen3-Reranker的话，需要自己定制开发。

我们项目中使用BGE作为选择， 介绍下如何使用自己选择的rerank模型做重排序。

下载BGE模型的ONNX模型文件

`bge-reranker`也有多个版本，主要区别如下：

- `bge-reranker-v2-m3` (全能首选): 性价比最高。它在保持高精度的同时，模型体积小、速度快，并原生支持超过100种语言的跨语言检索，是大多数 RAG 应用的首选。
- `bge-reranker-large` (中文专精): 精度略高，但代价是模型更大、推理更慢。如果你的应用是纯中文环境且对精度有极致追求，并拥有充足的 GPU 资源，可以考虑它。
- `bge-reranker-base` (轻量入门): 资源占用最小，可以在性能较弱的机器甚至 CPU 上流畅运行，适合对延迟极其敏感或资源受限的场景。

我们选择`bge-reranker-v2-m3`，它对应的ONNX在modelscope上的地址如下：

[https://modelscope.cn/models/onnx-community/bge-reranker-v2-m3-ONNX/summary](https://modelscope.cn/models/onnx-community/bge-reranker-v2-m3-ONNX/summary)

我们需要从这里下载一些文件，后面会用到，主要下载：

```text
model_quantized.onnx
```

![image.png](assets/ce2409b06f4d.png)

各个文件的差别如下：

![image.png](assets/360211cae46b.png)

另外，还需要下载`tokenizer.json`，**分词器核心文件，**包含了词汇表和分词算法。这是文件列表中最大的配置文件，因为它包含了数万个单词的映射关系。用来把中文句子切分成模型能看懂的数字ID。

我们把它下载完之后，放到classpath目录下：

![image.png](assets/ea7270f2371c.png)

OnnxScoringModel

OnnxScoringModel是 langchain4j 提供的本地 Reranker 评分模型，基于 ONNX Runtime 在 JVM 内直接运行 BERT 类 Cross-Encoder 模型，用于 RAG 流程中对检索到的文档进行重排序（Reranking）。

如果把 AI 模型比作“音乐文件”，那么 ONNX Runtime 就是一个**万能的“播放器”**。无论你用 PyTorch 还是 TensorFlow 训练模型，只要转换成标准格式（ONNX），ONNX Runtime 就能在任何设备（电脑、手机、云端）上高效地运行它。

OnnxScoringModel需要的参数如下：

- **modelPath（模型路径）**
- 必须指向 ONNX 格式的模型文件
- 推荐使用 model_quantized.onnx（量化版，体积小、推理快，精度损失极小）
- 如果你有 GPU 且安装了 onnxruntime_gpu，可以用非量化版获得更高精度
- **tokenizerPath（分词器路径）**
- 必须是 HuggingFace 格式的 tokenizer.json
- 需与模型配套，比如 bge-reranker-v2-m3 对应的 tokenizer
- **modelMaxLength（最大 token 长度）**
- 定义模型能够处理的单个文本（查询或文档）的最大 Token 数量。超过此长度的文本会被截断，不足的会被填充。
- 这个值需要与你下载的模型所支持的长度一致。通常可以在模型的配置文件（如 `tokenizer_config.json`）中找到 `model_max_length` 字段。常见的值有 512、1024 等。
- 比如不同的BGE模型的 max length 不同：
- bge-reranker-v2-m3：8192
- bge-reranker-large：512
- bge-reranker-base：512
- **normalize（是否归一化）**
- 决定是否将模型输出的原始分数（Logits）通过 Sigmoid 等函数归一化到 (0, 1) 区间。
- 设置为 `true`：如果你希望得到类似概率的分数（0到1之间），**便于设置统一的 ****`minScore`**** 阈值。**
- 设置为 `false`：如果你直接使用模型的原始输出分数（可能是任意实数，如 8.66 或 -11.24）。在这种情况下，你需要根据实际返回的分数分布来设定你的过滤阈值。
- **sessionOptions（ONNX Runtime 会话选项）**
- 可控制推理性能的关键参数，小模型如 bge-reranker-v2-m3 量化版，默认配置就够用，不需要特别调优
- **使用 CPU（默认）**：如果未指定，模型默认使用 CPU 运行。你可以创建一个默认的 `SessionOptions` 对象。
- **使用 GPU（推荐用于高性能场景）**：如果你的服务器有 NVIDIA GPU，可以通过此参数启用 CUDA 加速。

```
OrtSession.SessionOptions opts = new OrtSession.SessionOptions();
  opts.setInterOpNumThreads(2);      // 线程间并行数
  opts.setIntraOpNumThreads(4);      // 算子内并行线程数
  opts.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);  // 最大优化
  opts.setMemoryPattern(true);       // 启用内存模式优化

OrtSession.SessionOptions options = new OrtSession.SessionOptions();
options.addCUDA(0); // 使用第一块 GPU (ID为0)
```

增加依赖

```text
<dependency>
    <groupId>dev.langchain4j</groupId>
    <artifactId>langchain4j-onnx-scoring</artifactId>
    <version>1.11.0-beta19</version>
    <exclusions>
        <exclusion>
            <groupId>com.microsoft.onnxruntime</groupId>
            <artifactId>onnxruntime</artifactId>
        </exclusion>
    </exclusions>
</dependency>

<!-- ONNX Runtime (CPU) - 兼容 macOS Monterey -->
<dependency>
    <groupId>com.microsoft.onnxruntime</groupId>
    <artifactId>onnxruntime</artifactId>
    <version>1.17.1</version>
</dependency>
```

定义一个BgeScoringModel

```text
public class BgeScoringModel {

    /**
     * classpath 下的模型文件路径
     */
    private static final String CLASSPATH_MODEL = "model/bge-reranker-model/model_quantized.onnx";
    private static final String CLASSPATH_TOKENIZER = "model/bge-reranker-model/tokenizer.json";

    /**
     * 单例实例，使用 volatile 保证多线程可见性
     */
    private static volatile OnnxScoringModel instance;

    private BgeScoringModel() {
    }

    /**
     * 获取 OnnxScoringModel 单例实例（从 classpath 加载模型）
     *
     * @return OnnxScoringModel 实例
     */
    public static OnnxScoringModel getInstance() {
        if (instance == null) {
            synchronized (BgeScoringModel.class) {
                if (instance == null) {
                    String modelPath = resolveClasspathToFilePath(CLASSPATH_MODEL);
                    String tokenizerPath = resolveClasspathToFilePath(CLASSPATH_TOKENIZER);

                    log.info("正在初始化 BGE-RERANKER 评分模型...");
                    log.info("模型路径: {}", modelPath);
                    log.info("Tokenizer路径: {}", tokenizerPath);

                    instance = new OnnxScoringModel(modelPath, tokenizerPath);

                    log.info("BGE-RERANKER 评分模型初始化完成");
                }
            }
        }
        return instance;
    }

    /**
     * 将 classpath 资源解析为文件绝对路径
     * <p>
     * 优先尝试直接获取文件路径（IDE 或解压目录下的资源），
     * 如果资源在 JAR 包内则复制到临时文件后返回临时文件路径。
     *
     * @param classpathResource classpath 下的资源名称
     * @return 资源的绝对文件路径
     */
    private static String resolveClasspathToFilePath(String classpathResource) {
        URL resource = BgeScoringModel.class.getClassLoader().getResource(classpathResource);
        if (resource == null) {
            throw new IllegalArgumentException(
                    String.format("classpath 下未找到资源: %s，请确认模型文件已放置到 resources 目录", classpathResource));
        }

        // 尝试直接获取文件路径（适用于 IDE 运行或解压目录）
        try {
            File file = new File(resource.toURI());
            if (file.exists()) {
                return file.getAbsolutePath();
            }
        } catch (Exception e) {
            // 资源在 JAR 包内，无法直接转 File，走下方临时文件逻辑
            log.debug("资源在 JAR 包内，将复制到临时文件: {}", classpathResource);
        }

        // 资源在 JAR 包内，复制到临时文件
        try (InputStream is = BgeScoringModel.class.getClassLoader().getResourceAsStream(classpathResource)) {
            Path tempFile = Files.createTempFile("bge-reranker-", "." + classpathResource.substring(classpathResource.lastIndexOf('.') + 1));
            tempFile.toFile().deleteOnExit();
            Files.copy(is, tempFile, StandardCopyOption.REPLACE_EXISTING);
            log.info("已将 classpath 资源复制到临时文件: {}", tempFile.toAbsolutePath());
            return tempFile.toAbsolutePath().toString();
        } catch (IOException e) {
            throw new RuntimeException("无法从 classpath 复制资源到临时文件: " + classpathResource, e);
        }
    }
}
```

测试

```text
@GetMapping("testReranker")
public String testReranker(String query) {
    if (query == null || query.isBlank()) {
        query = "什么是Java？";
    }

    // 1. 获取 BGE-RERANKER 单例
    OnnxScoringModel scoringModel = BgeScoringModel.getInstance();

    // 2. 构造测试文档，模拟检索结果
    List<Content> testContents = List.of(
            Content.from(TextSegment.from("Java是一种面向对象的编程语言，具有跨平台、安全性高等特点，广泛应用于企业级开发。")),
            Content.from(TextSegment.from("Python是一种解释型的高级编程语言，以简洁易读的语法著称，常用于数据科学和人工智能领域。")),
            Content.from(TextSegment.from("JavaScript是一种脚本语言，主要用于Web前端开发，也可以通过Node.js进行服务端编程。")),
            Content.from(TextSegment.from("Java虚拟机（JVM）是运行Java字节码的虚拟机，它使得Java具有跨平台能力。Spring是最流行的Java开发框架。")),
            Content.from(TextSegment.from("Go语言由Google开发，以高并发和简洁语法为特色，常用于微服务和云原生开发。"))
    );

    // 3. 构建 ReRankingContentAggregator
    ContentAggregator aggregator = ReRankingContentAggregator.builder()
            .scoringModel(scoringModel)
            .build();

    // 4. 直接调用 ContentAggregator 进行重排序
    Query queryObj = new Query(query);
    List<Content> rerankedContents = aggregator.aggregate(Map.of(queryObj, List.of(testContents)));

    // 5. 格式化输出结果
    return rerankedContents.stream()
            .map(content -> {
                TextSegment segment = content.textSegment();
                Double rerankedScore = (Double) content.metadata().get(ContentMetadata.RERANKED_SCORE);
                return String.format("[rerankedScore=%.4f] %s",
                        rerankedScore != null ? rerankedScore : 0.0,
                        segment.text());
            })
            .collect(Collectors.joining("\n\n---\n\n"));
}
```

使用ReRankingContentAggregator，传入一个BgeScoringModel。就可以使用他了。

测试方法结果如下：

![image.png](assets/ce532d5de505.png)

附件

[model_quantized.onnx](https://tcs-devops.aliyuncs.com/storage/133t0313b6667e0737d6600569b78a6426d8?Signature=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJBcHBJRCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9hcHBJZCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9vcmdhbml6YXRpb25JZCI6IiIsImV4cCI6MTc4OTYxMjE5MCwiaWF0IjoxNzg5MDA3MzkwLCJyZXNvdXJjZSI6Ii9zdG9yYWdlLzEzM3QwMzEzYjY2NjdlMDczN2Q2NjAwNTY5Yjc4YTY0MjZkOCJ9.ZWHf4Wb_Vrw4n2RrCPkTMPLrbnJYEaDkNYd-DfyGmxE&download=model_quantized.onnx)

[tokenizer.json](https://tcs-devops.aliyuncs.com/storage/103tdb75b1f1141ccc007565e7005646a280?Signature=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJBcHBJRCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9hcHBJZCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9vcmdhbml6YXRpb25JZCI6IiIsImV4cCI6MTc4OTYxMjE5MCwiaWF0IjoxNzg5MDA3MzkwLCJyZXNvdXJjZSI6Ii9zdG9yYWdlLzEwM3RkYjc1YjFmMTE0MWNjYzAwNzU2NWU3MDA1NjQ2YTI4MCJ9.qc4dr0NJ2DsH08LwAEHTqQLs-P1QMh4GL_a391nfFFA&download=tokenizer.json)

常见问题

The 'queryToContents' contains 2 queries, making the re-ranking ambiguous. Because there are multiple queries, it is unclear which one should be used for re-ranking. Please provide a 'querySelector' in the constructor/builder.

当我们如果在前面做过问题改写的时候，在调用ContentAggregator做改写的时候，入参中会有两个查询（改写后的查询 + 原始查询），即 List.of(compressedQuery, query)。当 ReRankingContentAggregator 接收到包含多个查询的结果时，它不知道应该用哪个查询来做重排序，因此抛出异常。

解决方案：在构建 ReRankingContentAggregator 时添加 querySelector，指定用哪个查询进行重排序。

如果想要使用改写后的问题做为重排序的参考查询，则需要指定querySelector：

```text
ContentAggregator contentAggregator = ReRankingContentAggregator.builder()
        .scoringModel(scoringModel)
        .querySelector(queryToContents -> queryToContents.keySet().iterator().next())
        .build();
```

通常会使用改写后的查询做重排序效果更好，因为它更精准、噪声更少。

如果你希望用原始查询（用户实际输入）来做重排序，可以改为：

```text
ContentAggregator contentAggregator = ReRankingContentAggregator.builder()
                .scoringModel(scoringModel)
                .querySelector(queryToContents -> {
    List<Query> queries = new ArrayList<>(queryToContents.keySet());
    return queries.get(queries.size() - 1);
})
                .build();
```

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69be4b36d31fed000133bd91
