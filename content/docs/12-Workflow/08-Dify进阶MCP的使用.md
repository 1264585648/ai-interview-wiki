---
title: "✅Dify进阶：MCP的使用"
---

# ✅Dify进阶：MCP的使用

Dify作为一个 AI 工作流平台，他肯定是支持MCP协议的，这里的支持分为两个方面：

1、支持把一个Dify上面的工作流作为一个MCP Server发布

2、支持在Dify中调用一个MCP Server

在之前的Dify的版本中，想要使用MCP，还是比较麻烦的需要各种插件，但是从Dify 1.6开始，已经支持双向MCP了，即上面的这两种，本文就是基于官方内置的MCP的支持介绍。

发布为MCP Server

如果我们在Dify上部署了一个工作流之后，想要在其他的地方集成他，比如在Cursor中的话，有个好的办法就是把他发布为一个MCP Server，然后在Cursor中使用它。

那就从实际需求出发：我们在cursor中看代码的时候，有的时候，想让cursor帮我们生成一些UML图，比如时序图、类图之类的，这样看起来就方便很多。

这样我们可以在Dify中搭建一个工作流，实现把代码转成UML图，这里我们用一个在大模型兴起之后非常火的mermaid。

mermaid，他是一种基于JavaScript的开源工具，它允许用户使用类似Markdown的简单文本语法来生成各种可视化图表，如流程图、时序图、甘特图、类图等，无需拖拽就能通过代码快速创建和渲染图表，非常适合在文档和网页中快速记录和分享复杂逻辑。

默认情况下，Cursor只会生成mermaid的文档，但是不会直接把图渲染出来，那么，我们就搞一个MCP实现这个功能。

![](assets/9e6a72ed2940.png)

MCP Server发布

搭建一个如下工作流：

![](assets/bce42e516464.png)

- 参数提取器：用于从用户输入中提取出符合mermaid语法的mermaid片段。

![](assets/6a081368dd42.png)

- MERMAID转换器：用于将mermaid的文本转成图片

![](assets/7a3bb86cc1cd.png)

以上工作流运行效果如下：

![](assets/8a28be2dabb6.png)

接着，我们把他发布成一个MCP。MCP默认是不开启的，在Dify 中应用程序的配置界面中，可以配置开启：

![](assets/afe3714441f1.png)

当你开启它时，Dify 会为你的应用程序生成一个唯一的 MCP 服务器地址。该地址作为外部工具的连接点。

![](assets/b8aef3b6a2d8.png)

完整DSL：

[Mermaid生成图片.yml](https://tcs-devops.aliyuncs.com/storage/103r1ca21d977170f34d7673b576e9071f42?Signature=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJBcHBJRCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9hcHBJZCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9vcmdhbml6YXRpb25JZCI6IiIsImV4cCI6MTc4OTYxMTY2NywiaWF0IjoxNzg5MDA2ODY3LCJyZXNvdXJjZSI6Ii9zdG9yYWdlLzEwM3IxY2EyMWQ5NzcxNzBmMzRkNzY3M2I1NzZlOTA3MWY0MiJ9.FZDahJzHt5Sp0v88TMi_hqis2CUlkHN929QYvLxci0w&download=Mermaid%E7%94%9F%E6%88%90%E5%9B%BE%E7%89%87.yml)

MCP Server调用

按照以上操作之后，就完成了这个步骤了，就可以通过这个服务断点URL来交互了。接着，我们在Cursor中使用这个MCP工具。

![](assets/1fae219bebdd.png)

把上面生成的url配置到这里：

![](assets/cffca6b2a06b.png)

保存后就能看到已经可以用了：

![](assets/117c91d9a889.png)

接着我们同样在cursor问问题，让他生成时序图。

![](assets/e2e4e95ceaeb.png)

可以看到这次的运行，多了一个生成图片的步骤。然后就能根据文件名，找到对应的图片了。

![](assets/ac62d568af19.png)

以上，我们就用Dify实现了一个MCP Server，然后在Cursor调用它。

调用MCP Server

Dify 在1.6之后，已经官方支持MCP了，不需要用任何插件（如之前的mcp插件）。现在只需要在工具-MCP中增加配置即可。

我们这里演示使用一个高德地图的MCP工具，帮我们在流程中实现路径规划。

三方MCP申请

百炼上提供了一些MCP的接入，比如高德地图相关的。

![](assets/eb3aa771b669.png)

第一次使用需要开通，开通的时候需要填入一个高德开放平台的key。

这个key想要获取，需要先登录到高德开放平台(https://lbs.amap.com/ )注册一个账号，个人使用和测试的话，选择个人开发者就行，用支付宝做一下实名认证即可。

注册成功账号之后，就可以在控制台创建一个应用，在创建好的应用中可以创建一个key：

![](assets/477f7ea20ecb.png)

这个key就可以把它复制到百炼上，就能开通成功了。

然后就可以在百炼中直接调用这个MCP服务，通过创建一个智能体，在其中配置上这个MCP：

![](assets/85e07e12d4c5.png)

然后对话，让他做形成规划：

![](assets/43885b8f5722.png)

![](assets/71b1b08485a8.png)

同时给出了一个导航的链接地址：

![](assets/8a7679dd40e2.png)

以上就实现了一个通过百炼调MCP的例子。当然，其实也可以不用百炼中转，直接通过高德提供的服务也能调。

https://lbs.amap.com/api/mcp-server/gettingstarted

这个是高德自己给的文档，可以快速的通过cursor、代码等等方式调用他的MCP Server

其他的MCP市场，以及官方的MCP的接入方案基本都差不多，只需要拿到他们的url和api key就可以。key一般都是通过开放平台来获取。

总之，**最重要的就是拿到一个断点URL和一个api key**，有了这些之后，就可以在Dify中调用了。

Dify中调用MCP

在Dify的工具->MCP页面中，我们可以新增MCP配置：

![](assets/bd8b3ef9e537.png)

在这个页面中输入mcp相关的信息，我配置的一个高德地图的MCP如下：

![](assets/7e825c15fc1f.png)

保存后，在右上角做一次授权，就可以看到所有的工具列表了。

![](assets/9c0905590c54.png)

![](assets/96be7fad3670.png)

然后就可以在工作流或者是Agent（可以是工作流中的Agent，也可以是单独的Agent）中来调用MCP服务：

1. **工作流直接调用工具：**

这种方式不能算是 function call，而是将我们注册的工具，当成工作流的一个节点来处理，比如：我们在LLM节点后面可以配置一个工具节点，这边同样也可以选择MCP，在工具节点的后面，我们还可以增加一个LLM节点来进行输出总结即可。

![](assets/0ade5174be05.png)

1. **工作流中的Agent:**

选择Agent节点，这边需要注意的是Agent策略，需要自行去Marketplace中安装。我这边选择的是React Agent，并配置MCP工具即可。

![](assets/302e52f6c07c.png)

![](assets/fba267743752.png)

1. **单独的Agent：**

先点击Agent tab页签，然后创建应用。

![](assets/e8da641570e3.png)

![](assets/77ddcb797013.png)

这里需要注意，建议在提示词中告知LLM使用工具，如"你擅长使用工具帮用户做路线规划"。这样LLM会优先考虑使用工具。

以下是我们问这个agent，如何从西溪湿地骑行到西湖。可以看他的执行过程，分别有三次调用了MCP的工具。实现了骑行路线的规划。

![](assets/3b6ac7e241fe.png)

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69882e58d31fed00010e2479
