---
title: "✅RAG优化技术：问题改写"
---

# ✅RAG优化技术：问题改写

![image.png](assets/95914e4e582c.png)

在RAG的**相似度检索**中，检索效果的好坏，很大程度取决于用户问题的表达方式。用户输入的提问是不可控的，**往往存在模糊、信息缺失、上下文依赖**等问题，难以直接高效地匹配到高质量的相关文档块。因此需要在检索前对用户输入的查询进行优化**，从而显著提高检索的准确率和最终生成答案的质量**。

而有一个常见的提升检索效果的优化手段，就是**问题重写（改写），他的目标就是：**

**让用户的自然语言提问，转化为更适合检索的查询表达。**

问题重写的策略有很多，这边给大家介绍的是三种主流的方法，基本可以涵盖绝大多数的场景，分别是：**富化、分解、多样化、回溯提示。**

分解（子问题）

分解是指将用户的**复杂、多步骤或包含多个子问题**的查询，拆解成若干个**相互独立、更简单、更具体**的子问题。每个子问题可以独立进行检索，最终将多个检索结果合并，用于回答原问题。

比如用户问：iPhone 15 发布的时候，苹果的 CEO 是谁？

这是一个典型的`多跳问题` ，直接去检索查询可能得不到合适的结果，那么通过把这个问题分解成多个子问题：

Q1：iPhone 15 是什么时候发布的？

Q2：2023 年 9 月时，苹果公司的 CEO 是谁？

再比如，Kafka和RocketMQ的异同点是什么？

这个问题就可以分解成多个子问题：

Q1：Kafka有哪些特性？

Q2：RocketMQ有哪些特性？

Q3：Kafka和RocketMQ的特性有哪些区别？

这就是通过分解的方式，在接收到用户请求后，先增加一个大模型调用，通过大模型对原始问题进行逻辑解析和拆分。

将拆分后的**子查询列表**分别进行检索，收集所有相关文档块。最后将所有文档块和原始问题一并输入给生成模型，得出最终答案。

Prompt示例

```text
# 角色
你是一名专业的查询逻辑分析专家。
 
# 任务
将给定的“用户原始问题”分解为一系列**相互独立、逻辑清晰**，且可单独用于检索的子查询列表。
你的输出必须是一个标准的JSON数组格式。
 
# 用户原始问题
{QUESTION}
 
# 输出格式要求 (JSON Array)
[
  "子查询1",
  "子查询2",
  "子查询3",
  "..."
]

（不强制要求数组元素个数，可根据真实情况输出，至少保留1个）
 
# 输出
请直接输出JSON数组，不要包含解释或多余的文字。
```

富化

富化是指在原始查询中**添加上下文信息、背景知识或必要的限制条件**，以消除歧义、补充缺失的信息，使查询更完整、更具体。

比如 ，用在对话中问：他有什么特点？

这里的"他"就是一种指代，我们需要通过**指代消除**的方式来让LLM知道他到底是什么。

所以，一般富化的场景主要用在当用户表达模糊或包含历史对话问题，且省略了主语或关键信息时（存在指定性表述）。或者是问题中缺少历史对话细节（例如，增加时间、地点、实体等限制，缩小检索范围。），或者是用到了某个专业术语的简称的时候。

实现方式就是在接收到用户请求的问题后，先增加一个大模型调用，通过大模型对用户的原始问题进行重写。将重写丰富过后的问题，再进行相似度检索，继续后续流程。

Prompt示例

```text
# 角色
你是一个专业的问题重写优化器。

# 任务
根据提供的“对话历史”和“用户原始问题”，重写为一个独立、完整、且包含所有必要背景信息的新查询，用于RAG检索。

## 对话历史： 
{CHAT_HISTORY}

## 原始问题： 
{QUESTION}

# 输出
输出富化过后的新问题，不要包含多余的解释性内容
```

多样化

多样化是指对同一个用户查询生成多个**多个语义相近或相关**的变体，以提升对知识库内容描述多样性的覆盖，从而增强召回率。主要应对以下情况：

