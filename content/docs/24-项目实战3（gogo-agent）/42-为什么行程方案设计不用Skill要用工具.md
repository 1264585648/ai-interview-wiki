---
title: "✅为什么行程方案设计不用Skill要用工具？"
---

# ✅为什么行程方案设计不用Skill要用工具？

整个行程规划流程分为两个阶段，恰好对应使用了2种能力：

![](assets/2832acd24ebc.png)

数据收集天然适合 Skill：调用外部 API 本质就是按照文档拼接命令参数，LLM 擅长理解"搜索上海到杭州的航班"然后映射到正确的 CLI 命令。

但方案计算为什么不能也用 Skill？反而要封装一个工具呢？有以下几个原因

原因一：组合爆炸，LLM 无法枚举（重要）

假设搜索返回 5 个去程航班、3 个酒店、4 个返程航班，笛卡尔积就是 5×3×4 = 60 种组合。每种组合需要计算总价、总耗时、政策合规性、偏好分，然后做全局归一化排序。

如果让 LLM 做这件事（无论是"推理"还是"写脚本"），它面临的困境是：

```text
// 这段"思考"需要 LLM 在上下文中展开 60 个组合的逐一计算
// Token 消耗：60 组合 × 每个约 200 token ≈ 12000 token 纯计算
// 而且极易出错（忘记某个组合、归一化公式写错、小数精度丢失）
```

Java @Tool 的执行时间？**毫秒级**，且零 token 消耗。

```text
// ItineraryPlannerTool.java —— buildCombinations 方法
for (Map<String, Object> ob : outbound) {
    for (Map<String, Object> hotel : hotelList) {
        for (Map<String, Object> ib : inbound) {
            Map<String, Object> combo = tryBuildCombo(ob, hotel, ib, ...);
            if (combo != null) combos.add(combo);
        }
    }
}
```

原因二：归一化要求全局视野

min-max 归一化的公式是：score = (value - min) / (max - min) × 100

这要求**先遍历所有组合拿到 min/max，再回头给每个组合打分**。这是一个两遍扫描的操作。

如果用 Skill（让 LLM 逐个处理），LLM 必须先"记住"所有组合的数值，再反过来计算。在长上下文中，LLM 对中间位置的数值记忆会衰减（Lost in the Middle 问题），归一化结果很可能失真。

Java 代码则简洁且精确：

```text
// ItineraryPlannerTool.java —— normalizeTimeAndPrice 方法
double lo = combos.stream().mapToDouble(c -> (double)c.get("total_transit_min")).min().orElse(0);
double hi = combos.stream().mapToDouble(c -> (double)c.get("total_transit_min")).max().orElse(0);
for (Map<String, Object> c : combos) {
    c.put("time_score", minmaxScore((double)c.get("total_transit_min"), lo, hi, false));
}
```

原因三：政策合规不允许"差不多"（重要）

差旅政策是硬性约束：酒店每晚不超过 400 元、总预算不超过 5000 元、只允许经济舱。这些规则的判断必须是 > / &lt;= 的精确比较，不是 LLM 的"我觉得可能超了"。

一个真实的边界案例：

酒店单价 399.50 元/晚，政策限额 400 元/晚

LLM 可能回答"基本合规"，但代码会明确判定 399.50 &lt;= 400.0 → pass。更复杂的是舱位校验——需要中英文别名映射：

```text
// ItineraryPlannerTool.java —— cabinMatches 方法
private boolean cabinMatches(String actual, String allowed) {
    if (actual == null || allowed == null) return false;
    String a = actual.trim().toLowerCase();
    String b = allowed.trim().toLowerCase();
    // "经济舱" 匹配 "economy"，"商务舱" 匹配 "business" 等
    return a.contains(b) || b.contains(a) || aliasGroup(a).equals(aliasGroup(b));
}
```

原因四：上下文窗口经济性（重要）

一次行程规划的数据流中各环节的 token 消耗对比：

| 环节 | 如果用 Skill | 用 @Tool 的实际消耗 |
| --- | --- | --- |
| 输入候选数据 | ~3000 token (JSON) | ~3000 token (传入参数) |
| 组合计算过程 | ~12000 token (LLM推理) | **0 token**<br>（JVM 内执行） |
| 归一化+排序 | ~5000 token (LLM推理) | **0 token** |
| 输出结果 | ~2000 token (LLM生成JSON) | ~200 token (摘要) |
| **总额外消耗** | **~19000 token** | **~200 token** |

同时，Skill 文档本身（SKILL.md）需要占据上下文窗口才能被 LLM 参考。tuniu-cli 的 SKILL.md 有 157 行，加上 references 可达数百行。如果再为"规划计算"单独写一个 Skill，上下文窗口会更加拥挤。

原因五：输出结果不需要上下文感知（重要）

如果用skill的话，这个过程的运行都在llm中，那么最终输出的所有组合结果，LLM都会感知到。

而如果我们用Tool的话，Tool的执行是代码执行的，LLM不感知执行过程，我们可以在工具中把方案的组合结果保存在一个文件中，然后Tool只返回文件地址，方案条数等等信息就行了。

而下一个review过程，只需要从具体的地址取出文件，在做审核就行了。而review也可以搞一个工具，在工具内部读文件，也同样省上下文。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a5a0aa73fb9180001cb145d
