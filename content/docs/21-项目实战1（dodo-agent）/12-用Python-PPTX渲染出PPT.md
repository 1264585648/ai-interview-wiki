---
title: "✅用Python-PPTX渲染出PPT"
---

# ✅用Python-PPTX渲染出PPT

在上一节中，我们已经完成了 **Schema 的生成**。Schema 本质上是一个 **描述 PPT 页面结构的 JSON 数据**，其中包含：

- 每一页使用哪个模板页
- 每个 shape 需要填充什么内容
- 是否需要生成图片
- 文本内容和字数限制

但是 **Schema 本身并不是 PPT 文件**，接下来系统需要根据这个 JSON 结构，**真正渲染出 ****`.pptx`**** 文件**，这就是本节要介绍的 **PPT 渲染阶段**。这一阶段主要完成三件事：

1. 根据 Schema 解析页面结构
2. 根据模板复制页面并填充内容
3. 最终生成可下载的 PPT 文件

RenderStrategy

当状态机进入 `RENDER` 状态后，会执行 `RenderStrategy`。

核心逻辑如下：

```java
Mono.fromCallable(() -> {
    String pptSchemaJson = inst.getPptSchema();
    return context.getPythonRenderService().renderPpt(inst, pptSchemaJson);
})
```

这里会调用 `PythonRenderService` 来完成真正的 PPT 渲染。

也就是说：

**Java 只负责流程编排，而真正的 PPT 生成由 Python 完成。**

为什么使用 Mono 触发异步任务

在 `RenderStrategy` 中，PPT 渲染并不是直接调用方法执行，而是通过 `Mono` 来触发：

```java
Mono.fromCallable(() -> {
    String pptSchemaJson = inst.getPptSchema();
    return context.getPythonRenderService().renderPpt(inst, pptSchemaJson);
})
.subscribeOn(Schedulers.boundedElastic())
.subscribe();
```

这样设计主要有两个原因。

**第一，支持任务可控（可终止）。**

`Mono.subscribe()` 会返回一个 `Disposable` 对象，系统会将其保存起来：

```java
context.setDisposable(inst.getConversationId(), disposable);
```

当用户点击“停止生成”或任务需要被中断时，就可以通过 `Disposable.dispose()` 终止当前任务。因此使用 `Mono` 可以让渲染任务具备 **可取消能力**。

**第二，避免阻塞流式输出。**

在渲染开始前，系统会先输出一条提示信息：

```java
sink.tryEmitNext(context.createThinkingResponse("正在渲染PPT...\n"));
```

如果直接同步执行 `renderPpt`，由于渲染过程涉及 **启动 Python、文件处理等耗时操作**，会阻塞当前线程，导致这条消息无法及时发送到前端。通过 `Mono.fromCallable()` 并指定：

```text
subscribeOn(Schedulers.boundedElastic())
```

可以将渲染任务放到 **独立线程池** 中执行，从而保证：

- 流式消息能够立即返回
- 渲染任务在后台执行
- 不影响整体交互体验

因此，这里使用 `Mono` 的核心目的，是让 **渲染任务既可以被终止，又不会阻塞流式输出**。

为什么使用 Python 进行 PPT 渲染

在技术选型上，其实有两种方案：

方案一：Java + Apache POI

Java 中可以使用 `Apache POI` 来操作 PPT。

但在实际使用中会遇到很多问题：

- 对复杂模板支持较差
- 图片、背景处理复杂
- 样式容易丢失
- Group shape 支持不好

方案二：Python + python-pptx

最终系统选择了 **python-pptx**。

原因很简单：

- 对 PPT 结构支持更完整
- 操作 API 更简单
- 模板兼容性更好
- Python 生态更适合做文档处理

因此整个架构变成：

```text
Java (Agent流程控制)
        ↓
Python 渲染脚本
        ↓
生成 PPT 文件
```

Java 负责整个流程的调度，

Python 负责 **文档渲染**。

这种架构其实在智能体工程上非常常见。python的类库确实很方便，很强大。

Java 如何驱动 Python 渲染

通过 `ProcessBuilder` 启动 Python 脚本。

```java
ProcessBuilder pb = new ProcessBuilder(command);
pb.redirectErrorStream(true);
```

python 脚本的核心命令类似：

```python
python render_ppt.py --template template.pptx --output output.pptx
```

然后通过 **环境变量传递 Schema JSON**：

