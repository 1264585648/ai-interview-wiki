---
title: "✅RAG优化技术：重排序"
---

# ✅RAG优化技术：重排序

![image.png](assets/c18d21f6b52a.png)

什么是重排序？

**重排序（Reranking）是在通过混合检索（或其他方式）获得初步检索结果（候选文本块）后，再通过更强的模型**（通常是 Cross-Encoder 或专用 Reranker 模型）对这些候选文本块进行**重新打分和排序**，将真正最相关、最有价值的内容排在前面。

**重排序的意义**

1. **过滤噪声**：初步检索往往会召回数十条文档，其中可能混杂着相关性较低的“噪声”内容。
2. **提升答案精度**：重排序模型能够更细致地评估**查询和文档对**之间的相关性，比初次检索使用的相似度查询会更准确。
3. **优化上下文窗口利用率**：通过将最相关的少数文档（通常是3-5个）置于最前端，确保 LLM 的有限输入窗口被最高质量的上下文填充，让最终的生成内容基于**相对更正确、更有依据的上下文**。

重排序能**显著提升 RAG 的可靠性和最终回答质量**，是 Advanced RAG 系统的关键环节。

实现重排序

RRF算法

RRF（Reciprocal Rank Fusion-倒数排名融合）是一种轻量级且高效的检索结果融合算法，用于将来自不同检索方法（如向量检索和关键词检索）的结果合并。它通过文档在各个检索结果中的排名来计算得分。

RRF 的基本思想是：

**一个文档在多个排序列表中排名越靠前、出现次数越多，其融合得分就越高。**

它不依赖于原始得分（如 BM25 分数、神经网络打分等），只使用**排名位置（rank）**，因此具有良好的通用性和鲁棒性。

对每一个文档（或结果项）d，RRF 给它打一个分数：

![](assets/d08a269c709d.png)

- rank i是文档d在第i个列表中的排名（从 1 开始计数）；
- 如果 d 不在第 i 个列表里，就忽略这一项（或者视为无穷大，不加分）；
- K 是一个常数（通常取 60），用于控制低排名文档的权重，避免低排名文档对总分影响过大。
- 把所有模型中 d 的“倒数排名”加起来，就是它的 RRF 分数；
- 最后按 RRF 分数**从高到低**排序，得到最终结果。

注意：这里用的是 “倒数排名”（reciprocal rank），所以排名越靠前（比如第1名），贡献的分数越大（1/(1+60) ≈ 0.016），而排第10名就只有 1/(10+60) ≈ 0.014，差别虽小但有意义。

算法将同一文档在不同检索结果中的分数累加，最后根据 RRF 得分降序排序，取 topK 结果。

RRF 的优势在于实现简单、无需对不同检索系统的分数进行复杂归一化，同时对低排名或噪声项不敏感，能够稳健地融合多源检索结果。

它特别适合混合检索场景，如将向量检索与关键词检索结果结合，充分利用各检索方法的优势，提高最终排序的准确性和覆盖率。

1. **无需原始分数**：仅依赖排名，适用于异构系统（如传统 BM25 + 向量检索）。
2. **对高排名更敏感**：靠前的排名对得分贡献更大（因为是倒数关系）。
3. **简单高效**：计算开销小，易于实现。
4. **实证效果好**：在 TREC 等标准评测中表现优异，尤其适合多阶段检索架构。

```text
/**
 * RRF 算法融合向量检索和关键词检索结果
 * 公式：RRF Score = Σ(1/(k + rank_i))，其中 k 为常数（通常取60），rank_i 为文档在第i个检索结果中的排名
 */
private List<String> rrfFusion(List<Document> vectorDocs, List<EsDocumentChunk> keywordDocs, int topK) {
    // 常数 k，控制低排名文档的权重
    final int K = 60;
    // 存储每个文档ID的RRF得分
    Map<String, Double> rrfScores = new HashMap<>();
    // 存储文档ID到chunkId的映射
    Map<String, String> idToChunkId = new HashMap<>();

    // 处理向量检索结果（排名从1开始）
    for (int i = 0; i < vectorDocs.size(); i++) {
        Document doc = vectorDocs.get(i);
        String docId = doc.getId();
        // 获取元数据中的chunkId
        String chunkId = doc.getMetadata().getOrDefault("chunkId", "unknown").toString();
        idToChunkId.put(docId, chunkId);
        // 排名从1开始
        int rank = i + 1;
        double score = 1.0 / (K + rank);
        rrfScores.put(docId, rrfScores.getOrDefault(docId, 0.0) + score);
    }

    // 处理关键词检索结果（排名从1开始）
    for (int i = 0; i < keywordDocs.size(); i++) {
        EsDocumentChunk doc = keywordDocs.get(i);
        String docId = doc.getId();
        // 获取元数据中的chunkId
        String chunkId = doc.getMetadata().getOrDefault("chunkId", "unknown").toString();
        idToChunkId.put(docId, chunkId);
        // 排名从1开始
        int rank = i + 1;
        double score = 1.0 / (K + rank);
        rrfScores.put(docId, rrfScores.getOrDefault(docId, 0.0) + score);
    }

    // 收集所有文档ID并按RRF得分降序排序，同时限制返回topK条
    List<String> sortedDocIds = rrfScores.entrySet().stream()
            .sorted(Map.Entry.<String, Double>comparingByValue().reversed())
            .map(Map.Entry::getKey)
            .limit(topK)
            .collect(Collectors.toList());

    // 打印每个文本块的chunkId和分数
    String scoresLog = sortedDocIds.stream()
            .map(docId -> {
                String chunkId = idToChunkId.getOrDefault(docId, "unknown");
                double score = rrfScores.getOrDefault(docId, 0.0);
                return String.format("chunkId: %s, RRF Score: %.4f", chunkId, score);
            })
            .collect(Collectors.joining("; "));

    log.info("RRF融合后top{}结果：{}", topK, scoresLog);

    // 构建文档ID到内容的映射
    Map<String, String> idToContent = new HashMap<>();
    vectorDocs.forEach(doc -> idToContent.putIfAbsent(doc.getId(), doc.getText()));
    keywordDocs.forEach(doc -> idToContent.putIfAbsent(doc.getId(), doc.getContent()));

    // 按排序后的ID提取文档内容
    return sortedDocIds.stream()
            .map(idToContent::get)
            .filter(Objects::nonNull)
            .collect(Collectors.toList());
}
```

