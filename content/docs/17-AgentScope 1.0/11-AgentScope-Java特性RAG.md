---
title: "✅AgentScope Java特性：RAG"
---

# ✅AgentScope Java特性：RAG

（虽然在ASJ的2.0的relesse note中提到：RAG (`Knowledge` / `KnowledgeRetrievalTools` / `RAGMode`) and long-term memory modules deprecated — being rewritten on the v2 architecture; don't depend on them in new code`，但是截止目前，2.0还没正式发布，也没给出替代方案，我们先讲1.0的方案和用法，后续新版本更新了我能再单独讲方案和用法）

三个核心抽象

ASJ中针对RAG做了抽象，其中比较核心的就是Knowledge / Document / RetrieveConfig这三个。整个 RAG 子系统就由这三个类（接口）驱动，其它都是装饰。

**Knowledge** 接口只有两个方法：

```text
public interface Knowledge {

    Mono<Void> addDocuments(List<Document> documents);

    Mono<List<Document>> retrieve(String query, RetrieveConfig config);
}
```

整个 RAG 子系统就建立在这个接口上，**所有上游（Hook、Tool、Bailian/Dify 等扩展）都只依赖它**。这意味着：

- 写自己的接入：你只要实现 Knowledge 就能塞到 ReActAgent 里跑。
- 想换底座：把 SimpleKnowledge 换成 BailianKnowledge、DifyKnowledge 即可，无需动 Agent 代码。

也就是说，ASJ其实内置了很多RAG系统的支持，包括百炼、Dify、RAGFlow等。

**Document **用来表示在RAG系统的每一个chunk，他的定义如下：

```text
public class Document {

    private final String id;
    private final DocumentMetadata metadata;
    private double[] embedding;
    private Double score;
    private String vectorName;
}
```

DocumentMetadata 内部装的是一个 **ContentBlock**——agentscope 统一的多模态块类型（TextBlock / ImageBlock 等）。这个设计让"文本块"和"图片块"共用一条 RAG 管线。

**RetrieveConfig** 用来配置检索参数：

```text
RetrieveConfig.builder()
    .limit(5)                       // top-k，默认 5
    .scoreThreshold(0.5)            // 相似度阈值，默认 0.5
    .vectorName("doc_v1")           // 向量空间名（可选，用于隔离不同 corpus）
    .conversationHistory(history)   // 多轮上下文（百炼会用它做 query rewrite）
    .build();
```

两种 RAG 模式

这是 agentscope 给业务方提供的"插法选择"，对应 RAGMode 枚举：

```text
public enum RAGMode {
    /**
     * Generic mode: Knowledge is automatically retrieved and injected
     * before each reasoning step via Hook.
     *
     * <p>In this mode, the system automatically retrieves relevant knowledge
     * based on user queries and injects it into the prompt context.
     */
    GENERIC,

    /**
     * Agentic mode: Agent decides when to retrieve knowledge via Tool.
     *
     * <p>In this mode, the agent has a tool to retrieve knowledge and
     * actively decides when to use it based on the conversation context.
     */
    AGENTIC,

    /**
     * Disabled mode: No RAG functionality.
     *
     * <p>Knowledge retrieval is not enabled for this agent.
     */
    NONE
}
```

| 模式 | 触发方 | 注入位置 | 适合场景 |
| --- | --- | --- | --- |
| **GENERIC** | 框架（每次推理前自动） | inputMessages<br>末尾追加 user 消息 | FAQ / 知识助手，每条用户提问都需要查 |
| **AGENTIC** | LLM 自己决策 | 作为retrieve_knowledge工具结果回灌 | 多技能 Agent，RAG 是诸多工具之一 |
| **NONE** | — | — | 关掉 RAG |

Generic：

在 Generic 模式下，知识会自动检索并注入到用户的消息中，他的工作原理，和我们传统的RAG系统的流程是一样的：

1. 用户发送查询
2. 知识库自动检索相关文档
3. 检索到的文档被添加到用户消息之前
4. Agent 处理增强后的消息并响应

只不过这个检索和追加的动作内部实现了，通过GenericRAGHook作为核心实现：

```text
private Mono<PreCallEvent> handlePreCall(PreCallEvent event) {
    String query = extractQueryFromMessages(event.getInputMessages());
    if (query == null || query.isBlank()) return Mono.just(event);

    return knowledge.retrieve(query, defaultConfig)
        .flatMap(docs -> {
            if (docs.isEmpty()) return Mono.just(event);
            List<Msg> enhanced = new ArrayList<>(event.getInputMessages());
            enhanced.add(buildKnowledgeUserMsg(docs));   // 追加到末尾
            event.setInputMessages(enhanced);
            return Mono.just(event);
        })
        .onErrorResume(err -> {
            log.warn("Generic RAG retrieval failed: {}", err.getMessage());
            return Mono.just(event);                     // ← 失败兜底，不打断主流程
        });
}
```

