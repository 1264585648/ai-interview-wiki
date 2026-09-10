---
title: "✅如何输出稳定的PPT？"
---

# ✅如何输出稳定的PPT？

在上一节中，我们已经介绍了 PPT 自动生成流程中的几个关键环节，包括 **需求澄清、信息收集、模板选择以及大纲生成**。通过这些步骤，系统已经明确了用户的核心需求，并确定了 PPT 的整体结构与内容框架。

接下来，本节将进入 **PPT 生成流程中最核心的部分**：**Schema 生成**。在这一阶段，系统会根据前面生成的大纲和所选模板，构建出完整的 PPT 页面结构描述（JSON Schema）。

Schema 生成（SchemaStrategy）

在完成 **PPT 大纲生成** 之后，系统就进入了整个流程中最核心的阶段之一：**Schema 生成**。

这一阶段的目标是：

**根据模板结构和大纲内容，生成完整的 PPT 页面结构 JSON。**

如果把 PPT 生成流程类比为一个生产过程，那么：

- **大纲阶段**：确定 PPT 有多少页，每页大致的内容有哪些
- **Schema 阶段**：就是确定每一页 PPT 的具体内容，也就是**每一页页面应该放什么内容、内容类型是什么、对应模板的哪个布局。 **

核心思想

在我们的系统中，并不是直接生成 `.pptx` 文件，而是先生成一个 **PptSchema JSON 结构**。例如：

```text
{
  "slides": [
    {
      "pageType": "COVER",
      "pageDesc": "封面页",
      "templatePageIndex": 1,
      "data": {
        "title": {
          "type": "text",
          "content": "人工智能技术发展",
          "fontLimit": 7
        }
      }
    }
  ]
}
```

这个 Schema 会描述：

- PPT 有多少页，对应slides的数组个数
- 每一页的类型是什么，COVER封面、CONTENT内容、END结尾等等
- 模板对应占位符的名称是什么
- 填充的类型是文字还是图片，如果是文字，字数限制又是多少

这样做有一个非常重要的工程优势：

**生成逻辑和最终 PPT 渲染逻辑完全解耦。**

Agent 只负责生成 **结构化内容**，而真正的 PPT 文件生成由渲染服务完成。

模板怎么做？

这边给出一个我制作好的PPT模板和Schema。比如我的PPT模板是5页。

