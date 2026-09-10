---
title: "✅Spring AI 核心特性：提示词模板管理"
---

# ✅Spring AI 核心特性：提示词模板管理

提示词模板

PromptTemplate，有一个默认渲染器（TemplateRenderer）——StTemplateRenderer，这个st其实是StringTemplate。他的实现的功能就是如果你传入`请给我推荐几个关于{topic}的开源项目` ，可以通过这个工具把其中的`topic`的内容替换成你想要的内容。

如以下代码：

```text
@GetMapping("/promptsEngineer6")
public Flux<String> chat6(@RequestParam(value = "message") String message, HttpServletResponse response) {
    response.setCharacterEncoding("UTF-8");

    PromptTemplate promptTemplate = new PromptTemplate("请给我推荐几个关于{topic}的开源项目");
    promptTemplate.add("topic", message);

    return chatClient.prompt(promptTemplate.create(Map.of("topic", message))).system("你是一个专业的的github项目收集人员").stream().content();
}
```

在提示词中我们预留了一个&#123;topic&#125;，然后可以根据用户的实际输入来指定他的具体内容，这就是一个简单的提示词模板的使用，像上面的代码，就用到了PromptTemplate这个类。

如果一段提示词模板中，有多个占位符的话，也可以直接通过传入一个map做全部替换：

```text
@GetMapping("/promptsEngineer7")
public Flux<String> chat7(@RequestParam(value = "message") String message, HttpServletResponse response) {
    response.setCharacterEncoding("UTF-8");

    HashMap variables = new HashMap();
    variables.put("language", "Java");
    variables.put("topic", message);
    PromptTemplate promptTemplate = PromptTemplate.builder().template("请给我推荐几个关于{topic}的开源项目,要求是和编程语言{language}相关的。").variables(variables).build();

    return chatClient.prompt(promptTemplate.create(Map.of("topic", message))).system("你是一个专业的的github项目收集人员").stream().content();
}
```

在实际开发的时候，我们一般会把提示词单独配置在一个配置文件中，比如xxx.st，然后通过spring注入的方式把文件中的内容注入到代码中，用于提示词构建。

修改分隔符

```text
PromptTemplate promptTemplate = PromptTemplate.builder()
    .renderer(StTemplateRenderer.builder().startDelimiterToken('<').endDelimiterToken('>').build())
    .template("""
            告诉我 5 部由 <composer> 作曲的电影名称。
            """)
    .build();

String prompt = promptTemplate.render(Map.of("composer", "John Williams"));
```

配置文件

通过配置文件管理提示词是一个比较好的方式，有的时候如果我们把提示词和代码放在一起，就会比较乱，然后想要修改也比较麻烦。

就像SQL文件我们也会单独放到一个文件里一样，我们也可以把提示词通过文件来管理，一般使用.st文件，可以在项目中定义一个目录，然后把所有提示词都放在这个目录下，如：

prompts/open-source-system-prompt.st文件内容：

```text
请给我推荐几个关于{topic}的开源项目,要求是和编程语言{language}相关的。
```

通过以下方式，就可以把提示词模板文件中的提示词的内容注入到你的bean中，这样就可以直接在代码中使用对应的提示词了。

这样可以更好的管理这些提示词，也更加方便后续的修改。

```text
@Value("classpath:prompts/open-source-system-prompt.st")
private Resource systemText;

@GetMapping("/chat2")
public Flux<String> chat2(@RequestParam(value = "message") String message, HttpServletResponse response) {
    response.setCharacterEncoding("UTF-8");

    HashMap variables = new HashMap();
    variables.put("language", "Java");
    variables.put("topic", message);
    PromptTemplate promptTemplate = PromptTemplate.builder().resource(systemText).variables(variables).build();

    return chatClient.prompt(promptTemplate.create(Map.of("topic", message))).system("你是一个专业的的github项目收集人员").stream().content();
}
```

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6968e4683fb9180001fafd40
