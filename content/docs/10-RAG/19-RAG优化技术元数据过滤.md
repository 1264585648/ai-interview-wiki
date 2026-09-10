---
title: "✅RAG优化技术：元数据过滤"
---

# ✅RAG优化技术：元数据过滤

![image.png](assets/2c04802e4d60.png)

什么是元数据

在RAG中，**元数据（Metadata）** 是附加到文本块（Chunk）上的结构化信息，它是描述了该文本块的“数据”。 一个文本块的元数据可以包含：文件名、页码、userid等等。这些信息可以用于一些特殊的功能要求。

我们在之前的课程文档中曾经看过navicat中存储的向量数据，其中一个字段就是metadata，当时由于我们没有做任何存储操作，所以这个字段是空。

![](assets/83caedbc9dea.png)

使用场景

精确过滤

这是**元数据最强大最直接的功能**，我们通过之前的学习，已经了解到向量数据库检索的本质是**相似度查询**，但是很多时候我们需要的是类似**关系型数据库的精确检索**，那有没有一种方式可以将两种检索都结合在一起呢？答案就是**元数据**。

比如说，我现在有一些不同版本的汽车用户手册文档，《汽车用户手册（2023年版）》、《汽车用户手册（2024年版）》、《汽车用户手册（2025年版）》，文档中对于同一个问题的描述是不一样的，比如“**如何启动汽车**”，在2023年版中，说明的是需要用**钥匙启动**，而在2024年版中，说明的是需要用**旋钮启动**，到了2025年版，直接可以通过**手机来启动**。

用户这时候提问“**根据《汽车用户手册（2023年版）》，汽车应该如何启动？**”，如果**没有元数据**，普通的相似度检索，因为上述三个版本的文本块**仅仅是年份的一个数字不一样**，**相似度其实都非常高**，所以就非常有可能会将这**三种都检索到**，如果架构流程设计的再不好的话，就会非常有可能导致**回答的不对**。

而如果我们将**文档的名称存入元数据，当我在进行相似度检索之前，进行一次元数据过滤**，这样就可以完全过滤掉2024版和2025版这两个版本的相关文本块，仅仅针对元数据是2023年版的做相似度检索，这样我们的回答就会更加符合用户的要求。

提供参考源

在 RAG 检索增强生成中，模型给出的回答，用户无法判断这些内容是否真的来自企业知识库，还是模型胡编乱造出来的。因此在文档切片或向量化时，需要为每个文本块存储**元数据**，例如：

- 文档名称（来源文件）
- 页码或章节位置
- 文档类型或版本号

当答案生成后，可以把这些元数据信息一起展示给用户，让用户明确看到回答引用的来源。例如：

**参考来源：**《汽车用户手册（2024年版）》第5页

这样做的作用：

- **增加可信度**：让用户知道回答确实来自文档，而不是模型胡编乱造
- **便于追溯**：如果有疑问，可以快速跳到对应文档片段进行核对
- **提升用户体验**：特别是文档量大、内容复杂时，元数据可以帮助用户快速定位信息

元数据就是文本块的“身份证”，不仅帮助模型检索更精准，也能让用户在结果中看到可靠的参考依据。

访问权限

在企业级 RAG 应用中，知识库的文档往往涉及不同的**安全级别**或**用户群体**。例如，某个文档可能是某个部门的“内部机密”，只能被该部门的员工访问；而另一个文档是“公开”的，所有员工都可以检索。

如果没有权限控制，当普通员工提问时，如果向量检索不加区分地返回了“内部机密”文档的内容块，这将导致**数据泄露**。

为了解决这一问题，我们可以在向量化存储时，将访问权限信息一并写入元数据，例如：

- 部门id/角色id/用户id
- 保密等级
- 生效时间或版本状态等

在用户查询时，先根据用户身份进行一次元数据过滤，屏蔽掉用户无权访问的文本块，再执行相似度检索。这样做可以确保RAG只基于用户能访问的内容生成答案。

使用示例

我这边使用大模型先生成了两份文档，分别是《汽车用户手册（2023年版）》和《汽车用户手册（2024年版）》，两个版本对于一些问题的描述略有出入，我们基于这两个文档，来演示元数据的作用。

导入向量库

![](assets/4ed5925a88a6.png)

**2023版**

![image.png](assets/487f3e728e6b.png)

**2024版**

![image.png](assets/8a2a9f4cb6b3.png)

**2025版**

![image.png](assets/6ef5f32537d8.png)

**修改之前的构建索引的方法，在文档切片和向量化之间，增加一步：新增元数据**

```text
    @GetMapping("/embedding")
    public String embedding(String filePath, String fileName) {

        List<Document> documents;
        try {
            documents = documentReaderFactory.read(new File(filePath));
        } catch (IOException e) {
            throw new RuntimeException(e);
        }

        for (Document document : documents) {
            document.getMetadata().put("fileName", fileName);
        }

        embeddingService.embedAndStore(documents);

        return "success";
    }
```