1. **描述风格不一致**：文档的表述方式不同，如有的是“接口性能优化”，有的是“提升接口响应速度”。
2. **用户表述差异性**：不同用户的表达方式习惯不同。

在接收到用户请求后，先增加一个大模型调用，通过大模型为原始问题生成多个**语义相近但措辞不同**的查询变体。

将原始查询和所有变体并行进行检索。汇聚所有的检索结果，得到全部文档块，**去重**后用于后续生成。

Prompt示例

```text
# 角色
你是一名专业的语义扩展专家。
 
# 任务
为给定的“原始问题”生成**3个**语义相同但**措辞完全不同、且利于检索**的查询变体，以提高检索的召回率。
你的输出必须是一个标准的JSON数组格式。
 
# 原始问题
{QUESTION}

# 输出格式要求 (JSON Array)
[
  "变体1",
  "变体2",
  "变体3"
]
 
# 输出
输出富化过后的新问题，不要包含多余的解释性内容
```

回溯提示

所谓回溯提示，是从Step-Back Prompting 翻译过来的，它的核心思想是**先引导模型“后退一步”，从具体问题中抽象出更一般的原理、概念或背景知识；再基于这些抽象信息进行推理或检索，最终回答原始问题。**

比如你做了一个企业内部知识库，有人提问：`我老舅结婚，我可以请几天假去参加她的婚礼。`

这个问题知识库就很难回答，因为他太具体了，需要做**step back**，即把他转换成更抽象的问题：`探亲假的请假政策是怎么样的？`

然后使用这个抽象问题抽象问题（或与原始问题结合）去向知识库检索相关信息。再将检索到的通用背景知识与原始具体问题结合，由 LLM 生成更准确、有深度的回答。

Prompt示例

```
# 角色
你是一个擅长抽象思维和原理推理的专家。
            
# 任务
请根据用户提出的具体问题，先“后退一步”，将其转化为一个更通用、更本质的问题，聚焦于背后的原理、规律、概念或一般性知识，而不是具体细节。
            
# 原始问题

{QUESTION}

# 输出         
请只输出改写后的“后退问题”，不要解释，不要包含原始问题，也不要回答它。
```

实战演练

我们在构建索引的时候，导入两篇文档，分别是Mybatis和Redis，用来区分检索效果。

我们再修改一下增强生成的promptTemplate提示词模板，为了能够明显看到差异，去掉了之前默认返回策略。

```text
/**
 * 检索增强生成回答
 */
@GetMapping("/chat")
public String chat(@RequestParam("query") String query) {
    // 1. 相似度检索获取相关文档
    List<Document> similarDocs = embeddingService.similarSearch(query);

    // 2. 构建提示词模板
    String promptTemplate = """
    请基于以下提供的参考文档内容，回答用户的问题。

    参考文档:
    {documents}

    用户问题: {question}
    """;

    log.info("共检索到 {} 个相关文档块。", similarDocs.size());

    // 3. 处理检索到的文档内容
    String documentContent = similarDocs.stream()
    .map(Document::getText)
    .collect(Collectors.joining("\n\n=========文档分隔线===========\n\n"));

    log.info("查询到的文档信息：{}", documentContent);

    // 4. 填充模板参数
    Map<String, Object> params = new HashMap<>();
    params.put("documents", documentContent);
    params.put("question", query);
    PromptTemplate prompt = new PromptTemplate(promptTemplate);
    Prompt realPrompt = prompt.create(Map.of("documents", documentContent, "question", query));

    // 5. 调用大模型生成回答
    String text = chatClient.prompt(realPrompt).call().chatResponse().getResult().getOutput().getText();

    return text;
}
```

**定义问题重写器**

