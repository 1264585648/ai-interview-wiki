---
title: "✅RAG问题澄清——对话卡片的实现"
---

# ✅RAG问题澄清——对话卡片的实现

我们在项目中实现了一个功能：当用户问题缺少必要信息（如车辆信息）时，通过卡片式UI引导用户补充选择，而非直接拒绝或猜测。

![image.png](assets/6814771f01dc.png)

流程是：用户发问 → 意图识别 → 信息完备性检查 → 缺信息则返回卡片 → 前端渲染卡片 → 用户选择 → 携带选择重新提问

后端实现

意图识别

IntentRecognitionService 使用 LangChain4j 的 @SystemMessage + @AiService 注解，通过 LLM 对用户问题进行意图分类，输出结构化的 IntentRecognitionResult，包含：

- related — 是否与汽车领域相关
- intent — 具体意图分类（售前、售后、技术支持、营销等）
- entities — 从用户问题中提取的实体（car_id、car_model 等）

信息完备性判断 + 卡片数据返回

核心逻辑在 ChatApplicationService.chat()：

```
public Flux<String> chat(ChatParam chatParam) {
    KnowEngineIntent intent = KnowEngineIntent.getIntent(chatParam.intentRecognitionResult());

    // 场景1: 维保/技术支持 → 需要 car_id
    if (intent == CAR_MAINTENANCE || intent == CAR_TECH_SUPPORT) {
        if (chatParam.intentRecognitionResult().entities().car_id() == null) {
            List<MyCar> myCars = myCarService.getCarByUserId(chatParam.userId());
            if (CollectionUtils.isEmpty(myCars)) {
                return Flux.just("[WARN]:您还没有添加车辆信息，请先添加车辆信息");
            } else {
                return Flux.just("[CARD]:请先选择车辆")
                    .concatWith(Flux.just("[CARD_CHOICE_MYCAR]:" + JSON.toJSONString(...)));
            }
        }
    }

    // 场景2: 营销政策 → 需要 car_model
    if (intent == CAR_MARKETING) {
        if (chatParam.intentRecognitionResult().entities().car_model() == null) {
            return Flux.just("[CARD]:请先选择您要咨询的车辆")
                .concatWith(Flux.just("[CARD_CHOICE_CAR]:" + JSON.toJSONString(...)));
        }
    }

    return doChat(chatParam); // 信息充足，走正常RAG流程
}
```

通过约定前缀来区分不同类型的SSE消息：

| 前缀 | 含义 |
| --- | --- |
| ** [WARN]: ** | 警告提示（无车辆时） |
| ** [CARD]: ** | 卡片提示文字 |
| ** [CARD_CHOICE_MYCAR]: ** | "我的车辆"选择卡片（JSON数据） |
| ** [CARD_CHOICE_CAR]: ** | 车型选择卡片（JSON数据） |
| [PROGRESS]: | 进度通知 |
| [DONE]: | 流结束标记 |

前端实现

SSE 流解析与分发

在 chat.html 中，通过 data: 前缀匹配来分发不同类型的消息：

```
if (data.startsWith('[CARD]:')) {
    renderCardPrompt(aiMessageElement, data.substring(7).trim());
}
if (data.startsWith('[CARD_CHOICE_MYCAR]:')) {
    const cars = JSON.parse(data.substring(20).trim());
    renderMyCarChoices(aiMessageElement, cars);
}
if (data.startsWith('[CARD_CHOICE_CAR]:')) {
    const cars = JSON.parse(data.substring(18).trim());
    renderCarInfoChoices(aiMessageElement, cars);
}
```

卡片渲染

renderCardPrompt() — 渲染提示文字（如"请先选择车辆"）

renderMyCarChoices() — 渲染用户已绑定车辆的卡片网格

renderCarInfoChoices() — 渲染所有可选车型的卡片网格

卡片使用 CSS Grid 布局（.card-choice-grid），每张卡片展示车辆图片、名称、车牌/颜色等信息。

用户选择回调

handleMyCarSelect() — 用户选中自己的车辆后，自动填入"我的车辆是：xxx"并携带 myCarId、carId 重新发送

handleCarInfoSelect() — 用户选中车型后，自动填入"我想咨询的车辆是：xxx"并携带 carId 重新发送

选择后重新走一遍完整对话流程，此时意图识别会从用户消息中提取到 car_id/car_model 实体，信息完备性检查通过，进入正常 RAG 对话。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a05f9dec71a89000129fccc