Agentic

Agentic 其实是Agentic RAG的实现，也就是说让Agent来决策什么时候该调用RAG做检索，相当于把RAG当做一个工具。工作原理是：

1. 用户发送查询
2. Agent 推理并决定是否检索知识
3. 如果需要，Agent 调用 `retrieve_knowledge(query="...")`
4. 检索到的文档作为工具结果返回
5. Agent 使用检索到的信息再次推理

因为要作为一个工具，可想而知需要声明一个tool，他的实现是靠KnowledgeRetrievalTools实现的。

```text
@Tool(
        name = "retrieve_knowledge",
        description =
                "Retrieve relevant documents from knowledge base. Use this tool when you need"
                    + " to find specific information or when user asks questions about stored"
                    + " knowledge.")
public String retrieveKnowledge(
        @ToolParam(
                        name = "query",
                        description =
                                "The search query to find relevant documents in the knowledge"
                                        + " base")
                String query,
        @ToolParam(
                        name = "limit",
                        description = "Maximum number of documents to retrieve (default: 5)",
                        required = false)
                Integer limit,
        Agent agent) {

    // Set default value
    if (limit == null) {
        limit = 5;
    }

    // Extract conversation history from agent if available
    List<Msg> conversationHistory = null;
    if (agent instanceof ReActAgent reActAgent) {
        conversationHistory = reActAgent.getMemory().getMessages();
    }

    // Build retrieval config with conversation history
    RetrieveConfig config =
            this.defaultConfig
                    .mutate()
                    .limit(limit)
                    .conversationHistory(conversationHistory)
                    .build();

    return knowledge
            .retrieve(query, config)
            .map(this::formatDocumentsForTool)
            .onErrorReturn("Failed to retrieve knowledge for query: " + query)
            .block(); // Convert to synchronous call to match Tool interface
}
```

Agent agent 参数**不是 @ToolParam**，而是**框架自动注入**当前 Agent。这样工具内部能拿到完整 agent 状态，把会话历史一并送进 RetrieveConfig。

上面的Hook和工具，是在ReActAgent构造的时候，自动配置进去的：io.agentscope.core.ReActAgent.Builder#configureRAG

```text
private void configureRAG(Toolkit agentToolkit) {
    // Aggregate knowledge bases if multiple are provided
    Knowledge aggregatedKnowledge;
    if (knowledgeBases.size() == 1) {
        aggregatedKnowledge = knowledgeBases.iterator().next();
    } else {
        aggregatedKnowledge = buildAggregatedKnowledge();
    }

    // Configure based on mode
    switch (ragMode) {
        case GENERIC -> {
            // Create and add GenericRAGHook
            GenericRAGHook ragHook =
                    new GenericRAGHook(aggregatedKnowledge, retrieveConfig);
            hooks.add(ragHook);
        }
        case AGENTIC -> {
            // Register knowledge retrieval tools
            KnowledgeRetrievalTools tools =
                    new KnowledgeRetrievalTools(aggregatedKnowledge, retrieveConfig);
            agentToolkit.registerTool(tools);
        }
        case NONE -> {
            // Do nothing
        }
    }
}
```

文档处理支持

Reader

ASJ中内置了很多Reader用来读取不同的类型的文档

| Reader | 作用 |
| --- | --- |
| TextReader | 直接吃 String 或文件 |
| PDFReader | PDFBox 解析，按页拼文本 |
| WordReader | POI 解析 .docx |
| TikaReader | Apache Tika 万能解析（PPT/HTML/Markdown 等） |
| ImageReader | 图片 → ImageBlock，配合多模态 embedding |
| ExternalApiReader | 调外部 OCR / parsing API |

这里的实现还是比较简单了，比如PDF还是用PDFBox，Word还是用POI的。效果一般。

Chunker

ASJ中内置了TextChunker用来做文档分段。支持以下几种分段策略：

| 策略 | 实现 |
| --- | --- |
| CHARACTER | 按字符数硬切，可能断词 |
| PARAGRAPH | 按`\n\s*\n`  切段；段落之间累加直到超过 chunkSize；单段超长再降级到 character 切 |
| TOKEN | 用`1 token ≈ 4 chars` 的简单启发式换算成 character 切 |
| SEMANTIC | **当前未实现，回退到 PARAGRAPH** |

EmbeddingModel

内置了EmbeddingModel接口以及默认实现，来做embedding。

```text
public interface EmbeddingModel {


    Mono<double[]> embed(ContentBlock block);


    String getModelName();

 
    int getDimensions();
}
```

