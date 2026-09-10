---
title: "✅多模态RAG"
---

# ✅多模态RAG

![image.png](assets/3da5f40e987a.png)

多模态 RAG 是一种先进的 RAG 架构，它扩展了传统 RAG 仅处理文本的能力，使其能够理解和处理包含文本、图片、表格、公式等多种数据类型（即“多模态”）的文档。在处理复杂的 PDF 文档时，传统方法往往会丢失图片中的关键信息。多模态 RAG 通过结合多模态大模型和精细化的内容提取，确保在问答或信息检索时，AI 能够检索到文档中的所有相关内容，无论是文本还是图片，从而提供更准确、更全面的答案。

多模态RAG实现原理

在实际开发中，我们的PDF文档经常会包含**纯文本、图片、表格**等信息。传统 RAG 对于图片、复杂表格或公式**无法直接处理非文本信息**。当图片中包含关键数据图表、流程图或重要的文字截图时，传统流程会直接跳过或忽略这部分内容，导致在问答或信息提取时，系统检索不到文档中的全部关键知识，最终**生成不完整的答案**。

而首先我们要做的就是如何处理多模态文档，核心就在于如何识别文档中的图片，并**保持图文内容的原始阅读顺序**，其主要流程如下：

1. **内容提取与定位：**利用 PDFBox，逐页对 PDF 进行处理。代码同时提取页面的 **文本元素 **和 **图片元素**，并记录它们在页面上的精确坐标。
2. **多模态识别与描述：**对于提取出的每个图片，代码将其转换为 Base64 格式，并调用多模态大模型 API。多模态模型的任务就是识别图片中的文字、图表、公式，并生成详细的**纯文本描述**。
3. **内容元素排序与整合：**将提取出的文本片段和图片描述（此时已是文本形式）汇集成一个列表，并根据它们的原始坐标位置进行精确排序，以还原 PDF 的原始阅读顺序。
4. **结构化输出：**最终输出结果是一个统一的文本流。其中，原始文本直接输出，而图片描述则被特殊的 &lt;image&gt;...&lt;/image&gt; 标签包裹。

当我们通过上面的步骤清晰的处理了带有多模态的 PDF 文件后，我们就可以得到一个包含纯文本+图文含义的高质量输入源。然后就可以**丝滑衔接到我们之前学习过的标准 RAG 的流程**，如文档预处理、切片、向量化、检索增强生成等。下面我们来看下这几步前置处理流程如何来做（后续的RAG流程不再赘述）。

如何调用多模态大模型？

Spring AI提供了和图片、音频相关的模型，比如ImageModel，但是它主要是用来生图的，无法用来做图像识别。所以其实做图像识别，本质上还是生文，即`文+图生文` 。

可以借助Open AI的 ChatModel用以下方式来实现：

```text
    @RequestMapping("/callWithOpenAI")
    public String callWithOpenAI() throws URISyntaxException, MalformedURLException {

        OpenAiChatOptions options = OpenAiChatOptions.builder().temperature(0.2d).model("qwen3-vl-plus").build();
        OpenAiChatModel multimodalChatModel = OpenAiChatModel.builder().openAiApi(OpenAiApi.builder().baseUrl("https://dashscope.aliyuncs.com/compatible-mode/").apiKey(new SimpleApiKey("sk-8ef405c4686e456e91f6698272253126")).build()).defaultOptions(options).build();

        List<Media> mediaList = List.of(new Media(MimeTypeUtils.IMAGE_PNG, new URI("https://cdn.nlark.com/yuque/0/2025/png/5378072/1762350625634-664f1db7-e1c9-4daa-ab8e-81b6b7da5a68.png").toURL().toURI()));

        var userMessage = UserMessage.builder().text("请非常简要的描述一下你看到的这个图片?").media(mediaList).build();
        var response = multimodalChatModel.call(new Prompt(List.of(userMessage)));

        return response.getResult().getOutput().getText();
    }
```

我们首先构建我们的chatmodel，这边直接用new的方式去构建一个chatModel即可。在UserMessage这边需要填写两个参数，一个是提示词，就是你需要对这个图片怎么样去分析，还有就是media表示你真正的图片资源。

本质上Spring AI其实就是构建了如下的一个标准的api方式来请求多模态大模型，换句话说，你甚至都可以使用httpclient来请求也是一样的，只要按照API的要求构建相应的入参即可。

```text
curl --request POST \
  --url https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions \
  --header 'Accept: */*' \
  --header 'Accept-Encoding: gzip, deflate, br' \
  --header 'Authorization: Bearer sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' \
  --header 'Connection: keep-alive' \
  --header 'Content-Type: application/json' \
  --header 'User-Agent: PostmanRuntime-ApipostRuntime/1.1.0' \
  --data '{
	"messages": [
		{
			"role": "user",
			"content": [
				{
					"type": "image_url",
					"image_url": {
						"url": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20241022/emyrja/dog_and_girl.jpeg"
					}
				},
				{
					"type": "text",
					"text": "图中描绘的是什么景象?"
				}
			]
		}
	],
	"model": "qwen3-vl-plus",
	"stream": false,
	"temperature": 0.4
}'
```