```text
package cn.hollis.llm.mentor.rag.rewriter;

import com.alibaba.fastjson2.JSON;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.prompt.PromptTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

@Service
@Slf4j
public class QuestionRewriteService {

    @Autowired
    private ChatModel chatModel;

    //分解提示词
    private static final String DECOMPOSE_PROMPT = """
            # 角色
            你是一名专业的查询逻辑分析专家。
            
            # 任务
            将给定的“用户原始问题”分解为一系列**相互独立、逻辑清晰**，且可单独用于检索的子查询列表。
            你的输出必须是一个标准的JSON数组格式。
            
            # 用户原始问题
            {QUESTION}
            
            # 输出格式要求 (JSON Array)
            [
              "子查询1",
              "子查询2",
              "子查询3",
              "..."
            ]
            
            （不强制要求数组元素个数，可根据真实情况输出，至少保留1个）
            
            # 输出
            请直接输出JSON数组，不要包含解释或多余的文字。  """;

    //问题的富化
    private static final String ENRICH_PROMPT = """
            # 角色
            你是一个专业的问题重写优化器。
            
            # 任务
            根据提供的“对话历史”和“用户原始问题”，重写为一个独立、完整、且包含所有必要背景信息的新查询，用于RAG检索。
            
            ## 对话历史：
            {CHAT_HISTORY}
            
            ## 原始问题：
            {QUESTION}
            
            # 输出
            输出富化过后的新问题，不要包含多余的解释性内容
            """;

    //问题的多样化
    private static final String DIVERSIFY_PROMPT = """
            # 角色
            你是一名专业的语义扩展专家。
            
            # 任务
            为给定的“原始问题”生成**3个**语义相同但**措辞完全不同、且利于检索**的查询变体，以提高检索的召回率。
            你的输出必须是一个标准的JSON数组格式。
            
            # 原始问题
            {QUESTION}
            
            # 输出格式要求 (JSON Array)
            [
              "变体1",
              "变体2",
              "变体3"
            ]
            
            # 输出
            输出富化过后的新问题，不要包含多余的解释性内容
            """;

    private static final String STEP_BACK = """
             # 角色
            你是一个擅长抽象思维和原理推理的专家。
            
            # 任务
            请根据用户提出的具体问题，先“后退一步”，将其转化为一个更通用、更本质的问题，聚焦于背后的原理、规律、概念或一般性知识，而不是具体细节。
            
            # 原始问题
            
            {QUESTION}
            
            # 输出
            请只输出改写后的“后退问题”，不要解释，不要包含原始问题，也不要回答它。
            """;

    private static final String QUESTION = "QUESTION";
    private static final String CHAT_HISTORY = "CHAT_HISTORY";

    /**
     * 问题分解
     *
     * @param question
     * @return
     */
    public List<String> decompose(String question) {
        log.info("===========进入问题分解流程===========");
        log.info("原始问题: {}", question);
        PromptTemplate promptTemplate = new PromptTemplate(DECOMPOSE_PROMPT);
        promptTemplate.add(QUESTION, question);

        String result = chatModel.call(promptTemplate.create()).getResult().getOutput().getText();
        log.info("===========问题分解完成，结果: {} ===========", result);
        return JSON.parseArray(result, String.class);
    }

    /**
     * 问题富化
     */
    public String enrich(String chatHistory, String question) {
        log.info("===========进入问题富化流程===========");
        log.info("对话历史: {}", chatHistory);
        log.info("原始问题: {}", question);
        PromptTemplate promptTemplate = new PromptTemplate(ENRICH_PROMPT);
        promptTemplate.add(CHAT_HISTORY, chatHistory);
        promptTemplate.add(QUESTION, question);

        String result = chatModel.call(promptTemplate.create()).getResult().getOutput().getText();
        log.info("===========问题富化完成，结果: {} ===========", result);
        return result;
    }

    /**
     * 问题多样化
     */
    public List<String> diversify(String question) {
        log.info("===========进入问题多样化流程===========");
        log.info("原始问题: {}", question);
        PromptTemplate promptTemplate = new PromptTemplate(DIVERSIFY_PROMPT);
        promptTemplate.add(QUESTION, question);

        String result = chatModel.call(promptTemplate.create()).getResult().getOutput().getText();
        log.info("===========问题多样化完成，结果: {} ===========", result);
        return JSON.parseArray(result, String.class);
    }

    /**
     * 问题回退
     *
     * @param question
     * @return
     */
    public String stepBack(String question) {
        log.info("===========进入问题回退流程===========");
        log.info("原始问题: {}", question);
        PromptTemplate promptTemplate = new PromptTemplate(STEP_BACK);
        promptTemplate.add(QUESTION, question);

        String result = chatModel.call(promptTemplate.create()).getResult().getOutput().getText();
        log.info("===========问题回退完成，结果: {} ===========", result);
        return result;
    }

    // 组合方法
    public List<String> rewriteQuery(String query) {
        log.info("===========进入问题重写组合策略流程===========");
        log.info("原始问题: {}", query);

        //回退
        String stepBackQuery = this.stepBack(query);

        // 分解
        List<String> decomposedQueries = this.decompose(stepBackQuery);

        // 多样化
        List<String> finalQueries = new ArrayList<>();
        for (String subQuery : decomposedQueries) {
            List<String> variations = this.diversify(subQuery);
            finalQueries.addAll(variations);
        }

        if (finalQueries.isEmpty()) {
            finalQueries.add(query);
        }

        log.info("===========组合重写完成，最终查询列表: {} ===========", finalQueries);
        return finalQueries;
    }
}
```

