---
title: "✅景点RAG&差旅指南RAG的接入"
---

# ✅景点RAG&差旅指南RAG的接入

InfoAgent 要回答的问题大致可以分成两类。

**第一类是事实/语义型问题**，例如：

“杭州有哪些适合商务出差间隙逛的景点？” “差旅管理制度对超标住宿是怎么规定的？” “报销需要准备哪些材料？”

这类问题的答案分散在制度文档、景点资料、注意事项里，没有唯一结构化字段可以查。用 RAG 把相关段落召回后交给 LLM 组织语言，是最自然的做法。

**第二类是精确型问题**，例如：

“我去杭州的住宿标准是多少？” “我订的酒店 600 元一晚，超标吗？”

这类问题需要绑定用户职级和城市等级，返回具体数字或合规结论，由 PolicyTools 精确通道处理，不在 RAG 的职责范围内（详见 [77-✅差旅政策的双通道支持.md?spm=a2cl9.thoughts_devops2020_goldlog_.0.0.54985262vTk1rQ](77-✅差旅政策的双通道支持.md?spm=a2cl9.thoughts_devops2020_goldlog_.0.0.54985262vTk1rQ)）。

因此 RAG 在 InfoAgent 里的定位是：**回答“制度怎么写 / 景点有什么 / 出差要注意什么”这类语义型问题，而不回答“我具体额度是多少”这类精确型问题。**

RagKnowledgeConfig

```text
@Configuration
public class RagKnowledgeConfig {

    /**
     * text-embedding-v4 默认输出 1024 维向量；显式声明并同时传给 embedding 与 InMemoryStore，
     * 避免将来升级 embedding 模型/维度时两端静默错位（与 {@link IntentRouterKnowledgeConfig} 同约定）。
     */
    private static final int EMBEDDING_DIM = 1024;

    @Value("${agentscope.dashscope.api-key}")
    private String apiKey;

    @Value("${agentscope.bailian.access-key-id}")
    private String accessKeyId;

    @Value("${agentscope.bailian.access-key-secret}")
    private String accessKeySecret;

    @Value("${agentscope.bailian.workspace-id}")
    private String workspaceId;

    @Value("${agentscope.bailian.index-id}")
    private String indexId;
```

我们的项目中，分别使用了云端知识库和本地知识库两个方案，云端 RAG 适合“数据量大、愿意把索引和召回交给云厂商”的场景；本地 RAG 适合“数据量小、需要版本跟随代码一起管理、对延迟敏感”的场景。

| 维度 | 云端 RAG | 本地 RAG |
| --- | --- | --- |
| **数据存放** | 语料上传百炼控制台，索引在云端 | 语料放在代码仓库，索引在应用内存 |
| **Embedding** | 百炼服务端自动完成，无需应用端维护 | 应用启动时调用DashScopeTextEmbedding自己生成向量 |
| **召回能力** | **支持云端向量检索、重排序、多轮 query 改写、metadata 过滤** | 仅InMemoryStore的余弦相似度检索，功能较基础 |
| **典型延迟** | 多一次 HTTP 调用，受网络抖动影响 | **纯内存计算，延迟低且稳定** |
| **适用语料** | **大规模、多模态、需要频繁更新的数据（如景点 Excel）** | **小规模、版本可控、静态的制度/指南文档** |
| **运维方式** | 更新语料需登录百炼控制台重新上传 | 更新 docx 后重新打包部署即可 |
| **启动依赖** | 启动时不依赖该库数据，运行时才调用 | 启动期必须成功解析并 embedding，否则应用起不来 |
| **可观测性** | 依赖百炼侧日志，应用端只能看到入参/出参 | 应用内全链路可控，chunk、embedding、score 都能拿到 |
| **成本结构** | 百炼存储 + 检索调用费用 | DashScope embedding 调用费用 + 应用内存占用 |
| **当前风险点** | 索引与代码版本不同步；外部服务抖动会影响召回 | InMemoryStore不持久化，重启要重新 embedding；语料变大后启动变慢 |

BailianKnowledge（云端）知识库

```text
    @Bean(name = "attractionKnowledge")
    public Knowledge attractionKnowledge() {
        BailianConfig config =
                BailianConfig.builder()
                        .accessKeyId(accessKeyId)
                        .accessKeySecret(accessKeySecret)
                        .workspaceId(workspaceId)
                        .build();

        return BailianKnowledge.builder()
                .config(config)
                .indexId(indexId)
                .build();
    }
```

