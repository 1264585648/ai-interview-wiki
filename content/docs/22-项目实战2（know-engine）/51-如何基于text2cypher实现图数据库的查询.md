---
title: "✅如何基于text2cypher实现图数据库的查询"
---

# ✅如何基于text2cypher实现图数据库的查询

在一个智能客服中，并不是所有的用户问题都是通过知识库做检索的，有一些情况，比如用户关于一些个人信息相关的东西，可能需要通过图数据库查询。如以下情况，我问"哪些车配置了空气悬架系统？"

![](assets/d52a2f6501a7.png)

图关系如下：

![](assets/8838f7fbe741.png)

know-engine 采用 三路由检索架构，关系检索是其中的图数据库路由分支。整个流程基于 LangChain4j 的 RAG 管道，核心链路为：

```
用户提问 → 查询改写 → 意图路由 → text2cypher → 图检索 → LLM生成回答
```

这其实也是我们前面讲过的graph rag的实践。

整体流程如下：

```text
用户提问："哪些车配置了空气悬架系统？"
         │
         ▼
┌─────────────────────────────────────┐
│   KnowEngineQueryRouter (路由器)     │
│   LLM 判断意图 → 选择 graph_db 策略  │
└──────────────┬──────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────┐
│  KnowEngineNeo4jContentRetriever (检索器)     │
│  1. 调用 LLM 生成 Cypher 语句                  │
│  2. 在 Neo4j 中执行查询                        │
└──────────────┬───────────────────────────────┘
               │
               │
               ▼
┌──────────────────────────────────────────────┐
│  LLM 生成最终回答（含查询结果作为上下文）          │
└──────────────────────────────────────────────┘
```

Text2Cypher 查询流程

检索器初始化

**文件**：`ChatApplicationService.java`

```java

@Value("classpath:prompts/text-to-cypher-prompt.txt")
private Resource textToCypherPrompt;

// 在 chat() 方法中动态构建
ProgressAwareContentRetriever neo4jRetriever = new ProgressAwareContentRetriever(
    KnowEngineNeo4jContentRetriever.builder()
        .graph(Neo4jGraph.builder()
                .driver(neo4jDriver)
                .build())
        .chatModel(chatModel)
        .promptTemplate(new PromptTemplate(
            textToCypherPrompt.getContentAsString(UTF_8)))
        .fallbackRetriever(embeddingRetriever)  // 降级检索器
        .build(), 
    processCallback
);
```

核心检索逻辑

**文件**：`KnowEngineNeo4jContentRetriever.java`

```java

@Slf4j
public class KnowEngineNeo4jContentRetriever implements ContentRetriever {

    private final Neo4jText2CypherRetriever neo4jText2CypherRetriever;
    private final ContentRetriever fallbackRetriever;

    @Override
    public List<Content> retrieve(Query query) {
        List<Content> results;
        try {
            // 1. 补充用户上下文与时间信息，辅助 LLM 生成更准确的 Cypher
            String newQuery = "我的问题是：" + query.text() 
                            + ", 我的用户Id是: 123321" 
                            + ", 现在是：" + LocalDateTime.now();
            query = new Query(newQuery, query.metadata());
            
            // 2. 调用 LangChain4j 的 Neo4jText2CypherRetriever
            results = neo4jText2CypherRetriever.retrieve(query);
            
        } catch (Exception e) {
            // 3. 异常降级：切换到知识库检索
            log.warn("Neo4j 图数据库检索异常，降级使用知识库检索, query: {}", query.text(), e);
            return fallbackRetriever.retrieve(query);
        }

        // 4. 空结果降级：切换到知识库检索
        if (results == null || results.isEmpty() || isCypherResultEmpty(results)) {
            log.info("Neo4j 图数据库检索结果为空，降级使用知识库检索, query: {}", query.text());
            return fallbackRetriever.retrieve(query);
        }

        // 5. 成功结果：标记 skipRerank，直接透传
        return results.stream()
                .map(ContentUtil::markAsSkipRerank)
                .collect(Collectors.toList());
    }

    /**
     * 判断 Cypher 查询结果是否实际为空
     * 
     * Neo4jText2CypherRetriever 返回的 Content 文本形如：
     * Result of executing '...CYPHER...':
     * key1,key2
     * value1,value2
     * 
     * 当只有列名头部而没有实际数据行时，认为结果为空。
     */
    private boolean isCypherResultEmpty(List<Content> results) {
        if (results.size() != 1) {
            return false;
        }
        String text = results.get(0).textSegment().text();
        if (!text.startsWith("Result of executing '")) {
            return false;
        }
        
        // ":\n" 标记列名开始，列名后的第一个 "\n" 标记数据开始
        int columnStartIndex = text.indexOf(":\n");
        if (columnStartIndex == -1) {
            return false;
        }
        
        // ":\n" 之后是列名行，找列名行结束的 "\n"（即数据开始位置）
        int dataStartIndex = text.indexOf('\n', columnStartIndex + 2);
        
        // 列名后没有换行符，或换行符后无实际内容，则表示无数据
        return dataStartIndex == -1 || text.substring(dataStartIndex + 1).trim().isEmpty();
    }
}
```

