---
title: "✅Spring AI 核心特性：Advisor"
---

# ✅Spring AI 核心特性：Advisor

Spring AI 中提供了一个灵活且强大的方式，可以用于拦截、修改和增强 Spring 应用中的 AI 交互功能，那就是Advisor，通过利用Advisor，开发者可以创建更复杂、可重用且易于维护的 AI 组件。

可以把Advisor理解为插件，比如我们想要实现记忆功能，就可以用到Memory相关的Advisor

![](assets/f2580e2175c2.png)

实现日志记录相关的功能，我们就可以添加一个日志的Advisor：

![](assets/5a6cec841c8a.png)

Spring AI中也提供了一些列内置的Advisor

![](assets/c981a11aa255.png)

我们看一下Advisor接口的定义，其实没啥东西，主要是他继承自Ordered，需要在他的所有视线中实现`int getOrder();` 这个方法。这个方法主要是用来设置各个Advisor的顺序的。

```text
public interface Advisor extends Ordered {
    int DEFAULT_CHAT_MEMORY_PRECEDENCE_ORDER = -2147482648;

    String getName();
}
```

他还有几个子接口。主要就是CallAdvisor、StreamAdvisor以及BaseAdvisor。

![](assets/76f7d66c9513.png)

其中最基础的两个接口，一个是CallAdvisor一个是StreamAdvisor，一个是给同步调用使用的，另一个是给流式调用使用的。别贴提供了adviseCall和adviseStream方法。

```text
public interface CallAdvisor extends Advisor {
    ChatClientResponse adviseCall(ChatClientRequest chatClientRequest, CallAdvisorChain callAdvisorChain);
}

public interface StreamAdvisor extends Advisor {
    Flux<ChatClientResponse> adviseStream(ChatClientRequest chatClientRequest, StreamAdvisorChain streamAdvisorChain);
}
```

其实Advisor的执行过程，就和AOP是一样的，他会把所有注册到一个chatClient上的Advisor都找出来，然后按顺序执行。

在DefaultChatClient中会有一个advisorChain，这里面就是所有注册进来的advisor，以此调用这些advisor的adviseCall方法。（如果是流式调用，就是调用adviseStream方法）

![](assets/c39e7920ba46.png)

![](assets/c4bbe94dc389.png)

这个adviseCall方法是怎么实现的呢(adviseStream类似，拿adviseCall为例）？其实主要分4类：

![](assets/b5eec58c3dc6.png)

- ChatModelCallAdvisor
- SimpleLoggerAdvisor
- SafeGuardAdvisor
- BaseAdvisor

ChatModelCallAdvisor

ChatModelCallAdvisor的adviseCall的实现很简单，就是直接调用chatModel的call方法，可以理解为直接和大模型交互了。

![](assets/d86ec0acbdfb.png)

因为直接直接要和大模型交互，其实这个advisor的话理论上应该是最后执行的，所以他的getOrder设置的是最低优先级。

```text
@Override
public int getOrder() {
    return Ordered.LOWEST_PRECEDENCE;
}
```

SimpleLoggerAdvisor

这个是一个内置的日志打印的advisor，adviseCall实现如下：

![](assets/88073e154c3f.png)

其实就是在调用下一个advisor之前先记录一下request的日志，在调用之后，再记录一下response的日志。

SafeGuardAdvisor

这是一个spring ai内置的安全审查的advisor，其实主要的实现内容就是做敏感词拦截：

![](assets/2d8ee679afe5.png)

BaseAdvisor

这个是除了以上几个advisor之外，所有其他advisor的接口，他的实现充分的体现了AOP的机制：

![](assets/01440fc9e648.png)

在调用下一个advisor之前，先调用自己的before方法，再调用拿到结果之后，再调用自己的after方法。

那么也就是说，我们可以自定义advisor的话，如果想在模型调用前或者调用后做一些其他事情，都可以实现这个接口，比如我们前面用到过很多次的MessageChatMemoryAdvisor

他的before和after实现如下，就是做记忆的记录。

![](assets/ab701e06c84a.png)

最后，再贴一张spring ai官方给出的advisor的调用流程图：

![](assets/e1faccb5fca6.png)

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6970a759c71a890001affc81