我们修改一下打印的日志内容，可以明显看到重排序的效果：

```text
@GetMapping("/hybridchat")
public String hybridchat(@RequestParam("query") String query) throws Exception {
    log.info("========开始执行混合检索===========");
    // 1. 向量检索获取相似文档
    List<Document> vectorDocs = embeddingService.similarSearch(query);
    log.info("向量查询检索到 {} 个相关文档，chunkId列表：{}",
            vectorDocs.size(),
            vectorDocs.stream()
                    .map(doc -> doc.getMetadata().getOrDefault("chunkId", "unknown").toString())
                    .collect(Collectors.joining(", ")));


    // 2. ES 关键词检索
    List<EsDocumentChunk> keywordDocs = esRagService.searchByKeyword(query, 5, true);
    log.info("ES 关键词查询检索到 {} 个相关文档，chunkId列表：{}",
            keywordDocs.size(),
            keywordDocs.stream()
                    .map(doc -> doc.getMetadata().getOrDefault("chunkId", "unknown").toString())
                    .collect(Collectors.joining(", ")));

    // 3. 根据 id 去重并合并文档
    Map<String, String> idToContent = new LinkedHashMap<>();

    // 向量检索文档
    for (Document doc : vectorDocs) {
        idToContent.putIfAbsent(doc.getId(), doc.getText());
    }

    // ES 关键词检索文档
    for (EsDocumentChunk doc : keywordDocs) {
        idToContent.putIfAbsent(doc.getId(), doc.getContent());
    }

    List<String> mergedContents = rrfFusion(vectorDocs, keywordDocs, 5);
    log.info("RRF 融合后共 {} 个相关文档块。", mergedContents.size());

//        List<String> mergedContents = new ArrayList<>(idToContent.values());
//        log.info("共检索到 {} 个相关文档块（向量 + 关键词融合）。", mergedContents.size());

    // 4. 构建提示词模板
    String promptTemplate = """
            请基于以下提供的参考文档内容，回答用户的问题。
            如果参考文档中没有相关信息，请直接说明"没有找到相关信息"，不要编造内容。
            如果有了参考文档内容，请务必尽量回答问题。有可能用户的输入比较随意，你可以先尝试回答用户的问题，猜测他的实际需求，先给出回复，你需要尽量去贴合用户的问题需求。
                            
            参考文档:
            {documents}
                            
            用户问题: {question}
                           
            """;

    // 5. 拼接文档内容
    String documentContent = String.join("\n\n=========文档分隔线===========\n\n", mergedContents);
    log.info("查询到的文档信息：{}", documentContent);

    // 6. 填充模板参数
    PromptTemplate prompt = new PromptTemplate(promptTemplate);
    Prompt realPrompt = prompt.create(Map.of("documents", documentContent, "question", query));

    // 7. 调用大模型生成回答
    String text = chatClient.prompt(realPrompt).call().chatResponse().getResult().getOutput().getText();

    return text;
}
```

![](assets/d277104d9ba4.png)

向量检索的文本块排序是0、5、25、15、4，而ES检索的排序是15、25、0、26、3，重排序融合之后的排序就是0、15、25、5、26。

ReRank模型

ReRank 模型是检索流程中的关键组件，作用是对初步检索得到的候选文档进行二次精细排序。它能深入理解查询与文档的语义关联，比传统检索方法更精准地判断相关性，从而提升检索结果的质量。

主要流程就是先通过向量检索、关键词检索等方式获取一批候选文档，再由 ReRank 模型对这些文档重新排序，最终输出最相关的结果。

以 qwen3-rerank 为例，下面演示一下如何来做重排序。

