---
title: "✅Spring AI 核心特性：调用本地模型"
---

# ✅Spring AI 核心特性：调用本地模型

前面我们给大家讲过基于Ollama在本地部署模型，然后也演示了如何通过本地发送请求调用，但是如何在一个Spring应用中调用呢？本文介绍下。

其实Spring AI是有对ollama的支持的，其实就是这个spring-ai-ollama，这里面定义了一个OllamaChatModel

的ChatModel，ChatModel是啥前面介绍过了，如果到这里还不是知道啥是ChatModel，请反思。

所以，想要在你的Spring中接入ollama，需要先引入spring-ai-ollama：

```text
        <dependency>
            <groupId>org.springframework.ai</groupId>
            <artifactId>spring-ai-ollama</artifactId>
            <version>1.1.0</version>
        </dependency>
```

其次，如果想要实现向之前我们讲的代码那样，可以把OllamaChatModel直接注入到Spring的其他的Bean中，需要有一个starter才行。

这块我查了很多资料，网上给的资料都是引入spring-ai-ollama-spring-boot-starter，但是我在接入的时候，他的最新版是1.0.0-M6，如果直接引入他的话，应用在启动的时候会报错，主要是因为我的项目中用的spring ai的版本会更高，他们之间存在冲突。

后来经过我排查，其实在spring ai 的更新的版本当中，他把spring-ai-spring-boot-autoconfigure给拆分开了，如：

![](assets/37812cbc58ff.png)

而我依赖的spring-ai-ollama-spring-boot-starter他要靠spring-ai-spring-boot-autoconfigure做ollama的bean的初始化，但是这里面的一部分bean在spring ai新版本中拆分到上面这几个starter里面了，就会出现同一个bean多个地方初始化的情况。应用就会启动失败。

所以，当我发现这个问题的时候，我就猜想可能会有一个spring-ai-autoconfigure-model-ollama的1.0.0的单独的starter（网上没人提这个，可能是版本太新了），于是，就引入：

```text
 <dependency>
     <groupId>org.springframework.ai</groupId>
     <artifactId>spring-ai-autoconfigure-model-ollama</artifactId>
     <version>1.1.0</version>
 </dependency>
```

增加配置项：

```text
spring:
  ai:
    ollama:
      base-url: http://localhost:11434
      chat:
        model: deepseek-r1:7b
```

这样，就可以在我们的代码中，直接注入一个ollamaChatModel了：

```text
@Autowired
@Qualifier("ollamaChatModel")
private ChatModel ollamaChatModel;
```

然后当你想用ollama本地调用的时候，就可以用它来做对话调用：

```text
@RestController
@RequestMapping("/ai/ollama")
public class OllamaChatController {

    @Autowired
    @Qualifier("ollamaChatModel")
    private ChatModel ollamaChatModel;

    @GetMapping("/stream/chat")
    public Flux<String> streamChat(HttpServletResponse response) {
        response.setCharacterEncoding("UTF-8");
        Flux<ChatResponse> stream = ollamaChatModel.stream(new Prompt("你是谁？"));
        return stream.map(resp -> resp.getResult().getOutput().getText());
    }
}
```

应用启动后，访问下这个controller，就会发现，已经可以调到本地的deepseek模型了。

![](assets/ba05eb3c5f4c.png)

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6970aca33fb9180001020f9b
