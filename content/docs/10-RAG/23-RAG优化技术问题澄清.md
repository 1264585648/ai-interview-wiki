---
title: "✅RAG优化技术：问题澄清"
---

# ✅RAG优化技术：问题澄清

问题澄清

虽然我们介绍了问题重写、查询优化等方案，来解决用户不会提问的问题，但是并不代表一定就能把用户的问题给回答好。

很多时候，当用户的问题存在模糊、不完整、歧义或需要额外上下文才能被准确回答时，还有一种简单直接的优化手段，那就是主动与用户进行交互，以获取更多信息或确认其真实意图，这个过程就叫做——**问题澄清。**

比如我们实现一个旅行规划助手，想要让他帮我们做行程规划，但是我们都知道，想要做行程规划，就需要知道用户什么时间、去哪里、几个人、行程上有什么偏好等。而很多用户一开始不一定会提供足够的信息，这时候就需要问题澄清帮我们做信息的收集。

以下，是我们定义的一个TravelPlanningAiService，这里面定义了一个chatWithTraveler的方法，他的系统提示词中主要包括三方面内容：

- 对话原则
- 信息收集
- 行程规划

我们通过提示词的方式，告知LLM需要先信息收集，然后再做行程规划。

```text
import dev.langchain4j.service.MemoryId;
import dev.langchain4j.service.SystemMessage;
import dev.langchain4j.service.UserMessage;

public interface TravelPlanningAiService {

    @SystemMessage("""
            你是一个专业的旅行顾问，擅长制定个性化的旅行方案。
            
            对话原则：
            1. 保持热情、友好的语调，像朋友一样自然对话
            2. 基于已有信息给出建议和想法
            3. 如需更多信息，自然地询问细节（避免"我需要更多信息"这样的表达）
            4. 当信息足够时，生成详细的旅行规划
            
            根据用户输入的不同性质，你需要：
            
            【信息收集阶段】
            - 说"听起来很棒！具体想..."来了解细节
            - 通过建议来引出问题："这个地方我很推荐！大概预算多少合适？"
            - 每次最多问1-2个相关问题
            
            【规划生成阶段】
            - 当掌握了目的地、时间、预算、人员等核心信息时
            - 生成包含具体日程、住宿、交通、活动的详细规划
            - 提供实用的旅行建议和注意事项
            
            始终提供有价值的内容，避免让用户感觉在被"审问"。
            """)
    String chatWithTraveler(@MemoryId String memoryId, @UserMessage String userInput);
}
```

这个方法需要注意，需要支持对话记忆，因为用户可能是多轮对话汇总之后才是他的所有要求和基本信息，这些都是LLM做规划的重要依据。所以需要有对话记忆的功能。

下面是我们提供的行程规划的controller，提供了三个方法：

- start：开启对话
- chatWithPlanner：对话，可能会要求需求澄清或者给出行程建议
- forcePlan：强行生成旅行建议

```text

@RequestMapping("/travelPlan")
@RestController
public class SmartTravelPlanningController {

    @Autowired
    private TravelPlanningAiService travelAiService;

    @RequestMapping("/start")
    public Map<String, String> startTravelPlanning(HttpServletResponse response) {
        response.setCharacterEncoding("UTF-8");

        String memoryId = UUID.randomUUID().toString();

        String welcomeMessage = """
                🌟 欢迎使用智能行程规划助手！
                
                我可以帮助您制定个性化的旅行计划。为了给您提供最佳的建议，我需要了解一些基本信息：
                
                • 您想去哪里旅行？
                • 计划什么时候出发？
                • 大概的预算范围？
                • 和谁一起旅行？
                • 您的兴趣爱好？
                
                请告诉我您的旅行想法，我会根据您提供的信息逐步完善行程计划！
                """;

        return Map.of(
                "sessionId", memoryId,
                "message", welcomeMessage
        );
    }

    @RequestMapping("/chat")
    public String chatWithPlanner(HttpServletResponse response,
                                  @RequestParam String memoryId,
                                  @RequestParam String message) {
        response.setCharacterEncoding("UTF-8");

        return travelAiService.chatWithTraveler(memoryId, message);
    }

    @RequestMapping("/force-plan")
    public String forcePlan(HttpServletResponse response, @RequestParam String memoryId) {
        response.setCharacterEncoding("UTF-8");

        return travelAiService.chatWithTraveler(memoryId,
                "请基于我们到目前为止的所有对话，生成完整详细的行程规划方案");
    }
}
```

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6975ed1fd31fed0001feb0c5