```text
/**
 * 使用qwen3-rerank重排序
 */
private List<String> rerankFusion(List<Document> vectorDocs, List<EsDocumentChunk> keywordDocs, String query, int topK) throws Exception {
    Map<String, String> idToContent = new LinkedHashMap<>();
    Map<String, String> idToChunkId = new HashMap<>();

    vectorDocs.forEach(doc -> {
        String docId = doc.getId();
        idToContent.putIfAbsent(docId, doc.getText());
        String chunkId = doc.getMetadata().getOrDefault("chunkId", docId).toString();
        idToChunkId.putIfAbsent(docId, chunkId);
    });

    keywordDocs.forEach(doc -> {
        String docId = doc.getId();
        idToContent.putIfAbsent(docId, doc.getContent());
        String chunkId = doc.getMetadata().getOrDefault("chunkId", docId).toString();
        idToChunkId.putIfAbsent(docId, chunkId);
    });

    List<String> documents = new ArrayList<>(idToContent.values());
    if (documents.isEmpty()) {
        log.info("没有检索到任何文档，无需重排序");
        return Collections.emptyList();
    }

    String url = "https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank";
    HttpHeaders headers = new HttpHeaders();
    // 补充自己的apikey
    headers.set("Authorization", "Bearer sk-xxxxxxxxxxxxxxxxxx");
    headers.setContentType(MediaType.APPLICATION_JSON);

    Map<String, Object> requestBody = new HashMap<>();
    requestBody.put("model", "qwen3-rerank");

    Map<String, Object> input = new HashMap<>();
    input.put("query", query);
    input.put("documents", documents);
    requestBody.put("input", input);

    Map<String, Object> parameters = new HashMap<>();
    parameters.put("return_documents", true);
    parameters.put("top_n", topK);
    parameters.put("instruct", "Given a web search query, retrieve relevant passages that answer the query.");
    requestBody.put("parameters", parameters);

    HttpEntity<Map<String, Object>> request = new HttpEntity<>(requestBody, headers);
    RestTemplate restTemplate = new RestTemplate();
    restTemplate.setRequestFactory(new SimpleClientHttpRequestFactory() {{
        setConnectTimeout(5000);
        setReadTimeout(10000);
    }});

    ResponseEntity<Map> response = restTemplate.postForEntity(url, request, Map.class);

    if (!response.getStatusCode().is2xxSuccessful()) {
        throw new RuntimeException("重排序API调用失败: " + response.getStatusCode() + "，响应: " + response.getBody());
    }

    Map<String, Object> responseBody = response.getBody();
    if (responseBody == null || !responseBody.containsKey("output")) {
        throw new RuntimeException("API响应格式异常，缺少output字段: " + responseBody);
    }

    Map<String, Object> output = (Map<String, Object>) responseBody.get("output");
    List<Map<String, Object>> rerankedResults = (List<Map<String, Object>>) output.get("results");
    if (rerankedResults == null || rerankedResults.isEmpty()) {
        log.warn("重排序返回空结果: {}", output);
        return Collections.emptyList();
    }

    List<String> result = new ArrayList<>();
    List<String> rankLogs = new ArrayList<>();

    for (int i = 0; i < rerankedResults.size(); i++) {
        Map<String, Object> item = rerankedResults.get(i);
        String text = (String) ((Map<String, Object>) item.get("document")).get("text");
        Double score = null;
        if (item.containsKey("relevance_score")) {
            score = ((Number) item.get("relevance_score")).doubleValue();
        } else if (item.containsKey("score")) {
            score = ((Number) item.get("score")).doubleValue();
        }

        if (text != null) {
            result.add(text);

            String matchedChunkId = "unknown";
            for (Map.Entry<String, String> entry : idToContent.entrySet()) {
                if (entry.getValue().equals(text)) {
                    matchedChunkId = idToChunkId.getOrDefault(entry.getKey(), "unknown");
                    break;
                }
            }

            rankLogs.add(String.format("排名 %d: chunkId=%s, 分数=%.4f",
                    i + 1, matchedChunkId, score != null ? score : 0.0));
        }
    }

    log.info("qwen3-rerank重排序结果：{}", String.join("; ", rankLogs));
    log.info("重排序后返回{}条文档，原始合并{}条", result.size(), documents.size());

    return result;
}
```

![](assets/8157ed175304.png)

![](assets/3909c25b2820.png)

需要注意的是，ReRank 模型通常基于专门训练的**语义匹配模型**（如 Cross-Encoder 或特化的语义排序模型），它会同时输入**“查询 + 文本”**进行相关性评分，因此本质上**更偏向于语义层面的匹配**。这种语义优势也可能带来潜在问题：当结合关键词检索与向量检索做混合检索时，ReRank 模型可能更倾向于提升语义相似度高的文档排序，从而弱化那些虽然关键词匹配度高但语义表达不强的结果。

总结

重排序用于对初筛结果进行精细优化，通过更复杂的相关性模型对候选文档进行重新排序，其核心价值在于提升结果的排序精度，特别适用于问答系统和精准信息检索等对结果准确性要求较高的场景。

在实际应用中，重排序可以灵活地部署在各种 RAG 架构的最终环节，根据具体业务需求进行调整。归根结底，它的目标是在响应速度与回答质量之间找到最佳平衡，从而最大化知识问答的实用价值。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6975eca674e40300011cc628
