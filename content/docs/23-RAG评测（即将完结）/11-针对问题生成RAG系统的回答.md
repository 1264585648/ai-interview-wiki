---
title: "✅针对问题生成RAG系统的回答"
---

# ✅针对问题生成RAG系统的回答

为了让我们的系统可以更加方便的根据数据集中的问题获取到回答和参考资料，我们可以单独写一个方法，简化一下chat方法的逻辑，比如取消卡片，返回内容也需要调整，比如过滤一些进度数据，返回值也要做格式化等等。

于是，我们单独提供一个DatasetController

```java
/**
 * 数据集生成接口
 * <p>
 * 用于根据用户问题生成回答，构建 Q&A 数据集。
 */
@RestController
@RequestMapping("/dataset")
@Slf4j
public class DatasetController {

    /**
     * 数据集生成默认用户ID
     */
    private static final String DATASET_USER_ID = "dataset-generator";

    /**
     * 临时会话标题最大长度
     */
    private static final int TITLE_MAX_LENGTH = 20;

    @Autowired
    private ChatApplicationService chatApplicationService;

    @Autowired
    private ChatConversationService chatConversationService;

    @Autowired
    private ChatMessageService chatMessageService;

    private IntentRecognitionService intentRecognitionService;

    @Autowired
    private ChatModel chatModel;

    @PostConstruct
    public void init() {
        intentRecognitionService = AiServices.builder(IntentRecognitionService.class).chatModel(chatModel)
                .chatMemoryProvider(memoryId -> MessageWindowChatMemory.builder().id(memoryId).maxMessages(10).build()).build();
    }

    /**
     * 生成数据集：基于用户问题，复用知识库 RAG 流程生成完整回答。
     * <p>
     * 入参：question（用户问题）
     * 出参：JSON 包含 question（用户问题）、answer（回答结果）、references（引用的参考资料）
     *
     * @param question 用户问题
     * @return 数据集结果（JSON）
     */
    @GetMapping("/generate")
    public DatasetResult generate(@RequestParam String question) {

        // 1. 创建临时会话，复用流式对话所需的上下文
        String tempTitle = question.substring(0, Math.min(question.length(), TITLE_MAX_LENGTH));
        String conversationId = chatConversationService.createConversation(DATASET_USER_ID, tempTitle);

        log.info("数据集生成开始: conversationId={}, question={}", conversationId, question);

        String messageId = chatMessageService.saveUserMessage(conversationId, question);
        String assistantMessageId = chatMessageService.saveAssistantMessage(conversationId);

        IntentRecognitionResult intentRecognitionResult = intentRecognitionService.chat(conversationId, question);
        // 2. 构造请求：仅依赖用户问题，其他业务字段置空
        ChatParam chatParam = new ChatParam(DATASET_USER_ID, conversationId, messageId, question, assistantMessageId, intentRecognitionResult);

        // 3. 调用流式对话，分别收集回答 token 和参考资料
        StringBuilder answerBuilder = new StringBuilder();


        chatApplicationService.doChat(chatParam)
                .doOnNext(event -> {
                    if (isAnswerToken(event)) {
                        answerBuilder.append(event);
                    }
                })
                .doOnError(e -> log.error("数据集生成异常: conversationId={}", conversationId, e))
                .blockLast();

        String answer = answerBuilder.toString();
        List<String> referenceContents = chatMessageService.getByMessageId(assistantMessageId).getRagReferences().stream().map(ChatMessage.RagReference::getChunkContent).collect(Collectors.toList());

        log.info("数据集生成完成: conversationId={}, answerLength={}, refsCount={}",
                conversationId, answer.length(), referenceContents.size());

        // 4. 组装结果
        DatasetResult result = new DatasetResult();
        result.setQuestion(question);
        result.setAnswer(answer);
        result.setReferences(referenceContents);
        return result;
    }

    /**
     * 判断流事件是否为最终答案 token，过滤掉控制事件
     */
    private boolean isAnswerToken(String event) {
        if (event == null || event.isEmpty()) {
            return false;
        }
        return !event.startsWith("[PROGRESS]")
                && !event.startsWith("[REFERENCE]")
                && !event.startsWith("[CARD_")
                && !event.startsWith("[DONE]");
    }

    /**
     * 数据集生成结果
     */
    @Data
    public static class DatasetResult {
        /**
         * 用户问题
         */
        private String question;
        /**
         * 回答结果
         */
        private String answer;
        /**
         * 引用的参考资料
         */
        private List<String> references;
    }
}
```