景点知识库走**百炼云端**：

- 语料源是 src/main/resources/dataset/tourist_attraction.xlsx，需要事先上传到百炼控制台建立索引；
- 运行时不做本地 embedding，查询直接调用百炼检索 API，由云端完成向量化、召回、可选重排序；

SimpleKnowledge（本地 docx）知识库

```text
    @Bean(name = "corporateTravelPolicyKnowledge")
    public Knowledge corporateTravelPolicyKnowledge(@Value("classpath:dataset/business_travel_policy.docx") Resource policyResource) {
        return buildDocxKnowledge(policyResource, "dataset/business_travel_policy.docx");
    }

    @Bean(name = "corporateTravelGuidelinesKnowledge")
    public Knowledge corporateTravelGuidelinesKnowledge(@Value("classpath:dataset/business_travel_guidelines.docx") Resource fileResource) {
        return buildDocxKnowledge(fileResource, "dataset/business_travel_guidelines.docx");
    }
```

这两个知识库使用**本地 docx + 内存向量库**的架构，区别在于语料文件不同：

- business_travel_policy.docx：差旅管理制度原文；
- business_travel_guidelines.docx：差旅注意事项 / 行为准则。

它们共享同一个私有构建方法 buildDocxKnowledge。

```text
private Knowledge buildDocxKnowledge(Resource resource, String label) {
        DashScopeTextEmbedding embedding = DashScopeTextEmbedding.builder()
                .modelName("text-embedding-v4")
                .dimensions(EMBEDDING_DIM)
                .apiKey(apiKey)
                .build();

        SimpleKnowledge knowledge = SimpleKnowledge.builder()
                .embeddingStore(InMemoryStore.builder().dimensions(EMBEDDING_DIM).build())
                .embeddingModel(embedding)
                .build();

        WordReader reader = new WordReader();
        try {
            File docxFile = resource.getFile();
            List<Document> docs = reader.read(ReaderInput.fromPath(docxFile.toPath())).block();
            knowledge.addDocuments(docs).block();
        } catch (Exception e) {
            // 资源缺失或解析失败时主动报错，提示开发者补齐语料
            throw new IllegalStateException(
                    "从 classpath 读取 [" + label + "] 失败，请确认文件存在于 src/main/resources/dataset/ 目录下。", e);
        }

        return knowledge;
    }
```

整个流程可以概括为四步：

1. **创建 embedding 模型**：DashScopeTextEmbedding 使用 text-embedding-v4，维度 1024；
2. **创建向量存储**：InMemoryStore 内存存储，维度同样显式设为 1024；
3. **解析 docx**：WordReader 把 Word 文档按段落 / 表格切分成 Document chunk；
4. **启动期同步写入**：knowledge.addDocuments(docs).block() 在 Spring 容器启动时阻塞完成 embedding 和入库。

因为 docx 语料很小，embedding 耗时可控，项目选择“启动时就把全部语料写进内存向量库”。

把知识库注册进 Agent

```text
@Configuration("infoAgentConfiguration")
public class InfoAgent extends BaseSubAgent {

    @Autowired
    @Qualifier("attractionKnowledge")
    protected Knowledge attractionKnowledge;

    @Autowired
    @Qualifier("corporateTravelPolicyKnowledge")
    protected Knowledge corporateTravelPolicyKnowledge;

    @Autowired
    @Qualifier("corporateTravelGuidelinesKnowledge")
    protected Knowledge corporateTravelGuidelinesKnowledge;

    @Bean(name = "infoAgent")
    @Scope("prototype")
    public ReActAgent build() {
        Toolkit toolkit = new Toolkit();
        // ... 注册 policyTools / MCP 工具等 ...

        ReActAgent agent = ReActAgent.builder()
                .name("InfoAgent")
                .description("信息查询助手，负责查询差旅政策标准、目的地旅游景点、签证入境政策及通用公共信息")
                .model(stableModel)
                // 挂载三个 RAG 知识库
                .knowledge(attractionKnowledge)
                .knowledge(corporateTravelPolicyKnowledge)
                .knowledge(corporateTravelGuidelinesKnowledge)
                .toolExecutionConfig(getToolConfig())
                .ragMode(RAGMode.AGENTIC)   // 由 LLM 主动决定何时检索
               
                .build();

        return agent;
    }
}
```

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a7b4255c71a890001994275
