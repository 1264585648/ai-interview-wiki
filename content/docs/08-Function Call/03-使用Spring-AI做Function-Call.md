---
title: "✅使用Spring AI做Function Call"
---

# ✅使用Spring AI做Function Call

前面介绍过了Function Call的主要概念和用法之后，深入Spring AI，看看在Spring AI中如何做工具调用。

已有方法转成工具

假如，现在我已经有个现成的服务了，我想把他变成一个Function（Tool），可以这样做：

```text
@Configuration
public class FunctionCallConfiguration {
    @Bean
    @Description("根据用户输入的时区获取该时区的当前时间")
    public Function<TimeService.Request, TimeService.Response> getTimeFunction(TimeService timeService) {
        return timeService::getTimeByZoneId;
    }
}
```

也就是定义一个Bean，返回值是Function类型，构造函数中的参数是一个我们已经有的Spring中的服务，然后在这个方法中直接调用已有的方法即可。

记得需要增加一个清晰的描述，讲清楚这个Function是干什么的，这样才能让模型更好的知道什么时候可以调用这个工具。

以下是这个Function的定义，他有两个泛型类型参数，分别是T和R。

```text
/**
 * Represents a function that accepts one argument and produces a result.
 *
 * <p>This is a <a href="package-summary.html">functional interface</a>
 * whose functional method is {@link #apply(Object)}.
 *
 * @param <T> the type of the input to the function
 * @param <R> the type of the result of the function
 *
 * @since 1.8
 */
@FunctionalInterface
public interface Function<T, R> {

}
```

T表示这个function的入参，R表示出参。如我们定义的入参Request和出参Response如下：

```text
@Service
public class TimeService {
    public Response getTimeByZoneId(Request request) {
        ZoneId zid = ZoneId.of(request.zoneId);
        System.out.println("getTimeByZoneId");
        ZonedDateTime zonedDateTime = ZonedDateTime.now(zid);
        DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss z");
        return new Response(zonedDateTime.format(formatter));
    }


    public record Request(
            @JsonProperty(required = true, value = "zoneId") @JsonPropertyDescription("时区，比如 Asia/Shanghai") String zoneId) {
    }

    public record Response(String time) {

    }
}
```

这里在入参中，我们就可以加一些说明，也是为了让模型更清晰了解这些参数是什么，他才知道怎么调用。

定义新工具

如果是之前没有现成的工具，想要重新定义一个工具给LLM用的话，可以直接借助@Tool 注解：

```text
public class TimeTools {
    @Tool(description = "Get time by zone id")
    public String getTimeByZoneId(@ToolParam(description = "Time zone id, such as Asia/Shanghai")
                                  String zoneId) {
        ZoneId zid = ZoneId.of(zoneId);
        System.out.println("getTimeByZoneId");
        ZonedDateTime zonedDateTime = ZonedDateTime.now(zid);
        DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss z");
        return zonedDateTime.format(formatter);
    }
}
```

用@Tool把一个方法声明一个工具，用@ToolParam 来定义每个参数的描述。

这样定义的tool之后，可以把他直接给到chatClient，用tools方法把对应的工具new出来就行了。

```text
@GetMapping("/functionCall1")

public Flux<String> functionCall1(HttpServletResponse response, String city) {
    response.setCharacterEncoding("UTF-8");
    return chatClient
            .prompt().tools(new TimeTools())
            .user(city + "现在几点了？")
            .stream().content();
}
```

工具不自动执行

默认情况下，在Spring AI中，如果模型决策需要调用工具，Spring AI就会直接调用具体的工具了，如果你想自己控制工具的调用，比如在后续要讲的ReAct Agent中，要自己控制的话，可以通过这个参数控制：

```text
internalToolExecutionEnabled
```

把他设置为false的话，Spring AI就不会自动调用工具了，就需要开发者自己控制工具的调用。（后续会展开，这里了解即可）。

调用外部工具

Spring AI Alibaba也提供了一些集成的第三方工具，可以方便的调用，避免重复开发。已有工具列表：

https://java2ai.com/docs/1.0.0.2/practices/integrations/tool-calling/

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69796f8dd31fed000101afc4
