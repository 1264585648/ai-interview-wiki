---
title: "✅RAG优化技术：查询路由"
---

# ✅RAG优化技术：查询路由

![image.png](assets/8ab2a64eb5d9.png)

RAG到这里，相信很多人都有了一些基本的了解了，但是其实我想说，还不够。

在回顾一下RAG的概念：

RAG（Retrieval-Augmented Generation，检索增强生成）从外部知识源中检索相关信息，将相关的知识注入LLM中，使LLM能够回答超出预训练数据之外的问题，并提高生成内容的质量和相关性。

从外部知识库检索知识，但是这个外部知识库，就一定是向量数据库么？不一定！这个检索就一定是向量检索么？也不一定！

数据源路由

举个简单的例子，如果我们想要基于RAG技术做一个企业内部的知识库，我们知道，企业内部的知识，有一些是文档的，这些我们可以通过向量数据库来检索。但是企业里面的一些组织架构信息呢？服务器的部署情况呢？企业里面的这些可不在文档中哦。只靠向量数据库肯定是不行的。

所以，在RAG中，还可以通过其他的数据库查询，比如图数据库、向量数据库、关系型数据库都可以。于是，就有一个Query Routing的手段，把用户的请求转发到不同的数据库上面去查询。

![](assets/4bff4b30f5e5.png)

以下是三个不同的数据库服务：

```text
import org.springframework.stereotype.Service;

@Service
public class GraphDatabaseService {

    public String searchGraphDatabase(String query) {
        return "图数据库搜索结果: 基于关系图谱，找到与'" + query + "'相关的实体关系和路径。" +
                "这里模拟返回了知识图谱的实体关联结果，实际应用中会连接到Neo4j、ArangoDB或Amazon Neptune等图数据库。";
    }
}
```

```text
import org.springframework.stereotype.Service;

@Service
public class RelationalDatabaseService {

    public String searchRelationalDatabase(String query) {
        return "关系型数据库搜索结果: 基于结构化查询，找到与'" + query + "'匹配的数据记录。" +
                "这里模拟返回了SQL查询结果，实际应用中会连接到MySQL、PostgreSQL或Oracle等关系型数据库进行精确查询和统计分析。";
    }
}
```

```text
import org.springframework.stereotype.Service;

@Service
public class VectorDatabaseService {

    public String searchVectorDatabase(String query) {
        return "向量数据库搜索结果: 基于语义相似性，找到与'" + query + "'相关的文档片段。" +
                "这里模拟返回了相关的嵌入向量匹配结果，实际应用中会连接到真实的向量数据库如Chroma、Milvus、Faiss等。";
    }
}
```

再定义一个意图识别的方法，通过LLM做意图识别：

```text
@Service
public class QueryRouteService {

    private static final String DATASOURCE_ROUTE_PROMPT =
            """
                你需要判断用户的查询问题适合使用哪种数据库进行检索。
                如果是语义相似性搜索、文档检索、内容推荐类问题，回答'VECTOR'
                如果是关系查询、知识图谱、实体关联类问题，回答'GRAPH'
                如果是结构化数据查询、统计分析、精确匹配类问题，回答'RELATIONAL'
                如果无法确定，请回答'VECTOR'
                只回答VECTOR、GRAPH或RELATIONAL，不要其他内容。
                
                用户问题：
                {QUESTION}
                """;


    @Autowired
    private ChatModel chatModel;

    public String route(String query) {
        PromptTemplate promptTemplate = new PromptTemplate(DATASOURCE_ROUTE_PROMPT);
        promptTemplate.add("QUESTION", query);

        return chatModel.call(promptTemplate.create()).getResult().getOutput().getText();
    }

}
```

根据用户的问题，决策出要调具体的数据库服务。

在通过一个方法把他们串联起来：