![](assets/d991ade8a4b6.png)

另外，还可以借助Spring Ai Alibaba提供的DashScopeChatModel来实现，代码可以少写点：

```text
@Autowired
private ChatModel chatModel;

@RequestMapping("/callWithSpringAiAlibaba")
public String callWithSpringAiAlibaba() throws URISyntaxException, MalformedURLException {
    List<Media> mediaList = List.of(new Media(MimeTypeUtils.IMAGE_PNG, new URI("https://cdn.nlark.com/yuque/0/2025/png/5378072/1762350625634-664f1db7-e1c9-4daa-ab8e-81b6b7da5a68.png").toURL().toURI()));

    var userMessage = UserMessage.builder().text("请详细的描述一下你看到的这个图片?").media(mediaList).build();

    return chatModel.call(new Prompt(userMessage, DashScopeChatOptions.builder().withModel("qwen3-vl-plus").withMultiModel(true).build())).getResult().getOutput().getText();
}
```

这里有个坑需要注意，使用这个chatModel的时候，必须要增加参数`withMultiModel(true)` ，否则会报错，详见官方文档：[https://help.aliyun.com/zh/model-studio/error-code#error-url](https://help.aliyun.com/zh/model-studio/error-code#error-url)

如何处理文档？

对于PDF文档，这边选择使用了 **Apache PDFBox** 工具，它可以方便的从文档中提取出文本和图片。

**文档加载与初始化**

- 首先通过 PDDocument.load(pdfFile) 加载 PDF 文档，获取总页数后逐页处理。每一页会分别提取文本和图片内容，并按原始排版顺序整合。

**文本提取与定位**

- 对每组文本，计算其在页面中的坐标（x0, y0, x1, y1）。
- 提取的文本内容会被封装存储，并保留位置信息。

**图片提取与内容识别**

- 从 PDF 页面资源（PDResources）中遍历 XObject，筛选出 PDImageXObject 类型的图片对象。
- 获取图片位置，并转换为与文本统一的坐标体系。
- 将图片调用多模态模型能力，获取图片内容的文本描述。
- 图片描述被封装存储，同样保留位置信息。

**内容排序与原位整合**

- 按坐标合并当前页的所有文本和图片，确保与原始文档排版顺序一致。
- 遍历排序后的元素，文本直接拼接，图片则用 &lt;image&gt; 标签包裹其描述插入对应位置，
- 最终生成包含文本和图片原位信息的完整字符串。

增加依赖**（因为我们之间依赖过spring-ai-pdf-document-reader，其实下面的依赖已经默认有了）**：

```text
<dependency>
    <groupId>org.apache.pdfbox</groupId>
    <artifactId>pdfbox</artifactId>
    <version>3.0.5</version>
</dependency>
```

下面我们看下具体的代码实现逻辑（完整代码在PdfMultiModalProcessor中）：

```text
/**
     * 处理PDF文件，提取其中的文字和图片内容
     * 
     * @param pdfFile PDF文件对象
     * @return 按照阅读顺序整合后的文本内容（包含图片的文本描述）
     * @throws Exception 文件读取或处理过程中的异常
     * 
     * 处理流程：
     * 1. 加载PDF文档
     * 2. 逐页遍历处理
     * 3. 对每一页，使用自定义的UnifiedContentStripper同时提取文字和图片
     * 4. 按照坐标位置对提取的内容进行排序
     * 5. 按顺序拼接所有内容
     */
    public String processPdf(File pdfFile) throws Exception {
        try (PDDocument document = Loader.loadPDF(pdfFile)) {
            int totalPages = document.getNumberOfPages();
            StringBuilder finalText = new StringBuilder();
            log.info("开始处理PDF文件: {}, 总页数: {}", pdfFile.getName(), totalPages);

            // 逐页处理PDF文档
            for (int pageNum = 0; pageNum < totalPages; pageNum++) {
                PDPage page = document.getPage(pageNum);
                // 获取页面高度，用于坐标系转换（PDF坐标系原点在左下角，需要转换为从上到下的阅读顺序）
                float pageHeight = page.getMediaBox().getHeight();

                // 创建统一内容提取器，在一个生命周期内同时捕获图片和文字
                UnifiedContentStripper stripper = new UnifiedContentStripper(pageHeight);
                // 设置只处理当前页（PDFBox页码从1开始）
                stripper.setStartPage(pageNum + 1);
                stripper.setEndPage(pageNum + 1);
                // getText方法会触发内部的processOperator（捕获图片）和writeString（捕获文字）
                stripper.getText(document);

                // 获取当前页面提取到的所有内容元素（文字和图片）
                List<ContentElement> allElements = stripper.getElements();

                // 全局排序：按照Y轴坐标从上到下、X轴坐标从左到右排序
                // y0是相对于底部的距离，所以e2.y0 - e1.y0的结果是"从上到下"
                allElements.sort((e1, e2) -> {
                    // 如果Y轴坐标差距大于5像素，则认为不在同一行，按Y轴排序（从上到下）
                    if (Math.abs(e1.getY0() - e2.getY0()) > 5) {
                        return Integer.compare(e2.getY0(), e1.getY0());
                    }
                    // 如果在同一行（Y轴坐标差距小于等于5像素），则按X轴坐标排序（从左到右）
                    return Integer.compare(e1.getX0(), e2.getX0());
                });

                // 按照排序后的顺序，将所有内容元素拼接到最终文本中
                for (ContentElement element : allElements) {
                    finalText.append(element.getContent()).append("\n");
                }
                // 每页处理完后添加一个空行分隔
                finalText.append("\n");
            }
            log.info("PDF处理完成");
            // 返回去除首尾空白的最终文本
            return finalText.toString().trim();
        }
    }
```

首先就是 **load 加载文档**，然后**获取并遍历每一页的内容**，然后就是在每一页都抽取出**纯文本和图片**的部分，最后按照**坐标顺序进行融合排序**，生成一段**纯文本**。

我们再来看下 **processImage **做了什么工作？其实就是将页中的图片元素获取到，并记录坐标，接着将图片转为png，并调用图片转文字 方法，利用多模态大模型转成图片描述即可。

```text
    /**
     * 处理单张图片，将图片转换为Base64编码并调用AI进行图片识别
     * 
     * @param image PDFBox的图片对象
     * @return 图片的文本描述（通过AI识别得到）
     * 
     * 处理流程：
     * 1. 将PDImageXObject转换为BufferedImage
     * 2. 将BufferedImage编码为PNG格式的字节数组
     * 3. 将字节数组转换为Base64字符串
     * 4. 调用AI接口进行图片识别，获取文本描述
     * 5. 如果处理失败，返回错误提示
     */
    private String processImage(PDImageXObject image) {
        try {
            // 创建字节数组输出流，用于存储图片数据
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            // 将PDF图片对象转换为BufferedImage
            BufferedImage bufferedImage = image.getImage();
            // 将图片以PNG格式写入输出流
            ImageIO.write(bufferedImage, "png", baos);
            byte[] imageBytes = baos.toByteArray();

            // 将图片字节数组转换为Base64编码字符串
            String base64Image = Base64.getEncoder().encodeToString(imageBytes);
            // 调用AI接口，将图片转换为文本描述
            String description = image2Text(base64Image);
            return description;
        } catch (Exception e) {
            log.error("图片处理异常", e);
            // 处理失败时返回错误提示
            return "[图片处理错误]";
        }
    }

    public String image2Text(String imageBase64) {
        // TODO: 接入真实的AI图片识别服务
        return "图片介绍吧啦啦啦";
    }
```

代码的实现关键在于内部类UnifiedContentStripper，它继承了PDFBox的PDFTextStripper：

- 拦截文字：重写writeString方法，捕获文本及其坐标
- 拦截图片：重写processOperator方法，拦截PDF的"Do"指令（图片绘制命令），从CTM变换矩阵中获取图片位置和尺寸
- 统一坐标系：将PDF底部坐标系（原点在左下）转换为阅读坐标系（相对于底部的距离），使文字和图片可以统一排序

先拿我们之前准备的文档，在里面随便放了3张网上的汽车图片：

[汽车用户手册（2023年版）.pdf](https://tcs-devops.aliyuncs.com/storage/103s47537d9672275d11b1810bd8cefd81e8?Signature=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJBcHBJRCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9hcHBJZCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9vcmdhbml6YXRpb25JZCI6IiIsImV4cCI6MTc4OTYwMjQ2MywiaWF0IjoxNzg4OTk3NjYzLCJyZXNvdXJjZSI6Ii9zdG9yYWdlLzEwM3M0NzUzN2Q5NjcyMjc1ZDExYjE4MTBiZDhjZWZkODFlOCJ9.DvmlVhRIUMXkjJPCYpJ_OH7DU1LEchnUg8Xu0wIKgmE&download=%E6%B1%BD%E8%BD%A6%E7%94%A8%E6%88%B7%E6%89%8B%E5%86%8C%EF%BC%882023%E5%B9%B4%E7%89%88%EF%BC%89.pdf)

然后执行下以上代码：

![image.png](assets/8517c8f8d004.png)

可以看到文档中的图片部分已经替换成我mock的描述内容了。

接着，我们就是需要把前面讲的都串起来，就能实现一个多模块的RAG了。下一章节用一个实际case展开。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6978c3363fb918000108bcb9