embed()方法支持传入ContentBlock，他也有多种实现，比如文本是 TextBlock，图片走多模态实现传 ImageBlock，**两者复用同一接口**。

有多重默认实现：DashScopeTextEmbedding / DashScopeMultiModalEmbedding / OpenAITextEmbedding / OllamaTextEmbedding。（需要配置apikey等）

VDBStoreBase

向量数据库也提供了抽象：

```text
public interface VDBStoreBase {

    Mono<Void> add(List<Document> documents);

    Mono<List<Document>> search(SearchDocumentDto searchDocumentDto);

    Mono<Boolean> delete(String id);
}
```

有以下5个默认实现：

| Store | 适用 |
| --- | --- |
| InMemoryStore | 开发/小数据集；<br>ConcurrentHashMap&lt;String,Document&gt;<br>+ 余弦相似度 |
| PgVectorStore | PostgreSQL + pgvector 扩展 |
| QdrantStore | Qdrant |
| MilvusStore | Milvus |
| ElasticsearchStore | ES（dense_vector） |

Demo

GENERIC + SimpleKnowledge

这种比较适合在类似我们dodo-agent中用户上传文档做问答的场景。

先要增加配置依赖。后面我们要用的TextEmbedding默认是不在ASJ的核心包里面的。

```text
<dependency>
    <groupId>com.alibaba</groupId>
    <artifactId>dashscope-sdk-java</artifactId>
    <version>2.22.9</version>
    <exclusions>
        <exclusion>
            <groupId>org.slf4j</groupId>
            <artifactId>slf4j-simple</artifactId>
        </exclusion>
        <exclusion>
            <groupId>org.projectlombok</groupId>
            <artifactId>lombok</artifactId>
        </exclusion>
    </exclusions>
</dependency>

<dependency>
   <groupId>com.aliyun</groupId>
   <artifactId>bailian20231229</artifactId>
   <version>2.13.1</version>
</dependency>
```

```text

import io.agentscope.core.ReActAgent;
import io.agentscope.core.embedding.EmbeddingModel;
import io.agentscope.core.embedding.dashscope.DashScopeTextEmbedding;
import io.agentscope.core.message.Msg;
import io.agentscope.core.message.MsgRole;
import io.agentscope.core.message.TextBlock;
import io.agentscope.core.model.DashScopeChatModel;
import io.agentscope.core.rag.RAGMode;
import io.agentscope.core.rag.knowledge.SimpleKnowledge;
import io.agentscope.core.rag.model.Document;
import io.agentscope.core.rag.reader.PDFReader;
import io.agentscope.core.rag.reader.ReaderInput;
import io.agentscope.core.rag.store.InMemoryStore;

import java.io.File;
import java.io.IOException;
import java.util.List;

public class LocalRagDemo {
    public static void main(String[] args) throws IOException {
        String apiKey = "sk-xxxxxxx";

        // 1. 起 Embedding + 内存向量库
        EmbeddingModel embed = DashScopeTextEmbedding.builder()
                .apiKey(apiKey).modelName("text-embedding-v3").dimensions(1024).build();
        InMemoryStore store = InMemoryStore.builder().dimensions(1024).build();
        SimpleKnowledge knowledge = SimpleKnowledge.builder()
                .embeddingModel(embed).embeddingStore(store).build();

        // 2. 灌数据（PDF）
        PDFReader reader = new PDFReader();
        File file = new File("/Users/hollis/LLM课程视频/RAG材料/Java八股文介绍.pdf");
        List<Document> docs = reader.read(ReaderInput.fromPath("/Users/hollis/LLM课程视频/RAG材料/Java八股文介绍.pdf")).block();
        knowledge.addDocuments(docs).block();

        // 3. 起 Agent，自动注入
        ReActAgent agent = ReActAgent.builder()
                .name("FAQBot")
                .sysPrompt("基于检索到的知识回答用户问题；若没找到请明确告知。")
                .model(DashScopeChatModel.builder()
                        .apiKey(apiKey)
                        .modelName("qwen-max")
                        .build())
                .knowledge(knowledge)
                .ragMode(RAGMode.GENERIC)     // 关键：自动 Hook
                .build();

        Msg msg = Msg.builder()
                .role(MsgRole.USER)
                .content(TextBlock.builder().text("这份JAVA八股文有哪些内容？").build())
                .build();
        System.out.println(agent.call(msg).block().getTextContent());
    }
}
```

使用第三方知识库

适合于那种你公司的知识库已经在百炼/Dify/RAGFlow 上维护，agent 只负责调用。

