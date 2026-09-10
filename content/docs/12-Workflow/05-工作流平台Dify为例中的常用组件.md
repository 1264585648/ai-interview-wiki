---
title: "✅工作流平台（Dify为例）中的常用组件"
---

# ✅工作流平台（Dify为例）中的常用组件

本文拿 Dify举例，他支持通过可视化工作流（Workflow）来编排复杂的 AI 应用逻辑。在 Dify 的工作流编辑器中，用户可以通过拖拽组件节点的方式，快速构建从用户输入到最终输出的完整流程。

以下是 Dify 工作流中常用的组件及其功能说明。

1. 开始

![](assets/699887d0448f.png)

工作流的入口节点，接收用户输入（如文本、变量等）。他是自动创建的，必须要有的。

可以在输入节点中定义变量，如 `query`, `user_id` 等。

![](assets/337f6f517534.png)

2. LLM

![](assets/2a965f06eb81.png)

调用大模型生成文本，可配置提示词（Prompt）、模型类型（如 qwen、Claude、本地模型等）、可以设置温度、开启记忆等参数。并且支持配置失败重试、异常处理等。

![](assets/37edb7331703.png)

3. 条件分支

![](assets/1a76bddaca13.png)

类似编程中的 if-else，根据条件判断执行不同路径。

支持分别为if和else配置条件，条件支持很多，包括字符串比较、数值比较、包含判断、为空判断等。

![](assets/e4468a4fa727.png)

4. 代码执行

![](assets/806b3cedf3c8.png)

可以在这里运行自定义 Python 代码，处理数据或调用外部服务。

![](assets/e8bcf5f2b4d7.png)

输入/输出变量可配置。支持标准库及部分第三方库（如 requests, json）。

5. HTTP请求

![](assets/83490436cf92.png)

可以用来发送 HTTP 请求（GET/POST）。

![](assets/8d5bdbb2c92c.png)

6. 问题分类器

![](assets/e912cc6fd31b.png)

其实也是个LLM节点+条件分支的组合，只不过他专门用作意图识别的，可以配置多个不同的问题分类（意图），以及每个意图可以单独配置后续流程

![](assets/b843666243ed.png)

7. 直接回复

![](assets/5f391552bc84.png)

一般跟在LLM节点后面，把上一个节点的内容输出

8. 变量赋值

![](assets/deafd6973847.png)

创建或更新中间变量，用于后续节点引用。

![](assets/4565b762292a.png)

9. 循环

![](assets/664026c224cc.png)

对列表或数组进行迭代处理，里面可以配子工作流，循环也可以配置退出条件及循环内的变量。

![](assets/8029b4c44d55.png)

10.知识检索

![](assets/7436cab7a529.png)

基于向量相似度从已上传的知识库中检索相关文档片段，可以在这个节点中配置指定知识库。

![](assets/b3e1ea17cea0.png)

11.工具

在工作流中，除了节点外，还可以单独配置工具，工具可以是插件、MCP、甚至是另外一个工作流都可以。

![](assets/d4e69e2af0a1.png)

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69882c9dc71a890001c3d9ee