我们可以看到最终入库了多个文本块，metadata也有了文件名。

![image.png](assets/3602d69f42d0.png)

检索过滤

修改相似度检索方法，如下所示：

```text
List<Document> similarDocs = vectorStore.similaritySearch(SearchRequest
                                                          .builder()
                                                          .query(query)
                                                          .topK(5)
                                                          .similarityThreshold(0.5f)
                                                          .filterExpression("fileName == '" + fileName + "'")
                                                          .build());
```

其中filterExpression就是过滤匹配的表达式。这个地方我们把阈值similarityThreshold调低，不同文档、不同提问方式，这个参数都不太一样，你需要找到一个能够最大程度过滤掉无效文本块、保留相似文本块的参数值，需要反复调试才可以。

**带元数据过滤的检索生成代码如下：**

```text
@GetMapping("/retrieveMetadata")
public String retrieveMetadata(String query, String fileName) {

     SearchRequest searchRequest = SearchRequest.builder().query(query).filterExpression("fileName == '" + fileName + "'").build();

     return embeddingService.similaritySearch(searchRequest).toString();
}
```

**我们这边为了演示方便，就直接把指定的文件名传进去了，实际环境中，这个文件名的提取工作也是需要大模型来进行参数抽取的。**

如果是再加上直接用QuestionAnswerAdvisor检索增强的同时，如何设置这个参数呢？可以这么干：

```text
@GetMapping("/retrieveAdvisorWithMetadata")
public String retrieveAdvisorWithMetadata(String query, String fileName) {
    return chatClient.prompt(query)
            .advisors(advisorSpec -> advisorSpec.param("qa_filter_expression", "fileName == '" + fileName + "'"))
            .call().content();
}
```

这里面的qa_filter_expression是QuestionAnswerAdvisor中规定的：

![image.png](assets/1f1a6860e98b.png)

最后，测试一下：

![image.png](assets/e27b49d2bad2.png)

![image.png](assets/d7f5944a9537.png)

本文涉及到的文档：

[《汽车用户手册（2023年版）》.docx](https://tcs-devops.aliyuncs.com/storage/123q3519d07a10dbccbd5419e9d3eb06bce7?Signature=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJBcHBJRCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9hcHBJZCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9vcmdhbml6YXRpb25JZCI6IiIsImV4cCI6MTc4OTQ1MDg0MiwiaWF0IjoxNzg4ODQ2MDQyLCJyZXNvdXJjZSI6Ii9zdG9yYWdlLzEyM3EzNTE5ZDA3YTEwZGJjY2JkNTQxOWU5ZDNlYjA2YmNlNyJ9.CA71GMEFlswkJQCxiOMFazYgM_soLRvVUgd22raDzeU&download=%E3%80%8A%E6%B1%BD%E8%BD%A6%E7%94%A8%E6%88%B7%E6%89%8B%E5%86%8C%EF%BC%882023%E5%B9%B4%E7%89%88%EF%BC%89%E3%80%8B.docx)

[《汽车用户手册（2024年版）》.docx](https://tcs-devops.aliyuncs.com/storage/123q4b43891066de39a8c4b5249506688a20?Signature=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJBcHBJRCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9hcHBJZCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9vcmdhbml6YXRpb25JZCI6IiIsImV4cCI6MTc4OTQ1MDg0MiwiaWF0IjoxNzg4ODQ2MDQyLCJyZXNvdXJjZSI6Ii9zdG9yYWdlLzEyM3E0YjQzODkxMDY2ZGUzOWE4YzRiNTI0OTUwNjY4OGEyMCJ9.AMj6_wC5nmODAo083YrtoXmS4kzJl0YxfwCBQVMGzo8&download=%E3%80%8A%E6%B1%BD%E8%BD%A6%E7%94%A8%E6%88%B7%E6%89%8B%E5%86%8C%EF%BC%882024%E5%B9%B4%E7%89%88%EF%BC%89%E3%80%8B.docx)

[《汽车用户手册（2025年版）》.docx](https://tcs-devops.aliyuncs.com/storage/123qe1bd7b99a2290523fb96dc462ca3f80a?Signature=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJBcHBJRCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9hcHBJZCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9vcmdhbml6YXRpb25JZCI6IiIsImV4cCI6MTc4OTQ1MDg0MiwiaWF0IjoxNzg4ODQ2MDQyLCJyZXNvdXJjZSI6Ii9zdG9yYWdlLzEyM3FlMWJkN2I5OWEyMjkwNTIzZmI5NmRjNDYyY2EzZjgwYSJ9.fsILFbxUOOe11OCw4jnkV1KVg_QLXLWo_L4s0TtqRu4&download=%E3%80%8A%E6%B1%BD%E8%BD%A6%E7%94%A8%E6%88%B7%E6%89%8B%E5%86%8C%EF%BC%882025%E5%B9%B4%E7%89%88%EF%BC%89%E3%80%8B.docx)

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6975eb56c71a890001b3ebb7