```java
env.put("PPT_SCHEMA", pptSchema);
```

如果 JSON 太大，则写入临时文件：

```java
env.put("PPT_SCHEMA_FILE", tempFile.toAbsolutePath().toString());
```

这样 Python 端就可以读取 Schema。

这种方式有两个好处：

- 避免命令行参数长度限制
- 方便传输复杂 JSON 数据

render_ppt.py

Python 渲染脚本的核心入口是：

```python
render_ppt(template_path, schema_json, output_path)
```

整个渲染流程大致分为 **5 个步骤**。

解析 Schema

首先解析 JSON：

```python
schema = json.loads(schema_json)
slides_data = schema.get("slides", [])
```

这里会得到：

```text
[
  {
    pageType: "COVER",
    templatePageIndex: 1,
    data: {...}
  }
]
```

每个元素代表 **一页 PPT**。

加载模板

接下来加载 PPT 模板：

```python
prs = Presentation(template_path)
```

模板中的每一页其实就是 **一个布局模板**。

例如：

```text
1 封面
2 目录
3 内容页
4 内容页
```

后续所有 PPT 页面，都是从这些模板页 **复制出来的**。

复制模板页

系统会根据 `templatePageIndex` 复制对应模板页：

```python
new_slide = duplicate_slide(prs, t_idx)
```

复制逻辑非常复杂，因为需要完整复制：

- shape
- 图片资源
- 关系引用
- 背景
- group shape

脚本通过 **直接操作 PPT XML** 来完成复制。

这样可以保证：

- 模板样式完全保留
- 图片资源不会重复写入
- 文件体积不会膨胀

填充内容

复制完页面后，就会填充内容：

```python
fill_slide(new_slide, data)
```

这里的逻辑是：

**根据 shape name 匹配 JSON 字段。**

例如：

```text
shape.name = title
JSON key = title
```

匹配成功后进行填充。

文本填充

文本使用：

```python
replace_text_keep_style()
```

核心思想是：

**只替换文本内容，不改变样式。**

这样可以保证：

- 字体
- 颜色
- 大小
- 对齐方式

全部保持模板设计。

同时会根据 `fontLimit` 控制文本长度，这里我选择的是暴力截断，保证PPT样式不错乱，当然你可以选择不截断，反正我们生成的PPT是可编辑的，你可以自己再手动调整即可。

图片填充

如果字段类型是 `image`：

```text
type = image
```

并且 URL 存在，就会下载图片：

```text
requests.get(url)
```

然后替换模板中的图片 shape。

背景图填充

如果字段类型是 `background`：

```text
type = background
```

系统会直接修改 PPT XML：

```python
# 清理新页面的旧背景
new_bg = new_slide._element.cSld.find(f"{{{ns}}}bg")
if new_bg is not None:
    new_slide._element.cSld.remove(new_bg)

# 复制背景 XML 并更新里面的 rId
bg_copy = deepcopy(source_bg)
update_xml_rids(bg_copy)

# 将背景插入到 <p:cSld> 的最前面
new_slide._element.cSld.insert(0, bg_copy)
```

将背景图设置为页面背景。

删除模板页

在所有页面生成完成后，需要删除原始模板页：

```text
delete_slide(prs, i)
```

因为模板页只是 **用于复制的占位页**。

最终只保留生成后的内容页。

生成 PPT 文件

最后保存 PPT：

```text
prs.save(output_path)
```

生成 `.pptx` 文件，返回文件路径。

JAVA保存至minio

```java
// ---------- 检查输出 ----------
File outputFile = new File(outputFilePath);
if (!outputFile.exists()) {
    throw new RuntimeException("PPT未生成: " + outputFilePath);
}

// ---------- 上传到MinIO ----------
log.info("PPT生成成功，开始上传到MinIO");
byte[] fileBytes = Files.readAllBytes(outputFile.toPath());

// 构建MinIO对象名称: ppt/{conversationId}/{filename}
String objectName = "ppt/" + inst.getConversationId() + "/" + outputFileName;

String fileUrl = minioService.uploadFile(objectName, fileBytes, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
```

1. 读取文件
2. 上传到 MinIO
3. 返回下载地址

完整渲染流程

整个 PPT 渲染流程如下：

