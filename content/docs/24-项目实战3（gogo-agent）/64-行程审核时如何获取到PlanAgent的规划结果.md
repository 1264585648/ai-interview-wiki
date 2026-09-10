---
title: "✅行程审核时如何获取到PlanAgent的规划结果？"
---

# ✅行程审核时如何获取到PlanAgent的规划结果？

行程审核和行程规划之间需要传递方案，但是我们**不是通过参数传递，而是通过 Redis 中转**。PlanAgent 把规划结果写进 Redis，ReviewTool 从同一个 key 读出来。（如果不考虑集群部署，可以考虑存储在本地磁盘上）

ItineraryPlanStore

这是审核与规划之间那道「解耦墙」。它只干两件事——写和读，但把 Key 格式和 TTL 收敛到一处，让写入方（ItineraryPlannerTool）和读取方（ItineraryReviewTools）永远用同一套约定：

```text
@Component
public class ItineraryPlanStore {

    private static final String KEY_PREFIX = "planner:result:";
    private static final Duration RESULT_TTL = Duration.ofHours(24);   // 中间数据，24h 自动清理

    public static String keyOf(String userId) {
        String uid = (userId == null || userId.trim().isEmpty())
                ? "default"
                : userId.trim().replaceAll("[^a-zA-Z0-9_.-]", "_");    // 安全字符过滤，防 key 注入
        return KEY_PREFIX + uid;
    }

    public void save(String userId, String resultJson) {
        redisTemplate.opsForValue().set(keyOf(userId), resultJson, RESULT_TTL);
    }

    public String load(String userId) {
        String content = redisTemplate.opsForValue().get(keyOf(userId));
        return (content == null || content.isBlank()) ? null : content;
    }
}
```

具体链路是这样的：

规划阶段，plan_itinerary 工具算完 4 套方案后，调 itineraryPlanStore.save(userId, resultJson) 把完整结果写进 Redis，key 是 planner:result:&#123;userId&#125;，TTL 24 小时。工具本身**只给 LLM 返回一个几百字节的摘要**（ok、combo_count、proposal_count 等），全量方案 JSON 不进对话上下文。

```text
// ItineraryPlannerTool.planItinerary()
String userId = sessionCtx.getUserId();
// ... 组合排序，得到 resultJson ...
itineraryPlanStore.save(userId, resultJson);   // 写 Redis
return buildSummary(...);                        // 只返回摘要给 LLM
```

审核阶段，PlanAgent 把 itinerary_review_agent 当工具调用（子智能体），审核子 agent 内部的 review_planner_result 工具**不接收方案 JSON 作为参数**，而是自己从 Redis 读：

```text
// ItineraryReviewTools.reviewPlannerResult()
String userId = sessionCtx.getUserId();                 // 同一个用户
String json = itineraryPlanStore.load(userId);          // 读 planner:result:{userId}
// 解析 proposals[] → 五维审核 → 返回报告
```

两边靠 ItineraryPlanStore 这个共享组件保证 key 格式一致：

```text
public static String keyOf(String userId) {
    if (!StringUtils.hasText(userId)) userId = "default";
    return "planner:result:" + userId.replaceAll("[^a-zA-Z0-9_.-]", "_");
}
```

**为什么用 Redis 而不是直接传参**——一份规划结果（4 套方案 × 交通酒店全字段 × 各维评分）可能几十 KB，如果作为参数在 LLM 之间传递，会严重膨胀上下文、还容易触发 JSON 解析失败。Redis 中转让写方只回摘要、读方直接取全量，双方上下文都保持精简。

**userId 是纽带**——规划智能体和审核智能体（工具+LLM）运行在同一次请求里，AgentSessionContext 通过 TransmittableThreadLocal 透明注入到两个工具的 sessionCtx 参数，getUserId() 拿到同一个用户 ID，因此指向同一个 Redis key。天然按用户隔离，不会串到别人的方案。

**修复重跑会覆盖**——如果审核不通过要修复，PlanAgent 重新调 plan_itinerary，新结果 save 到同一个 key 覆盖旧的，行程审核的时候再读就是修复后的版本。

**PlanAgent 写 ****planner:result:&#123;userId&#125;****，审核工具读同一个 key，****ItineraryPlanStore**** 是共享的读写门面，userId 保证两者对齐**。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a5b4cb63fb9180001cb7b5c