[ai.pptx](https://tcs-devops.aliyuncs.com/storage/123sa245ab1047bdcd5a16d77fdb4bff538c?Signature=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJBcHBJRCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9hcHBJZCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9vcmdhbml6YXRpb25JZCI6IiIsImV4cCI6MTc4OTYxMTMwMiwiaWF0IjoxNzg5MDA2NTAyLCJyZXNvdXJjZSI6Ii9zdG9yYWdlLzEyM3NhMjQ1YWIxMDQ3YmRjZDVhMTZkNzdmZGI0YmZmNTM4YyJ9.XZslsGruiR4o5HbR41HnW8Xm5ej0SGlhwkT-WvwdDGI&download=ai.pptx)

打开我们的幻灯片模板ai.pptx，我们可以事先在准备这样一个PPT，可以看到这个PPT他的页面有很多元素。比如大标题、小标题、文本、图片、还有背景图，那我们要做的是什么？就是去将这些可变的元素进行替换填充到模板里去。

那如何精确的替换呢？答案就是占位符，我这边是直接使用的PPT提供的shape name来设置的。

点击开始→选择→选择窗格，就可以打开shape name设置的窗口。

![](assets/eaf37f91078f.png)

![](assets/99f3f229c033.png)

不同颜色的箭头，表示一一对应的关系，这样为每页设置好shape name后，就ok了。

但是值得一提的是，这种替换是有要求的，就是你需要定位到最深层最原始的那个文本框才可以，因为PPT是很复杂的，里面可能会包含很多组合的元素，针对组合元素的文本，你的窗格即使配置上了，也没法替换成功。这个大家需要注意一下。

Schema模板怎么写？

他的Schema如下所示，首先明确他的作用是什么，他的作用就是使用JSON这种结构化语言，能够做到和PPT的映射关系，从而可以让大模型生成这样一个JSON后，由PYTHON-PPTX来解析渲染成具体的PPT。

接下来我为大家讲解一下具体怎么去配置这样一个模板Schema。

```text
{
  "slides": [
    {
      "pageType": "COVER",
      "pageDesc": "封面页",
      "pageIndex": 1,
      "data": {
        "title": {
    		  "type":"text",
          "content": "大标题",
          "fontLimit": 7
        },
        "description": {
    		  "type":"text",
          "content": "一句话描述",
          "fontLimit": 30         
        },
        "author": {
    		  "type":"text",
          "content": "作者姓名",
          "fontLimit": 10
        }
      }
    },

    {
      "pageType": "CATALOG",
      "pageDesc": "目录页",
      "pageIndex": 2,
      "data": {
        "catalog1": {
    		  "type":"text",
          "content": "目录1",
          "fontLimit": 9
        },
        "catalog2": {
    		  "type":"text",
          "content": "目录2",
          "fontLimit": 9
        },
        "catalog3": {
    		  "type":"text",
          "content": "目录3",
          "fontLimit": 9
        }
      }
    },

    {
      "pageType": "COMPARE",
      "pageDesc": "内容页，用于2者对比",
      "pageIndex": 3,
      "data": {
        "title": {
    		  "type":"text",
          "content": "大标题",
          "fontLimit": 9
        },
        "content1": {
  	      "type":"text",
          "content": "对比项1内容",
          "fontLimit": 60
        },
        "content2": {
    		  "type":"text",
          "content": "对比项2内容",
          "fontLimit": 60
        }
      }
    },

    {
      "pageType": "CONTENT",
      "pageDesc": "内容页",
      "pageIndex": 4,
      "data": {
        "title": {
    		  "type":"text",
          "content": "大标题",
          "fontLimit": 9
        },
        "subTitle": {
    		  "type":"text",
          "content": "子标题",
          "fontLimit": 4
        },
        "content": {
    		  "type":"text",
          "content": "内容描述",
          "fontLimit": 55
        },
        "image": {
    		  "type":"image",
          "content": "根据需求生成配图",
          "url": "图片URL地址"
        }
      }
    },

    {
      "pageType": "END",
      "pageDesc": "结束页",
      "pageIndex": 5,
      "data": {
        "title": {
    		  "type":"text",
          "content": "结束页大标题",
          "fontLimit": 5
        }
      }
    }
  ]
}
```

在 Schema 中，每一页 PPT 都由几个核心字段组成：

- **pageType**：表示页面的类型，例如 `COVER`（封面页）、`CONTENT`（内容页）等
- **pageIndex**：表示该页面在模板中的页码，用于匹配模板中的具体版式
- **data**：表示该页面中需要填充的具体内容

其中，`data` 是一个 **键值结构**，每个 **key** 对应模板中某个 **shape name（形状名称）**，用于精准定位 PPT 模板中的元素。

每个字段都会包含以下信息：

- **type**：表示元素类型
- **content**：表示生成的内容
- **url**：用于图片资源地址（如果需要）

根据不同的 `type`，字段的含义也会有所不同：

文本类型

当 `type = text` 时，表示这是一个 **文本类型的 shape**：

- `content` 表示最终填充到 PPT 中的文本内容

例如：

- `title`：对应 PPT 中的 **主标题**
- `description`：对应主标题下方的 **说明文本**

对于文本类型，还需要额外增加一个 **fontLimit（字数限制）**。这是因为 PPT 模板中的 **文本框大小和样式是固定的**，如果生成的文本过长，超出文本框可承载的范围，就可能导致：

- 文本换行异常
- 字体被压缩
- 页面排版错乱

因此需要为每个文本字段设置一个 **合理的字数上限**，用于约束大模型生成内容的长度。

不过需要注意的是，大模型生成内容本身具有一定的 **随机性**。即使设置了 `fontLimit`，模型生成的 `content` 在个别情况下仍然可能超过限制，因此实际系统中通常还需要通过**后处理逻辑**进一步控制文本长度。

图片类型

当 `type = image` 时，表示该字段是 **配图元素**。

此时：

- `content`：表示 **文生图的提示词（Prompt）**
- `url`：表示生成图片后的资源地址，初始默认为空

在后续流程中，系统会根据 `content` 的提示词调用 **文生图服务生成图片**，再将生成后的图片地址回填到 `url` 字段中。

背景类型

当 `type = background` 时，表示该字段用于生成 **页面背景图**。它的结构与 `image` 类似：

- `content`：文生图提示词
- `url`：生成后的图片地址（初始为空）

在当前的模板中，为了保持整体视觉风格的统一，我并没有额外配置背景图，但系统本身是 **支持背景图生成能力的**。

这样设计 Schema 就可以做到：

- **模板结构与内容生成解耦**
- **不同元素类型可以统一管理**
- **方便后续替换文本、图片、背景**

同时也为后续的 **PPT 自动渲染阶段**提供了清晰、结构化的数据基础。配置完成后，我们就可以将JSON和PPT形成了一种映射的关系，当然我们的JSON Schema也要存储到表中：`AiPptTemplate`

![](assets/42b973454785.png)

执行流程

提示词生成

首先系统会获取前置阶段的关键数据：

```java
String templateCode = inst.getTemplateCode();
AiPptTemplate template = context.getPptTemplateService().getByCode(templateCode);
String templateSchema = template.getTemplateSchema();
String outline = inst.getOutline();
```

这里包含两个非常重要的输入：

- **templateSchema**：模板字段定义
- **outline**：大纲结构

随后构造生成 Schema 的 Prompt，这边的Prompt约束指令比较多，因为生成出的JSON Schema效果，就直接会影响到我们后续生成PPT的效果。

```java
/**
 * Schema生成提示词模板
 * 根据模板Schema和大纲生成PPT Schema
 */
public static final String getSchemaGenerationPrompt(String templateSchema, String outline) {
    return """
            ## 角色
            你是专业的PPT Schema生成专家。

            ## 任务
            根据模板Schema的定义和大纲，生成完整的PPT Schema JSON。

            ## 模板Schema（字段定义）
            %s

            ## PPT大纲
            %s

            ## 输出格式要求
            输出JSON格式，结构如下：
            {
              “slides”: [
                {
                  “pageType”: “页面类型（大写）”,
                  “pageDesc”: “页面描述”,
                  “templatePageIndex”: 模板页码索引,
                  “data”: {
                    “字段名”: { ... },
                    ...
                  }
                }
              ]
            }

          ......（省略，详细看代码）
}
```

调用模型生成 Schema

Prompt 构造完成后，系统调用大模型生成 JSON：

```java
String json = context.getChatModel()
        .call(new Prompt(prompt))
        .getResult()
        .getOutput()
        .getText();
```

随后使用 `BeanOutputConverter` 将 JSON 转换为对象：

```java
BeanOutputConverter<PptSchema> converter =
        new BeanOutputConverter<>(new ParameterizedTypeReference<>() {});

PptSchema pptSchema = converter.convert(json);
```

然后保存到数据库：

```java
String pptSchemaJson = JSON.toJSONString(pptSchema);

context.getPptInstService()
        .updatePptSchema(inst.getId(), pptSchemaJson, TARGET_STATUS);
```

此时系统已经获得了 **完整的 PPT 页面结构**。

图片生成机制

Schema 生成完成之后，系统会自动检测是否存在需要生成的图片。

核心逻辑在：

```java
processImageGeneration(pptSchema, sink, inst.getConversationId(), context);
```

这个方法会扫描所有Schema JSON的字段：

```java
for (Slide slide : pptSchema.getSlides()) {
    for (Map.Entry<String, FieldData> entry : slide.getData().entrySet()) {
```

如果字段类型是：

```text
image
background
```

并且 `url` 为空，就会触发图片生成。

图片生成流程

图片生成的流程如下：

**调用文生图大模型**

```java
String originalImageUrl =
        context.getImageGenerationService().generateImage(task.prompt);
```

获取Schema中的image或者background类型的，且url为空的字段的 content，也就是文生图提示词，调用文生图大模型，生成具体的图片，这边一般用一些低成品的文生图大模型就可以了，因为只是一些简单的配图，所以成品相对低很多。接口返回都是图片的URL，但是这种URL一般都是有时效性的。

**下载图片并上传至对象存储**

```java
// 下载图片并上传到MinIO
byte[] imageBytes = downloadImageFromUrl(originalImageUrl);

if (imageBytes != null && imageBytes.length > 0) {
    // 上传到MinIO
    String objectName = "ppt/" + conversationId + "/images/" + System.currentTimeMillis() + "_" + (i + 1) + ".png";
    String minioUrl = context.getMinioService().uploadFile(objectName, imageBytes, "image/png");
```

**更新 Schema**

最后更新字段 URL：

```java
// 更新schema中的url为MinIO地址
task.fieldData.setUrl(minioUrl);
```

这样 Schema 中的图片地址就变成了 **真实可访问的资源地址**。

当 Schema 中的内容全部准备完成后，系统会继续推进状态，进入最终的渲染阶段：

```text
context.continueStateMachine(inst, sink, query, thinkingBuffer);
```

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69aed439d31fed000124f4f0