这是一个我们自定义的检索器，其中核心的图检索能力是靠Neo4jText2CypherRetriever这个在langchain4j-community-neo4j-retriever中提供的类实现的。

我们之所以要封装一个KnowEngineNeo4jContentRetriever，主要是为了做兜底，如果从图数据库中查询不到数据，则降级到知识库再检索一次。

Prompt 模板设计

**文件**：`prompts/text-to-cypher-prompt.txt`

```text

# 角色
你是一个Cypher查询专家。请根据以下图数据库的Schema信息将用户问题转换为Cypher查询语句。
特别注意，你只能查询，不能做修改、删除等操作。

# Schema信息
{{schema}}

{{examples}}

# 示例
问题：BMW有哪些车型？
Cypher：MATCH (b:Brand {englishName: 'BMW'})-[:HAS_MODEL]->(m:CarModel) 
         RETURN m.name AS modelName, m.fuelType AS fuelType, m.vehicleType AS vehicleType

问题：宝马3系有哪些版本？
Cypher：MATCH (b:Brand {name: '宝马'})-[:HAS_MODEL]->(m:CarModel {name: '3系'})
         -[:HAS_VERSION]->(v:CarVersion) 
         RETURN v.name AS versionName, v.guidePrice AS guidePrice, v.status AS status

问题：哪些车是纯电动的？
Cypher：MATCH (v:CarVersion)-[:HAS_ENERGY_TYPE]->(e:EnergyType {name: '纯电动'}) 
         RETURN v.name AS versionName

问题：哪些车和Model 3长续航版使用了相同的轮胎？
Cypher：MATCH (model3:CarVersion {infoId: 'CI_001'})-[:USES_PART]->(p:Part)
         <-[:USES_PART]-(other:CarVersion) 
         WHERE other <> model3 
         RETURN other.name AS versionName, p.name AS sharedPart

# 要求
1. 只返回Cypher查询语句，不需要包含任何解释和说明
2. 确保Cypher语法正确
3. 只使用Schema中提供的节点标签、关系类型和属性
4. 如果根据所提供的Schema无法做查询，请直接返回空字符串""
5. 禁止执行任何写操作（CREATE、MERGE、SET、DELETE、REMOVE等）

用户问题是：{{question}}
```

**关键点**：

- 通过 `{{schema}}` 动态注入 Neo4j Schema
- 通过 `{{examples}}` 提供 few-shot 示例，提升生成质量
- 明确禁止写操作，保证查询安全
- 支持中英文查询（Brand 节点同时有 `name` 和 `englishName`）

路由执行

在KnowEngineQueryRouter中会做统一路由

```java

@Override
public Collection<ContentRetriever> route(Query query) {
    String response = chatModel.chat(createPrompt(query).text());
    
    QueryRouteResult queryRouteResult = JSON.parseObject(response, QueryRouteResult.class);
    String strategy = queryRouteResult.strategy();
    
    switch (strategy) {
        case "graph_db":
            return contentRetrievers.stream().filter(retriever -> {
                if (retriever instanceof ProgressAwareContentRetriever) {
                    ContentRetriever delegate = 
                        ((ProgressAwareContentRetriever) retriever).getDelegate();
                    return delegate instanceof Neo4jText2CypherRetriever 
                        || delegate instanceof KnowEngineNeo4jContentRetriever;
                }
                return retriever instanceof Neo4jText2CypherRetriever 
                    || retriever instanceof KnowEngineNeo4jContentRetriever;
            }).collect(Collectors.toList());
            
        case "relational_db":
            // ... 返回 SQL 检索器
            
        case "knowledge_base":
            // ... 返回向量/全文检索器
    }
}
```

