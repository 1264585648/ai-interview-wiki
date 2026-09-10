---
title: "✅如何基于text2sql实现关系型数据查询?"
---

# ✅如何基于text2sql实现关系型数据查询?

在一个智能客服中，并不是所有的用户问题都是通过知识库做检索的，有一些情况，比如用户关于一些个人信息相关的东西，可能需要通过数据库查询。如以下情况，我问我的保险什么时候到期，这个问题肯定无法从知识库获得，而是应该查询数据库。

![image.png](assets/7ed36291dda2.png)

know-engine 采用 三路由检索架构，SQL 检索是其中的关系型数据库路由分支。整个流程基于 LangChain4j 的 RAG 管道，核心链路为：

```
用户提问 → 查询改写 → 意图路由 → text2sql →SQL检索 → LLM生成回答
```

```
用户提问
  │
  ▼
KnowEngineQueryTransformer  ← LLM改写 + 注入userId/时间
  │
  ▼
KnowEngineQueryRouter  ← LLM判断意图 → strategy: "relational_db"
  │
  ▼
ProgressAwareContentRetriever  ← 发送进度通知
  │
  ▼
KnowEngineSqlDatabaseContentRetriever
  │
  ├─ SqlDatabaseContentRetriever (LangChain4j)
  │     ├─ LLM 根据 Schema + Prompt 生成 SQL
  │     ├─ 通过 DataSource 执行 SQL
  │     └─ 返回格式化结果文本
  │
  ├─ 结果为空/异常? → fallbackRetriever (向量检索)
  │
  ▼
ReRankingContentAggregator  ← BGE 模型重排序
  │
  ▼
LLM 生成最终回答
```

核心组件及流程

查询改写 — KnowEngineQueryTransformer

在进入路由之前，用户原始查询会经过 LLM 改写优化，改写后会附加上下文信息：

String newQuery = "我的问题是：" + response + ", 我的用户Id是: user_id" + ", 现在是：" + LocalDateTime.now();

改写后的查询会包含 用户ID 和 当前时间，**这些信息在后续 SQL 生成时非常重要（如查询"我的保险还有多少天到期"需要 user_id 做过滤，时间比较需要当前日期）。**

意图路由 — KnowEngineQueryRouter

路由器通过 LLM 判断用户意图，决定走哪个检索器。当查询涉及结构化数据查询，如车辆信息、保险信息、订单信息、数值比较、聚合操作等。那么策略为 "relational_db" 时，路由到 SQL 检索器：

```
case "relational_db":
    return contentRetrievers.stream().filter(retriever -> {
        if (retriever instanceof ProgressAwareContentRetriever) {
            ContentRetriever delegate = ((ProgressAwareContentRetriever) retriever).getDelegate();
            return delegate instanceof SqlDatabaseContentRetriever 
                || delegate instanceof KnowEngineSqlDatabaseContentRetriever;
        }
        return retriever instanceof SqlDatabaseContentRetriever 
            || retriever instanceof KnowEngineSqlDatabaseContentRetriever;
    }).collect(Collectors.toList());
```

SQL 检索器构建

```
@Value("classpath:prompts/text-to-sql-prompt.txt")
private Resource textToSqlPrompt;

@Value("classpath:sql/retrieve_tables.sql")
private Resource tablesSql;

// 构建 SQL 检索器
sqlRetriever = new ProgressAwareContentRetriever(
    KnowEngineSqlDatabaseContentRetriever.builder()
        .dataSource(dataSource)
        .promptTemplate(new PromptTemplate(textToSqlPrompt.getContentAsString(UTF_8)))
        .databaseStructure(tablesSql.getContentAsString(UTF_8))
        .chatModel(chatModel)
        .fallbackRetriever(embeddingRetriever)  // 兜底检索器
        .build(), processCallback);
```

- dataSource：JDBC 数据源，执行生成的 SQL
- promptTemplate：Text2SQL 的 Prompt 模板
- databaseStructure：表结构定义（Schema），让 LLM 知道有哪些表和字段
- fallbackRetriever：兜底检索器（向量检索）

Text2SQL Prompt — text-to-sql-prompt.txt

```
# 角色
你是一个SQL专家。请根据以下表结构信息将用户问题转换为SQL查询语句。
特别注意，你只能查询，不能做修改、删除等操作。

# 表结构信息
{{databaseStructure}}

# 要求
1. 只返回SQL语句，不需要包含任何解释和说明
2. 确保SQL语法正确
3. 使用上下文中提供的表名和字段名
4. 如果根据所提供的表无法做查询，请直接返回空字符串""

# 其他说明
今天是:{today}
```

数据库 Schema — retrieve_tables.sql

提供给 LLM 的表结构包含 3 张业务表（实际根据业务需要做调整）：

- car_info：车型信息表（品牌、型号、续航、价格等）
- my_car：用户车辆表（车牌号、VIN码、保险到期日、里程等）
- car_order：车辆订单表（订单状态、金额、交付日期等）

每个字段都带有详细的 comment 注释，帮助 LLM 理解字段含义。

核心检索逻辑 — KnowEngineSqlDatabaseContentRetriever

这是对 LangChain4j 原生 SqlDatabaseContentRetriever 的增强封装，核心 retrieve 方法：

```
@Override
public List<Content> retrieve(Query query) {
    List<Content> results;
    try {
        results = sqlDatabaseContentRetriever.retrieve(query);
    } catch (Exception e) {
        log.warn("SQL 检索异常，降级使用知识库检索, query: {}", query.text(), e);
        return fallbackRetriever.retrieve(query);  // 异常降级
    }

    if (results == null || results.isEmpty() || isSqlResultEmpty(results)) {
        log.info("SQL 检索结果为空，降级使用知识库检索, query: {}", query.text());
        return fallbackRetriever.retrieve(query);  // 空结果降级
    }
    return results;
}
```

降级策略：

- SQL 执行异常 → 降级到向量检索
- SQL 结果为空 → 降级到向量检索
- 正常返回 SQL 查询结果

空结果判定逻辑（重要细节）

LangChain4j 的 SqlDatabaseContentRetriever 在查询无数据时不会返回空 list，而是返回包含列名但无数据行的文本。

有结果的文本：

```
Result of executing 'SELECT mc.plate_number, mc.insurance_expire_date \nFROM my_car mc \nWHERE mc.user_id = 'user_id' AND mc.insurance_expire_date <= '2026-05-15'':\nplate_number,insurance_expire_date\n沪A12345,2025-06-20\n沪B67890,2025-03-15
```

无结果的文本：

```
Result of executing 'SELECT mc.plate_number, mc.insurance_expire_date \nFROM my_car mc \nWHERE mc.user_id = 'user_id' AND mc.insurance_expire_date <= '2026-05-15'':\nplate_number,insurance_expire_date
```

```
Result of executing 'SELECT mc.plate_number, mc.insurance_expire_date FROM my_car mc WHERE mc.user_id = 'user_id' AND mc.insurance_expire_date <= '2026-05-15'':\nplate_number,insurance_expire_date
```

因此需要自定义判空逻辑：

```
private boolean isSqlResultEmpty(List<Content> results) {
    if (results.size() != 1) return false;
    String text = results.get(0).textSegment().text();
    if (!text.startsWith("Result of executing '")) return false;
    
    int columnStartIndex = text.indexOf(":\n");
    if (columnStartIndex == -1) return false;
    int dataStartIndex = text.indexOf('\n', columnStartIndex + 2);
    return dataStartIndex == -1 || text.substring(dataStartIndex + 1).trim().isEmpty();
}
```

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69be4db7a7c8ff00017b5591
