---
title: "✅支持多轮对话后的问题重写踩坑与LLM对比"
---

# ✅支持多轮对话后的问题重写踩坑与LLM对比

在我们的项目中，我们讲过我们在一次对话中，做了两次Redis记忆的删除，最开始我的实现中，只删除了第一次，没有删除第二次。这样就会有个坑。

如果不删除第二次redis，那么在RAG检索的时候，内存中（Redis）的对话记忆会包含前面意图识别的的内容，即用户问题和意图识别的结果都有。

那么，在问题重写这里，我们会从内存中（Redis）取出对话记忆，然后试图做指代消除和上下文补全。

因为会读取到意图识别的LLM的结果，那么该写的提示词在替换了占位符之后就是这样的：

```
你是一个汽车智能客服助手，你的职责范围是汽车相关的咨询场景，包括购车咨询、车型信息、保养维修、保险年检、售后服务等。你需要对用户的问题进行改写，使得改写后的问题在查询向量数据库/关系型数据库/图数据库时有更好的结果，并删除任何无关信息，确保查询简洁明了、具体明确。下面有一些改写的策略。\n\n1、简洁改写。问题可能比较长，包含了一些无意义的语气词、修饰词或者重复的词语等。尤其是问题在询问车型配置、价格政策时，且包含一些无意义的日期、编号等修饰词。改写规则：删除无意义的词语使其更适合搜索引擎检索，疑问句要转成陈述句。\n2、抽象概念改写。前提：用户的问题一定在询问汽车相关的问题，且是一些比较具体的细节问题，比如\"我的车每次踩刹车的时候都有吱吱吱的声音很吵怎么办\"。需要改写成类似\"车辆刹车异响故障排查\"，将具体的问题转化为更基础、更简洁、更抽象的问题。\n3、错别字改写。用户的问题包含了错别字或者是一些常见的汽车术语用户打成了对应的拼音。大小写不一样不属于错别字。错别字需要给出纠正结果。\n4、车型信息提取。如果用户提到了具体的车型信息（品牌、型号、年款等），需要将其标准化提取。比如\"特斯拉毛豆3\"改写为\"Tesla Model 3\"，\"比亚迪汉\"保持不变。\n5、结合历史对话和最新提问，识别出所有相关的细节、术语和上下文信息。最后，将这条提问重新组织成一个清晰、简洁且独立完整的格式，以便于进行信息检索。\n\n上面是5种改写策略，需要逐一使用最终给出一个统一的改写结果。直接输出改写后的结果，不需要输出思考过程及额外的多余内容。如果不需要改写，则直接输出原问题即可。\n\n下面是几个示例：\n\nInput：我如果想买一辆特斯拉Model 3的话，大概需要多少钱啊\nOutput：Tesla Model 3官方指导价\n\nInput：我的车该保养了，多久保养一次？\nOutput：车辆保养周期规定\n\nInput：我的比亚迪汉刹车有点异响是怎么回事\nOutput：车辆刹车异响故障排查\n\nInput：毛豆Y续航多少\nOutput：Tesla Model Y续航里程\n\nInput：保险什么时候到期？\nOutput：车辆保险到期查询\n\nInput：年检怎么办理？\nOutput：车辆年检办理流程\n\nInput：我想了解一下你们那款新出的电动车的配置\nOutput：新款电动车车型配置参数\n\n历史对话内容：\nUser: 我的车汽车打不着火怎么回事\nUser: 我的车辆是：宝马 3系 2025款 325Li M运动套装（京B·M11223）\nYou must answer strictly in the following JSON format: {\n\"reasoning\": (type: string),\n\"related\": (type: boolean),\n\"intent\": (type: string),\n\"entities\": (type: cn.hollis.llm.mentor.know.engine.ai.model.IntentRecognitionResult$Entities: {\n\"car_model\": (type: string),\n\"car_id\": (type: string),\n\"order_id\": (type: string),\n\"dealer\": (type: string),\n\"fault_description\": (type: string),\n\"appointment_time\": (type: string),\n\"part_name\": (type: string),\n\"function_name\": (type: string)\n})\n}\nAI: {\n\"reasoning\": \"1.相关性：涉及宝马3系，相关。2.场景：用车阶段。3.辨析：用户描述‘打不着火’，可能是寻求故障原因或解决方法，属于技术咨询而非进店维修。-> 车辆使用与技术指导\",\n\"related\": true,\n\"intent\": \"车辆使用与技术指导\",\n\"entities\": {\n    \"car_model\": \"宝马 3系 2025款 325Li M运动套装\",\n    \"car_id\": \"京B·M11223\",\n    \"order_id\": null,\n    \"dealer\": null,\n    \"fault_description\": \"打不着火\",\n    \"appointment_time\": null,\n    \"part_name\": null,\n    \"function_name\": null\n    }\n}\n\n用户提问：我的车辆是：宝马 3系 2025款 325Li M运动套装（京B·M11223）\n\n非常重要的一点是：你只需要提供重新组织后的提问，不要包含任何其他内容！绝对不要在提问前添加任何多余的文字！\n
```