```text

import io.agentscope.core.ReActAgent;
import io.agentscope.core.embedding.EmbeddingModel;
import io.agentscope.core.embedding.dashscope.DashScopeTextEmbedding;
import io.agentscope.core.message.Msg;
import io.agentscope.core.message.MsgRole;
import io.agentscope.core.message.TextBlock;
import io.agentscope.core.model.DashScopeChatModel;
import io.agentscope.core.rag.RAGMode;
import io.agentscope.core.rag.integration.bailian.BailianConfig;
import io.agentscope.core.rag.integration.bailian.BailianKnowledge;
import io.agentscope.core.rag.knowledge.SimpleKnowledge;
import io.agentscope.core.rag.model.Document;
import io.agentscope.core.rag.reader.PDFReader;
import io.agentscope.core.rag.reader.ReaderInput;
import io.agentscope.core.rag.store.InMemoryStore;

import java.io.File;
import java.io.IOException;
import java.util.List;

public class BailianRagDemo {
    public static void main(String[] args) throws IOException {
        String apiKey = "sk-d221480c7a4c4b5aa45f67fa800e5da6";


        BailianConfig config =
                BailianConfig.builder()
                        .accessKeyId("xxx").accessKeySecret("xxx").workspaceId("llm-xxx")
                        .build();

        BailianKnowledge knowledge = BailianKnowledge.builder()
                .config(config)
                .indexId("xxx")
                .build();

        ReActAgent agent = ReActAgent.builder()
                .name("FAQBot")
                .sysPrompt("基于检索到的知识回答用户问题；若没找到请明确告知。")
                .model(DashScopeChatModel.builder()
                        .apiKey(apiKey)
                        .modelName("qwen-max")
                        .build())
                .knowledge(knowledge)
                .ragMode(RAGMode.AGENTIC)     // 关键：自动 Hook
                .build();

        Msg msg = Msg.builder()
                .role(MsgRole.USER)
                .content(TextBlock.builder().text("这份JAVA八股文有哪些内容？").build())
                .build();
        System.out.println(agent.call(msg).block().getTextContent());
    }
}
```

以上，是使用[阿里云百炼SDK](https://api.aliyun.com/api-tools/sdk/bailian?version=2023-12-29&language=java-tea&tab=primer-doc)调用知识库的检索能力，为我们的Agent提供检索服务。所需参数（参考文档[https://bailian.console.aliyun.com/cn-beijing?tab=doc#/doc/?type=app&url=2852772](https://bailian.console.aliyun.com/cn-beijing?tab=doc#/doc/?type=app&url=2852772) ）：

- accessKeyId
- accessKeySecret

过个人中心的AccessKey创建对应的accessKeyId和accessKeySecret

![](assets/9f5a3c7b5bf8.png)

![](assets/e16b69445b2e.png)

![](assets/8bf16e393a39.png)

- workspaceId

![](assets/3773f417df5c.png)

- indexId

![](assets/16aad713331b.png)

多知识库检索

如果一次回答需要从多个知识库检索，比如从FAQ、产品文档、技术手册同时检索：

```text
ReActAgent agent = ReActAgent.builder()
    .knowledge(productDocsKB)
    .knowledge(faqKB)
    .knowledge(internalWikiKB)            // 框架自动 buildAggregatedKnowledge
    .ragMode(RAGMode.GENERIC)
    .build();
```

这种情况，会触发ReActAgent.Builder中的buildAggregatedKnowledge做多路检索和合并、重排：

```text
private Knowledge buildAggregatedKnowledge() {
    return new Knowledge() {
        @Override
        public Mono<Void> addDocuments(List<Document> documents) {
            return Flux.fromIterable(knowledgeBases)
                    .flatMap(kb -> kb.addDocuments(documents))
                    .then();
        }

        @Override
        public Mono<List<Document>> retrieve(String query, RetrieveConfig config) {
            return Flux.fromIterable(knowledgeBases)
                    .flatMap(kb -> kb.retrieve(query, config))
                    .collectList()
                    .map(this::mergeAndSortResults);
        }

        private List<Document> mergeAndSortResults(List<List<Document>> allResults) {
            return allResults.stream()
                    .flatMap(List::stream)
                    .collect(
                            Collectors.toMap(
                                    Document::getId,
                                    doc -> doc,
                                    (doc1, doc2) ->
                                            doc1.getScore() != null
                                                            && doc2.getScore() != null
                                                            && doc1.getScore()
                                                                    > doc2.getScore()
                                                    ? doc1
                                                    : doc2))
                    .values()
                    .stream()
                    .sorted(
                            Comparator.comparing(
                                    Document::getScore,
                                    Comparator.nullsLast(Comparator.reverseOrder())))
                    .limit(retrieveConfig.getLimit())
                    .toList();
        }
    };
}
```

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a06c8073fb91800017aadd7