```text
@RequestMapping("/rag/routing")
@RestController
public class RagQueryRoutingController {

    @Autowired
    private RagQueryRoutingService ragRoutingService;

    @Autowired
    private VectorDatabaseService vectorDatabaseService;

    @Autowired
    private GraphDatabaseService graphDatabaseService;

    @Autowired
    private RelationalDatabaseService relationalDatabaseService;

    @RequestMapping("/query")
    public String ragQuery(HttpServletResponse response, @RequestParam String question) {
        response.setCharacterEncoding("UTF-8");

        String databaseType = ragRoutingService.routeDataSource
(question);

        String result;
        switch (databaseType.trim()) {
            case "VECTOR":
                result = vectorDatabaseService.searchVectorDatabase(question);
                break;
            case "GRAPH":
                result = graphDatabaseService.searchGraphDatabase(question);
                break;
            case "RELATIONAL":
                result = relationalDatabaseService.searchRelationalDatabase(question);
                break;
            default:
                result = "无法确定合适的数据库类型，默认使用向量数据库: " +
                        vectorDatabaseService.searchVectorDatabase(question);
        }

        return String.format("路由到: %s 数据库\n\n查询结果:\n%s", databaseType, result);
    }
}
```

Prompt路由

还有一种路由，也比较常见。那就是对提示词做路由。为了避免固定的提示词效果不好，我们可以提前定义好多个提示词，让后在用户提问的过程中，针对用户问题，先通过LLM来分析一下适合用哪个提示词。

比如你有以下两个提示词：

Prompt 1：你是一个专业的医生，可以从专业的医疗角度给出患者建议。

Prompt 2：你是一个专业的药学专家，掌握丰富的药品知识，能够在用药方面给出更好的建议。

我们在构建一个医疗AI助手的时候，就可以做提示词的路由。根据用户是询问病情还是用药建议，使用不同的提示词。

先定义几个方法，提供不同的系统提示词：

(以下代码在langchain4j这个module下面，用了langchain4j的api）

```text
import dev.langchain4j.service.SystemMessage;
import dev.langchain4j.service.spring.AiService;
import reactor.core.publisher.Flux;

@AiService
public interface MedicalPromptRoutingService {

    @SystemMessage("你是一个专业的医生，可以从专业的医疗角度给出患者建议。")
    Flux<String> doctorConsultation(String userMessage);

    @SystemMessage("你是一个专业的药学专家，掌握丰富的药品知识，能够在用药方面给出更好的建议。")
    Flux<String> pharmacistConsultation(String userMessage);

    @SystemMessage("你需要判断用户的询问是关于病情咨询还是用药建议。如果是询问病情、症状、诊断相关的问题，回答'DOCTOR'。如果是询问药物、用药方法、药物副作用相关的问题，回答'PHARMACIST'。只回答DOCTOR或PHARMACIST，不要其他内容。")
    String determineConsultationType(String userMessage);
}
```

上面还提供了一个determineConsultationType方法，用来做意图识别的，识别出用户是咨询病情还是用药建议。并且要求模型回答DOCTOR或PHARMACIST

在下面，先调用这个determineConsultationType针对用户的问题做意图识别，然后再根据识别结果，决定调用doctorConsultation还是pharmacistConsultation方法：

```text
@RequestMapping("/medical")
@RestController
public class MedicalAssistantController {

    @Autowired
    private MedicalPromptRoutingService medicalRoutingService;

    @RequestMapping("/consultation")
    public Flux<String> medicalConsultation(HttpServletResponse response, @RequestParam String question) {
        response.setCharacterEncoding("UTF-8");

        String consultationType = medicalRoutingService.determineConsultationType(question);

        if ("DOCTOR".equals(consultationType.trim())) {
            return medicalRoutingService.doctorConsultation(question);
        } else if ("PHARMACIST".equals(consultationType.trim())) {
            return medicalRoutingService.pharmacistConsultation(question);
        } else {
            return medicalRoutingService.doctorConsultation(question);
        }
    }
}
```

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6975ecff3fb918000105b01c