可以看到，这里面包含了这样的内容：

1、 User: 我的车汽车打不着火怎么回事\nUser: 我的车辆是：宝马 3系 2025款 325Li M运动套装（京B·M11223）\nYou must answer strictly in the following JSON format: &#123;\n\"reasoning\": (type: string),\n\"related\": (type: boolean),\n\"intent\": (type: string),\n\"entities\": (type: cn.hollis.llm.mentor.know.engine.ai.model.IntentRecognitionResult$Entities: &#123;\n\"car_model\": (type: string),\n\"car_id\": (type: string),\n\"order_id\": (type: string),\n\"dealer\": (type: string),\n\"fault_description\": (type: string),\n\"appointment_time\": (type: string),\n\"part_name\": (type: string),\n\"function_name\": (type: string)\n&#125;)\n&#125;\n

2、AI: &#123;\n\"reasoning\": \"1.相关性：涉及宝马3系，相关。2.场景：用车阶段。3.辨析：用户描述‘打不着火’，可能是寻求故障原因或解决方法，属于技术咨询而非进店维修。-> 车辆使用与技术指导\",\n\"related\": true,\n\"intent\": \"车辆使用与技术指导\",\n\"entities\": &#123;\n    \"car_model\": \"宝马 3系 2025款 325Li M运动套装\",\n    \"car_id\": \"京B·M11223\",\n    \"order_id\": null,\n    \"dealer\": null,\n    \"fault_description\": \"打不着火\",\n    \"appointment_time\": null,\n    \"part_name\": null,\n    \"function_name\": null\n    &#125;\n&#125;\n\n

因为有这两部分内容的存在，导致我们默认用的LLM的改写结果会完全错误，这块我写了个ChatModelBenchmarkTest，来使用上面的提示词，针对几个主要的模型做了对比，表格如下：

测试方法：benchmarkDifferentModels

| 模型 | 回答 | 耗时**（关闭思考）** |
| --- | --- | --- |
| qwen-max-latest | 宝马 3系 2025款 325Li M运动套装 无法启动故障排查 | 2238 |
|  | 宝马3系2025款325Li M运动套装车辆信息查询 | 5691 |
| qwen3.6-max-preview | 宝马3系2025款325Li M运动套装车辆信息 | 3066 |
|  | 宝马 3系 2025款 325Li M运动套装车辆信息 | 7847 |
| qwen3.6-flash | &#123; "reasoning": "1.相关性：涉及宝马3系，相关。2.场景：用车阶... | 8322 |
|  | &#123; "reasoning": "1.相关性：涉及宝马3系，相关。2.场景：用车阶... | 1607 |
| qwen3-30b-a3b-instruct-2507 | 车辆打不着火故障排查 | 470 |
|  | 车辆打不着火故障排查 | 1518 |
| qwen3.5-27b | 宝马 3系 2025款 325Li M运动套装车辆信息 | 1072 |
|  | 宝马 3系 2025款 325Li M运动套装车辆信息 | 4318 |
| deepseek-r1-distill-qwen-7b | ```json {     \"reasoning\": \"1.相关性：涉及宝... | 4619 |
|  | ```json &#123;     \"reasoning\": \"1.相关性：用户提... | 7989 |
| deepseek-r1-distill-qwen-32b | 宝马 3系 2025款 325Li M运动套装（京B·M11223） | 8730 |
|  | 宝马 3系 2025款 325Li M运动套装打不着火故障排查 | 6000 |

因为我们默认用的是qwen-max-latest这个比较古早的模型，他的速度还可以，但是输出结果是不稳定的，经常会把意图识别为我要查询车辆信息，但其实我是想问这个车型的汽车无法启动怎么办。

然后我又针对效果最好的qwen3-30b-a3b-instruct-2507单独做了个20轮的测试，测试方法：benchmarkSameModelMultipleCalls，得到结果：

回答正确率：90%

平均耗时: 1564 ms

最小耗时: 437 ms

最大耗时: 5375 ms

得出的结论是，即使是效果最好的模型，也有10%的概率识别错误，错误的结果主要是输出了一个json，就像上面的deepseek-r1-distill-qwen-7b模型一样，原因大家可以猜猜为啥。。

那么，到这里我发现换模型可能没办法彻底解决了，虽然换参数量更大的，更新的模型会更加稳定，但是那个耗时也太长了。

所以，我最终这里采用了二次删除Redis的方案，也就是在意图识别之后，做RAG检索+LLM对话之前，先把Redis中的对话记忆删除了，这样后面再读取记忆就从数据库读取了，而数据库中的内容是干净的，不包括意图识别的结果的。（因为我没存，如果存了也可以过滤）

以上这个其实就是一种多agent之间的上下文隔离的手段。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a05f4b851b14400019bef1c