这边提供了3种问题重写方法，和一种**组合方法**，实际开发应用中，不一定每次都用需要把所有方法都用上，应当仔细分析使用场景，**灵活组合运用**。

**不含问题重写的接口**

我们先用之前**chat接口**来进行测试，我们**打印一下检索到的文档块个数**。发现根本都没有检索到相关内容。但是接口仍然会有结果，这是因为**模型本身具备这样的知识**，但**并不是我们文档的内容**。

![](assets/4386d34f606b.png)

![](assets/eadcaee78dcc.png)

![](assets/5f97a2813bbc.png)

**接下来我们构造一个带有问题重写的chat接口**

```text
@GetMapping("/chatWithQueryRewrite")
public String chatWithQueryRewrite(@RequestParam("query") String query) {
    List<String> rewriteQuery = queryRewriteService
.rewriteQuery(query);
    // set用作文档去重
    Set<Document> similarDocs = new LinkedHashSet<>();
    for (String q : rewriteQuery) {
        List<Document> docs = embeddingService.similarSearch(q);
        if (docs != null && !docs.isEmpty()) {
            similarDocs.addAll(docs);
        }
    }
    // 2. 构建提示词模板
    String promptTemplate = """
    请基于以下提供的参考文档内容，回答用户的问题。

    参考文档:
    {documents}

    用户问题: {question}
    """;

    log.info("共检索到 {} 个相关文档块。", similarDocs.size());

    // 3. 处理检索到的文档内容
    String documentContent = similarDocs.stream()
    .map(Document::getText)
    .collect(Collectors.joining("\n\n=========文档分隔线===========\n\n"));

    log.info("查询到的文档信息：{}", documentContent);

    // 4. 填充模板参数
    Map<String, Object> params = new HashMap<>();
    params.put("documents", documentContent);
    params.put("question", query);
    PromptTemplate prompt = new PromptTemplate(promptTemplate);
    Prompt realPrompt = prompt.create(Map.of("documents", documentContent, "question", query));

    // 5. 调用大模型生成回答
    String text = chatClient.prompt(realPrompt).call().chatResponse().getResult().getOutput().getText();

    return text;
}
```

**调用结果**

![](assets/c438a5468629.png)

![](assets/99ff2d1cc88d.png)

我们可以看到增加了问题重写后的检索功能，通过**回退、富化、分解、多样化的组合处理**，使得问题本身更加的丰富，相比于普通RAG检索到**0个文本块**，带有问题重写的RAG检索到了**5个文本块**，大模型基于这些文本块作为背景，回复的内容则更加符合用户需求。

注意事项

问题重写，是生产级 RAG 的必备操作，但并非重写策略越多、逻辑越复杂，效果就越好。很多时候，我们的核心在于**在性能与质量之间找到一个平衡点**。过多冗余的流程会显著增加问答系统的响应时间，直接导致用户体验下降。因此，需结合自身业务需求，充分分析用户的提问习惯、交互方式、以及产品特点，灵活组合选用问题重写策略，才能最大化其价值。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6975ecd2d31fed0001feb0af