```text
Schema JSON
      ↓
RenderStrategy
      ↓
Mono 异步触发任务
      ↓
Java 调用 Python 脚本
      ↓
解析 Schema
      ↓
加载 PPT 模板
      ↓
复制模板页
      ↓
填充文本 / 图片 / 背景
      ↓
删除模板页
      ↓
生成 PPT 文件
      ↓
上传 MinIO
      ↓
返回下载链接
```

生成最终答案（SuccessStrategy）

当 PPT 渲染完成后，状态机会进入最后一个状态：`SUCCESS`，此时系统会执行 **SuccessStrategy**。

这个阶段的主要作用是：

**生成最终的回复内容，并返回给用户。**

简单来说，就是在 PPT 文件生成完成后，让大模型生成一段总结性说明，例如：

- PPT 已经生成完成
- 一共多少页
- 下载地址在哪里
- 如果需要修改可以继续提出需求

这样用户不仅能拿到文件，还能获得一个自然语言的反馈。

这边需要注意的是：根据当前操作类型构造不同的 Prompt。

如果是 **创建 PPT**，使用创建总结 Prompt：

```java
prompt = PptBuilderPrompts.getSummaryPrompt(requirement, fileUrl, pageCount);
```

如果是 **修改已有 PPT**，则使用修改总结 Prompt：

```java
prompt = PptBuilderPrompts.getModifySummaryPrompt(modifyRequest, fileUrl);
```

这样大模型就可以根据不同场景生成更合适的回复内容。

随后系统会调用大模型进行流式生成：

```java
context.getChatClient().prompt()
    .messages(new UserMessage(prompt))
    .stream()
    .content()
```

每生成一段内容，就会实时推送给前端，当然这边的类型不再是thinking，而是text：

```java
sink.tryEmitNext(context.createTextResponse(chunk));
```

这样用户可以看到 **逐步生成的最终回答**。

当生成完成后，系统会将结果保存到会话记录中，确保上下文会话的完整性：

```java
context.getSessionService().updateAnswer(request);
```

最后系统会：

- 结束流式输出 `sink.tryEmitComplete()`
- 清理修改模式标记

```java
context.setModifyMode(false);
context.setModifyQuery(null);
```

至此，整个 PPT 生成流程正式结束。

异构系统协作方式

1. 脚本驱动：可以通过执行shell命令让java调用python，也可以python 调用java，不需要额外的部署服务，完全脚本执行，所以特别适合PPT渲染这类任务，因为我们需要python的功能，就是PPTX文件的解析和渲染，用完即走，简单高效。

缺点：扩展性差，写死脚本路径，复用性较弱。

1. HTTP调用：可以将python服务，封装成web，比如可以使用python的fastapi，那我们的java就可以通过http接口来调用，这种方式更加的标准化。

缺点：就是我们需要额外管理其他服务，运维和部署的成本就会比较高。

1. MCP：底层是http，json-rpc协议，所以他天然就是支持跨语言的，这种方式更适合智能体调用工具的架构，MCP就是目前最主流的异构系统协作的方案。

缺点：就是开发部署成本相对比较高，并且后续会有上下文膨胀的问题。

小结

PPT 渲染阶段主要解决 **“如何把 JSON Schema 变成真实 PPT”** 的问题。整个设计的核心思想是：

**结构生成与文档渲染完全解耦。**

- 大模型负责生成 **结构化内容（Schema）**
- Python 负责 **模板渲染**
- Java 负责 **流程控制**

这种架构不仅 **稳定性更高**，也让整个系统更容易扩展，至此，整个 **AI 自动生成 PPT 的完整流程**就全部完成了。在上一节中，我们已经完成了 **Schema 的生成**。Schema 本质上是一个 **描述 PPT 页面结构的 JSON 数据**，但是 **Schema 本身并不是 PPT 文件**。系统需要根据这个 JSON 结构，**真正渲染出 ****`.pptx`**** 文件**，这就是本节要介绍的 **PPT 渲染阶段**。而`SuccessStrategy` 是整个 PPT 生成流程的最后一步。当 PPT 渲染完成后，系统会根据生成结果（如 PPT 下载地址和页数）构建总结 Prompt，调用大模型生成一段自然语言的最终回复，并以流式方式返回给用户，让用户能够立即看到生成进度和结果说明。

在回复生成结束后，系统会将最终答案和推理过程保存到会话记录中，并清理相关任务状态，从而完成整个 PPT 生成任务的闭环。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69aed4eaa7c8ff00016cc75a
