---
title: "✅接入Spring AI 与Spring AI Alibaba"
---

# ✅接入Spring AI 与Spring AI Alibaba

前面在介绍百炼的时候，我们讲过可以通过curl发起一个http请求完成的百炼上面的模型的调用。我们这里主要是想把百炼通过springboot的方式同时接入Spring AI Alibaba和Spring AI。

使用Spring AI Alibaba做接入，可以快速的同时接入Spring AI和Spring AI Alibaba，也可以更加方便我们做模型开发，以及调用百炼上的模型。

但是这么做也有个缺点，那就是如果Spring AI的版本更新比较快，而Spring AI Alibaba没那么快的话，可能就没办法快速的用上新版本的特性了。

首先，我们先增加以下依赖（先不用管他是干啥的，后面会讲，先照做）

```text
<dependencyManagement>
		<dependencies>
			<dependency>
				<groupId>com.alibaba.cloud.ai</groupId>
				<artifactId>spring-ai-alibaba-bom</artifactId>
				<version>1.1.0.0</version>
				<type>pom</type>
				<scope>import</scope>
			</dependency>
		</dependencies>
	</dependencyManagement>

 <dependency>
            <groupId>com.alibaba.cloud.ai</groupId>
            <artifactId>spring-ai-alibaba-starter-dashscope</artifactId>
            <version>1.1.0.0</version>
 </dependency>
```

（**注意，不同的版本可能差异比较大，比如api什么的名称可能换了，请和我的保持一致，Spring AI 统一用1.1.0，Spring AI Alibaba 统一用 1.1.0.0）**

通过查看依赖，可以发现他底层其实是依赖了很多Spring AI的包：

![](assets/797c3881d611.png)

接在配置application.yml：

```text
spring:
  ai:
    dashscope:
      api-key: ${AI_DASHSCOPE_API_KEY}
```

这个配置中的dashscope是啥？百炼提供了一个DashScope（灵积）来帮我们更快的接入，dashscope，后面代码中会经常看到他，尤其是spring ai alibaba的包路径中很多都是带有dashscope的。

灵积通过灵活、易用的模型 API 服务，让各种模态模型的能力，都能方便的为 AI 开发者所用。通过灵积 API，开发者不仅可以直接集成大模型的强大能力，也可以对模型进行训练微调，实现模型定制化。

像上面这样，先把你前面申请的api key给他配置上。到这里就结束了，后面怎么用，我们后面继续讲。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69678f0f74e4030001107f85