这样坐下来之后，就具备了基于图数据库做检索的能力了，准备一下测试数据，就可以做图检索了。

注意，图数据库和关系型数据库的检索之后，其实是不需要做重排序的。

测试数据准备

我们使用了关于汽车相关的数据，包括了品牌、车型、车系、配件、能源类型的实体和关系。

![](assets/af762414d05d.png)

初始化代码如下，把这个内容复制到neo4j browser 中执行即可：

neo4j部署参考：[../10-RAG/27-✅RAG优化技术：Graph RAG.md#6985a510263cde09af2aa803](../10-RAG/27-✅RAG优化技术：Graph RAG.md#6985a510263cde09af2aa803)

```text
// ============================================================
// KnowEngine 图数据库测试数据（精简版）
// 适用于 Neo4j 5.x，可直接在 Neo4j Browser / cypher-shell 中执行
// 节点：Brand（品牌）、CarModel（车型）、CarVersion（车系版本）、Part（配件）、EnergyType（能源类型）
// 关系：HAS_MODEL、HAS_VERSION、USES_PART、HAS_ENERGY_TYPE
// ============================================================

// 1. 清理已有数据（如需重复执行，取消下面两行的注释）
MATCH (n) DETACH DELETE n;
DROP CONSTRAINT unique_car_version IF EXISTS;

// 2. 创建约束与索引
CREATE CONSTRAINT unique_car_version IF NOT EXISTS
    FOR (v:CarVersion) REQUIRE v.infoId IS UNIQUE;

CREATE INDEX idx_brand_name IF NOT EXISTS
    FOR (b:Brand) ON (b.name);

CREATE INDEX idx_car_model_name IF NOT EXISTS
    FOR (m:CarModel) ON (m.name);

CREATE INDEX idx_part_no IF NOT EXISTS
    FOR (p:Part) ON (p.partNo);

// 3. 品牌节点（含英文别名，方便中英文 Text2Cypher 查询）
MERGE (tesla:Brand {name: 'Tesla'})
  ON CREATE SET tesla.englishName = 'Tesla', tesla.country = '美国', tesla.founded = 2003, tesla.aliases = ['特斯拉'];

MERGE (byd:Brand {name: '比亚迪'})
  ON CREATE SET byd.englishName = 'BYD', byd.country = '中国', byd.founded = 1995, byd.aliases = ['BYD', 'Build Your Dreams'];

MERGE (bmw:Brand {name: '宝马'})
  ON CREATE SET bmw.englishName = 'BMW', bmw.country = '德国', bmw.founded = 1916, bmw.aliases = ['BMW', 'Bayerische Motoren Werke'];

MERGE (nio:Brand {name: '蔚来'})
  ON CREATE SET nio.englishName = 'NIO', nio.country = '中国', nio.founded = 2014, nio.aliases = ['NIO'];

MERGE (xiao:Brand {name: '小米汽车'})
  ON CREATE SET xiao.englishName = 'Xiaomi Auto', xiao.country = '中国', xiao.founded = 2021, xiao.aliases = ['Xiaomi', 'Xiaomi SU7'];

// 4. 车型节点
MERGE (model3:CarModel {name: 'Model 3'})
  ON CREATE SET model3.vehicleType = '轿车', model3.fuelType = '电动', model3.aliases = ['Tesla Model 3', '特斯拉 Model 3'];

MERGE (modely:CarModel {name: 'Model Y'})
  ON CREATE SET modely.vehicleType = 'SUV', modely.fuelType = '电动', modely.aliases = ['Tesla Model Y', '特斯拉 Model Y'];

MERGE (han:CarModel {name: '汉'})
  ON CREATE SET han.vehicleType = '轿车', han.fuelType = '电动', han.aliases = ['BYD Han', '比亚迪汉'];

MERGE (tang:CarModel {name: '唐'})
  ON CREATE SET tang.vehicleType = 'SUV', tang.fuelType = '混动', tang.aliases = ['BYD Tang', '比亚迪唐'];

MERGE (series3:CarModel {name: '3系'})
  ON CREATE SET series3.vehicleType = '轿车', series3.fuelType = '汽油', series3.aliases = ['BMW 3 Series', '宝马3系', 'BMW 3系'];

MERGE (et5:CarModel {name: 'ET5'})
  ON CREATE SET et5.vehicleType = '轿车', et5.fuelType = '电动', et5.aliases = ['NIO ET5', '蔚来ET5'];

MERGE (su7:CarModel {name: 'SU7'})
  ON CREATE SET su7.vehicleType = '轿车', su7.fuelType = '电动', su7.aliases = ['Xiaomi SU7', '小米SU7'];

// 5. 能源类型节点
MERGE (ev:EnergyType {name: '纯电动'})
  ON CREATE SET ev.aliases = ['BEV', 'Battery Electric Vehicle'];

MERGE (phev:EnergyType {name: '插电混动'})
  ON CREATE SET phev.aliases = ['PHEV', 'Plug-in Hybrid Electric Vehicle'];

MERGE (ice:EnergyType {name: '燃油'})
  ON CREATE SET ice.aliases = ['汽油', '柴油', 'Internal Combustion Engine'];

// 6. 车系版本节点
MERGE (m3_2025:CarVersion {infoId: 'CI_001'})
  ON CREATE SET m3_2025.name = 'Model 3 2025焕新版', m3_2025.modelYear = 2025, m3_2025.version = '长续航全轮驱动版',
                m3_2025.seatCount = 5, m3_2025.motorPower = 331, m3_2025.rangeKm = 713, m3_2025.guidePrice = 27.19,
                m3_2025.dimensions = '4720x1848x1442', m3_2025.wheelbase = 2875, m3_2025.manufacturer = 'Tesla 上海超级工厂',
                m3_2025.status = '在售', m3_2025.batteryType = '磷酸铁锂';

MERGE (m3p_2025:CarVersion {infoId: 'CI_002'})
  ON CREATE SET m3p_2025.name = 'Model 3 2025 Performance', m3p_2025.modelYear = 2025, m3p_2025.version = '高性能版',
                m3p_2025.seatCount = 5, m3p_2025.motorPower = 377, m3p_2025.rangeKm = 623, m3p_2025.guidePrice = 33.59,
                m3p_2025.dimensions = '4720x1848x1442', m3p_2025.wheelbase = 2875, m3p_2025.manufacturer = 'Tesla 上海超级工厂',
                m3p_2025.status = '在售', m3p_2025.batteryType = '三元锂';

MERGE (my_2025:CarVersion {infoId: 'CI_003'})
  ON CREATE SET my_2025.name = 'Model Y 2025长续航版', my_2025.modelYear = 2025, my_2025.version = '长续航全轮驱动版',
                my_2025.seatCount = 5, my_2025.motorPower = 331, my_2025.rangeKm = 688, my_2025.guidePrice = 29.09,
                my_2025.dimensions = '4750x1921x1624', my_2025.wheelbase = 2890, my_2025.manufacturer = 'Tesla 上海超级工厂',
                my_2025.status = '在售', my_2025.batteryType = '三元锂';

MERGE (han_ev_2025:CarVersion {infoId: 'CI_004'})
  ON CREATE SET han_ev_2025.name = '比亚迪汉 EV 2025', han_ev_2025.modelYear = 2025, han_ev_2025.version = '715KM 前驱旗舰型',
                han_ev_2025.seatCount = 5, han_ev_2025.motorPower = 180, han_ev_2025.rangeKm = 715, han_ev_2025.guidePrice = 21.98,
                han_ev_2025.dimensions = '4995x1910x1495', han_ev_2025.wheelbase = 2920, han_ev_2025.manufacturer = '比亚迪汽车',
                han_ev_2025.status = '在售', han_ev_2025.batteryType = '磷酸铁锂';

MERGE (tang_dm_2025:CarVersion {infoId: 'CI_005'})
  ON CREATE SET tang_dm_2025.name = '比亚迪唐 DM-i 2025', tang_dm_2025.modelYear = 2025, tang_dm_2025.version = '200KM 旗舰型',
                tang_dm_2025.seatCount = 7, tang_dm_2025.motorPower = 160, tang_dm_2025.rangeKm = 200, tang_dm_2025.guidePrice = 22.98,
                tang_dm_2025.dimensions = '4870x1950x1725', tang_dm_2025.wheelbase = 2820, tang_dm_2025.manufacturer = '比亚迪汽车',
                tang_dm_2025.status = '在售', tang_dm_2025.batteryType = '磷酸铁锂';

MERGE (bmw_330i:CarVersion {infoId: 'CI_006'})
  ON CREATE SET bmw_330i.name = '宝马 3系 330i M运动曜夜套装', bmw_330i.modelYear = 2025, bmw_330i.version = '330i M运动曜夜套装',
                bmw_330i.seatCount = 5, bmw_330i.displacement = 2.0, bmw_330i.motorPower = 180, bmw_330i.guidePrice = 38.19,
                bmw_330i.dimensions = '4728x1827x1452', bmw_330i.wheelbase = 2851, bmw_330i.manufacturer = '华晨宝马',
                bmw_330i.status = '在售', bmw_330i.fuelType = '汽油';

MERGE (et5_2025:CarVersion {infoId: 'CI_007'})
  ON CREATE SET et5_2025.name = '蔚来 ET5 2025', et5_2025.modelYear = 2025, et5_2025.version = '75kWh',
                et5_2025.seatCount = 5, et5_2025.motorPower = 360, et5_2025.rangeKm = 560, et5_2025.guidePrice = 29.80,
                et5_2025.dimensions = '4790x1960x1499', et5_2025.wheelbase = 2888, et5_2025.manufacturer = '蔚来汽车',
                et5_2025.status = '在售', et5_2025.batteryType = '三元锂', et5_2025.supportsBatterySwap = true;

MERGE (su7_max:CarVersion {infoId: 'CI_008'})
  ON CREATE SET su7_max.name = '小米 SU7 Max', su7_max.modelYear = 2024, su7_max.version = 'Max',
                su7_max.seatCount = 5, su7_max.motorPower = 495, su7_max.rangeKm = 800, su7_max.guidePrice = 29.99,
                su7_max.dimensions = '4997x1963x1440', su7_max.wheelbase = 3000, su7_max.manufacturer = '小米汽车',
                su7_max.status = '在售', su7_max.batteryType = '三元锂';

// 7. 品牌 -> 车型关系
MATCH (b:Brand {name: 'Tesla'}), (m:CarModel {name: 'Model 3'})
MERGE (b)-[:HAS_MODEL]->(m);

MATCH (b:Brand {name: 'Tesla'}), (m:CarModel {name: 'Model Y'})
MERGE (b)-[:HAS_MODEL]->(m);

MATCH (b:Brand {name: '比亚迪'}), (m:CarModel {name: '汉'})
MERGE (b)-[:HAS_MODEL]->(m);

MATCH (b:Brand {name: '比亚迪'}), (m:CarModel {name: '唐'})
MERGE (b)-[:HAS_MODEL]->(m);

MATCH (b:Brand {name: '宝马'}), (m:CarModel {name: '3系'})
MERGE (b)-[:HAS_MODEL]->(m);

MATCH (b:Brand {name: '蔚来'}), (m:CarModel {name: 'ET5'})
MERGE (b)-[:HAS_MODEL]->(m);

MATCH (b:Brand {name: '小米汽车'}), (m:CarModel {name: 'SU7'})
MERGE (b)-[:HAS_MODEL]->(m);

// 8. 车型 -> 版本关系
MATCH (m:CarModel {name: 'Model 3'}), (v:CarVersion {infoId: 'CI_001'})
MERGE (m)-[:HAS_VERSION]->(v);

MATCH (m:CarModel {name: 'Model 3'}), (v:CarVersion {infoId: 'CI_002'})
MERGE (m)-[:HAS_VERSION]->(v);

MATCH (m:CarModel {name: 'Model Y'}), (v:CarVersion {infoId: 'CI_003'})
MERGE (m)-[:HAS_VERSION]->(v);

MATCH (m:CarModel {name: '汉'}), (v:CarVersion {infoId: 'CI_004'})
MERGE (m)-[:HAS_VERSION]->(v);

MATCH (m:CarModel {name: '唐'}), (v:CarVersion {infoId: 'CI_005'})
MERGE (m)-[:HAS_VERSION]->(v);

MATCH (m:CarModel {name: '3系'}), (v:CarVersion {infoId: 'CI_006'})
MERGE (m)-[:HAS_VERSION]->(v);

MATCH (m:CarModel {name: 'ET5'}), (v:CarVersion {infoId: 'CI_007'})
MERGE (m)-[:HAS_VERSION]->(v);

MATCH (m:CarModel {name: 'SU7'}), (v:CarVersion {infoId: 'CI_008'})
MERGE (m)-[:HAS_VERSION]->(v);

// 9. 能源类型关系
MATCH (v:CarVersion {infoId: 'CI_001'}), (e:EnergyType {name: '纯电动'})
MERGE (v)-[:HAS_ENERGY_TYPE]->(e);

MATCH (v:CarVersion {infoId: 'CI_002'}), (e:EnergyType {name: '纯电动'})
MERGE (v)-[:HAS_ENERGY_TYPE]->(e);

MATCH (v:CarVersion {infoId: 'CI_003'}), (e:EnergyType {name: '纯电动'})
MERGE (v)-[:HAS_ENERGY_TYPE]->(e);

MATCH (v:CarVersion {infoId: 'CI_004'}), (e:EnergyType {name: '纯电动'})
MERGE (v)-[:HAS_ENERGY_TYPE]->(e);

MATCH (v:CarVersion {infoId: 'CI_005'}), (e:EnergyType {name: '插电混动'})
MERGE (v)-[:HAS_ENERGY_TYPE]->(e);

MATCH (v:CarVersion {infoId: 'CI_006'}), (e:EnergyType {name: '燃油'})
MERGE (v)-[:HAS_ENERGY_TYPE]->(e);

MATCH (v:CarVersion {infoId: 'CI_007'}), (e:EnergyType {name: '纯电动'})
MERGE (v)-[:HAS_ENERGY_TYPE]->(e);

MATCH (v:CarVersion {infoId: 'CI_008'}), (e:EnergyType {name: '纯电动'})
MERGE (v)-[:HAS_ENERGY_TYPE]->(e);

// 10. 配件节点
MERGE (p1:Part {partNo: 'P_001'})
  ON CREATE SET p1.name = '米其林轮胎 245/45 R19', p1.category = '轮胎', p1.brand = 'Michelin', p1.price = 1800.00;

MERGE (p2:Part {partNo: 'P_002'})
  ON CREATE SET p2.name = '博世刹车片', p2.category = '制动系统', p2.brand = 'Bosch', p2.price = 650.00;

MERGE (p3:Part {partNo: 'P_003'})
  ON CREATE SET p3.name = 'NOMI 车载智能伙伴', p3.category = '智能座舱', p3.brand = 'NIO', p3.price = 4900.00;

MERGE (p4:Part {partNo: 'P_004'})
  ON CREATE SET p4.name = '宁德时代三元锂电池 75kWh', p4.category = '动力电池', p4.brand = 'CATL', p4.price = 65000.00;

MERGE (p5:Part {partNo: 'P_005'})
  ON CREATE SET p5.name = '比亚迪刀片电池 85kWh', p5.category = '动力电池', p5.brand = 'BYD', p5.price = 58000.00;

MERGE (p6:Part {partNo: 'P_006'})
  ON CREATE SET p6.name = 'Brembo 四活塞刹车卡钳', p6.category = '制动系统', p6.brand = 'Brembo', p6.price = 12000.00;

MERGE (p7:Part {partNo: 'P_007'})
  ON CREATE SET p7.name = '空气悬架系统', p7.category = '底盘系统', p7.brand = 'Continental', p7.price = 25000.00;

MERGE (p8:Part {partNo: 'P_008'})
  ON CREATE SET p8.name = '哈曼卡顿音响系统', p8.category = '影音娱乐', p8.brand = 'Harman Kardon', p8.price = 8000.00;

MERGE (p9:Part {partNo: 'P_009'})
  ON CREATE SET p9.name = '毫米波雷达模组', p9.category = '智能驾驶', p9.brand = 'Bosch', p9.price = 3200.00;

MERGE (p10:Part {partNo: 'P_010'})
  ON CREATE SET p10.name = '激光雷达模组', p10.category = '智能驾驶', p10.brand = 'Hesai', p10.price = 6500.00;

// 11. 车辆版本使用配件关系（多车型交叉使用，方便测试图遍历）
// 米其林轮胎：BMW 330i + Model 3 长续航
MATCH (v:CarVersion {infoId: 'CI_006'}), (p:Part {partNo: 'P_001'})
MERGE (v)-[:USES_PART]->(p);

MATCH (v:CarVersion {infoId: 'CI_001'}), (p:Part {partNo: 'P_001'})
MERGE (v)-[:USES_PART]->(p);

// 博世刹车片：BMW 330i + 汉 EV
MATCH (v:CarVersion {infoId: 'CI_006'}), (p:Part {partNo: 'P_002'})
MERGE (v)-[:USES_PART]->(p);

MATCH (v:CarVersion {infoId: 'CI_004'}), (p:Part {partNo: 'P_002'})
MERGE (v)-[:USES_PART]->(p);

// NOMI：ET5 专属
MATCH (v:CarVersion {infoId: 'CI_007'}), (p:Part {partNo: 'P_003'})
MERGE (v)-[:USES_PART]->(p);

// 宁德时代三元锂电池：Model 3 长续航、Model 3 Performance、Model Y、ET5
MATCH (v:CarVersion {infoId: 'CI_001'}), (p:Part {partNo: 'P_004'})
MERGE (v)-[:USES_PART]->(p);

MATCH (v:CarVersion {infoId: 'CI_002'}), (p:Part {partNo: 'P_004'})
MERGE (v)-[:USES_PART]->(p);

MATCH (v:CarVersion {infoId: 'CI_003'}), (p:Part {partNo: 'P_004'})
MERGE (v)-[:USES_PART]->(p);

MATCH (v:CarVersion {infoId: 'CI_007'}), (p:Part {partNo: 'P_004'})
MERGE (v)-[:USES_PART]->(p);

// 比亚迪刀片电池：汉 EV、唐 DM-i
MATCH (v:CarVersion {infoId: 'CI_004'}), (p:Part {partNo: 'P_005'})
MERGE (v)-[:USES_PART]->(p);

MATCH (v:CarVersion {infoId: 'CI_005'}), (p:Part {partNo: 'P_005'})
MERGE (v)-[:USES_PART]->(p);

// Brembo 刹车卡钳：Model 3 Performance、SU7 Max
MATCH (v:CarVersion {infoId: 'CI_002'}), (p:Part {partNo: 'P_006'})
MERGE (v)-[:USES_PART]->(p);

MATCH (v:CarVersion {infoId: 'CI_008'}), (p:Part {partNo: 'P_006'})
MERGE (v)-[:USES_PART]->(p);

// 空气悬架：SU7 Max、ET5
MATCH (v:CarVersion {infoId: 'CI_008'}), (p:Part {partNo: 'P_007'})
MERGE (v)-[:USES_PART]->(p);

MATCH (v:CarVersion {infoId: 'CI_007'}), (p:Part {partNo: 'P_007'})
MERGE (v)-[:USES_PART]->(p);

// 哈曼卡顿音响：BMW 330i
MATCH (v:CarVersion {infoId: 'CI_006'}), (p:Part {partNo: 'P_008'})
MERGE (v)-[:USES_PART]->(p);

// 毫米波雷达：Model 3 长续航、Model Y、SU7 Max
MATCH (v:CarVersion {infoId: 'CI_001'}), (p:Part {partNo: 'P_009'})
MERGE (v)-[:USES_PART]->(p);

MATCH (v:CarVersion {infoId: 'CI_003'}), (p:Part {partNo: 'P_009'})
MERGE (v)-[:USES_PART]->(p);

MATCH (v:CarVersion {infoId: 'CI_008'}), (p:Part {partNo: 'P_009'})
MERGE (v)-[:USES_PART]->(p);

// 激光雷达：SU7 Max
MATCH (v:CarVersion {infoId: 'CI_008'}), (p:Part {partNo: 'P_010'})
MERGE (v)-[:USES_PART]->(p);

// 12. 统计查询
MATCH (n)
RETURN labels(n)[0] AS label, count(n) AS count
ORDER BY count DESC;
```

执行：

![](assets/5bc8af59215e.png)

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69be4dd43fb918000139fb28