这个方法的请求方法是：

http://localhost:8009/dataset/generate?question=汽车如何启动？

得到的结果是：

```json
{
    "question": "如何启动车辆？",
    "answer": "要启动车辆，请按照以下步骤操作：\n\n1. 确保车辆处于安全的环境中，例如平坦的地面，并且驻车制动已启用。\n2. 检查仪表盘是否有任何警告灯点亮，特别是制动系统故障指示灯或电动助力转向严重故障指示灯。如果这些灯亮起，说明车辆存在潜在问题，需要先解决这些问题再进行启动。\n3. 确认换挡杆位于“P”（驻车档）或“N”（空档）位置。\n4. 踩下制动踏板，确保车辆不会意外移动。\n5. 按下启动按钮（或插入钥匙并转动至启动位置，具体取决于车辆设计）。此时，车辆应完成上电并启动发动机或激活电动系统。\n\n如果在启动过程中遇到问题，例如车辆无法启动或仪表盘显示异常警告灯，请将车辆停放至安全位置，并联系鸿蒙智行用户中心（电话：400-008-2888）进行进一步检查和维修。\n\n如需更详细的操作指引，您可以通过中控屏的“车主指南”应用或手机上的“鸿蒙智行”应用查看相关信息。",
    "references": [
        "d>制动系统故障指示灯：此灯点亮，表示制动系统存在故障、制动液位传感器故障或制动液位低，存在制动失灵的风险。为防止发生交通事故，请将车辆停放至安全位置并联系鸿蒙智行用户中心进行检修。</td></tr><tr><td>N</td><td>限速指示灯：此灯点亮，表示已检测到路面限速标识，限速标识数值是通过摄像头拍摄道路上的限速标识获得。N：请以实际识别的车速为准。</td></tr><tr><td></td><td>电动助力转向严重故障指示灯：此灯点亮，表示电动助力转向系统出现严重故障，请将车辆停放至安全位置并联系鸿蒙智行用户中心进行检修。</td></tr><tr><td></td><t",
        "# 驾驶车辆\n启动和下电.. .96\n换挡.. ..97\n制动.. ..98\n驻车.. ..103\n驾驶设置.. . 105\n行车记录仪.. ..109\n胎压监测系统. ..111\n电子不停车收费系统. ..112\n疲劳分神监测.. . 113",
        "# 注意\n注意标识提醒您，如果未按照该注意事项操作，可能会导致车辆相关功能无法使用，严重时可能会造成车辆损坏。",
        "阅《使用说明书》获取完整的信息，或通过车辆中控屏、手机获取车主指南最新信息。\n● 中控屏：打开“应用与服务 $>$ 应用中心”内的“车主指南”应用。\n● 手机：打开“鸿蒙智行”应用，进入“我的 $>$ 车主指南”。\n本手册版权归奇瑞汽车股份有限公司所有。未经奇瑞汽车股份有限公司书面同意，不得转载、复印或翻译手册内容。\n鸿蒙智行用户中心将为 R7 客户提供服务，如有任何问题，请联系鸿蒙智行用户中心或致电400-008-2888。\n车辆制造厂：奇瑞汽车股份有限公司\n地址：安徽省芜湖市经济开发区长春路 8 号\n鸿蒙智行官网：https://hima.auto\n版本号：R7OM25C1\n出版日期",
        "/td></tr><tr><td></td><td>陡坡缓降开启指示灯:此灯点亮,表示已开启陡坡缓降功能,但未激活。</td></tr><tr><td>A</td><td>智能远光灯未激活指示灯:启用智能远光灯功能,但是探测到前方有光线,远光灯未点亮。</td></tr><tr><td>N</td><td>此灯点亮,表示自适应巡航辅助(ACC)功能已满足激活条件但未激活。其中N以实际显示的数字为准。</td></tr><tr><td colspan=\"2\">此灯点亮，表示车道巡航辅助(LCC)功能已满足激活条件但未激活；此灯闪烁，表示LCC功能已暂停（LCC不再辅助驾驶员控制车辆方向）。"
    ]
}
```

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a1155e1d31fed000180dd05
