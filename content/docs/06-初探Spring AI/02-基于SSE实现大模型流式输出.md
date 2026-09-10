---
title: "✅基于SSE实现大模型流式输出"
---

# ✅基于SSE实现大模型流式输出

上一节我们介绍用HTTP Client方式调用大模型的时候，提到了说页面返回比较慢，是因为我们没有做流式输出。

所谓流式输出，其实就是不需要等全部内容都返回后一起展示出来，而是可以在过程中一部分一部分的展示出来。现在主流的AI对话工具都是用的流式输出的方式，这样可以减少用户的等待时间，用户体验更好。

做流式输出，最常见的方式就是SSE，即Server-Sent Events，这是一种**服务器向客户端推送数据的 Web 技术**，它基于 HTTP 协议，允许服务器单向地向客户端发送数据流。

因为它能推送，所以可以一个字一个字推送，那么客户端上面就可以是一个字一个字的显示了。

你提供的内容是一个 HTTP 请求报文，具体是客户端（比如浏览器或某个程序）向服务器发起的一个请求，目的是建立一个 Server-Sent Events (SSE) 连接。

SSE

SSE 肯定也是基于 HTTP 协议的，浏览器向服务器发起一个 HTTP 请求。该请求是一个标准的 HTTP 请求，但需要保持长连接，直到服务器向客户端推送数据。

比如用curl的方式，向百炼发送一个请求，要求他流式输出（stream=True）：

```text
curl -X POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions \
-H "Authorization: Bearer $DASHSCOPE_API_KEY" \
-H "Content-Type: application/json" \
--no-buffer \
-d '{
    "model": "qwen-plus",
    "messages": [
        {"role": "user", "content": "你是谁？"}
    ],
    "stream": true,
}'
```

服务器以流的形式响应该请求，并且该连接会保持打开状态。服务器可以随时发送数据到客户端，而客户端无需重新请求。服务器发送的数据是按照特定的格式发送的，通常是以 UTF-8 编码的文本数据，以 "事件流" 的形式分段。

如以上请求的部分返回内容：

```text
data: {"choices":[{"delta":{"content":"","role":"assistant"},"index":0,"logprobs":null,"finish_reason":null}],"object":"chat.completion.chunk","usage":null,"created":1768391649,"system_fingerprint":null,"model":"qwen-plus","id":"chatcmpl-4bbf022b-e68c-9848-8328-dc401165051d"}

data: {"choices":[{"finish_reason":null,"logprobs":null,"delta":{"content":"我是"},"index":0}],"object":"chat.completion.chunk","usage":null,"created":1768391649,"system_fingerprint":null,"model":"qwen-plus","id":"chatcmpl-4bbf022b-e68c-9848-8328-dc401165051d"}

data: {"choices":[{"delta":{"content":"通义千"},"finish_reason":null,"index":0,"logprobs":null}],"object":"chat.completion.chunk","usage":null,"created":1768391649,"system_fingerprint":null,"model":"qwen-plus","id":"chatcmpl-4bbf022b-e68c-9848-8328-dc401165051d"}

data: {"choices":[{"delta":{"content":"问（Q"},"finish_reason":null,"index":0,"logprobs":null}],"object":"chat.completion.chunk","usage":null,"created":1768391649,"system_fingerprint":null,"model":"qwen-plus","id":"chatcmpl-4bbf022b-e68c-9848-8328-dc401165051d"}

data: {"choices":[{"delta":{"content":"wen），是"},"finish_reason":null,"index":0,"logprobs":null}],"object":"chat.completion.chunk","usage":null,"created":1768391649,"system_fingerprint":null,"model":"qwen-plus","id":"chatcmpl-4bbf022b-e68c-9848-8328-dc401165051d"}

data: {"choices":[{"delta":{"content":"阿里巴巴集团旗下的通义实验室"},"finish_reason":null,"index":0,"logprobs":null}],"object":"chat.completion.chunk","usage":null,"created":1768391649,"system_fingerprint":null,"model":"qwen-plus","id":"chatcmpl-4bbf022b-e68c-9848-8328-dc401165051d"}
```

代码实现

在SSE的实现上，如果在Spring 中有多种方式，建议大家用最后一种，Flux的模式，因为他比较简单。

SseEmitter

在java中，我们可以借助SseEmitter实现流式输出，SseEmitter是Spring 提供的类，用于实现服务器推送的流式输出。

- 通过 `SseEmitter.send()` 方法发送每个事件。
- 如果一切顺利，通过 `emitter.complete()` 通知客户端输出完成。
- 如果发生异常，可以通过 `emitter.completeWithError()` 将错误通知客户端。

```text

@RestController
@RequestMapping("/stream/output")
public class SseEmitterController {
    @GetMapping("/sse/emitter")
    public SseEmitter sse() {
        SseEmitter emitter = new SseEmitter(60_000L); // 设置超时时间

        Executors.newSingleThreadExecutor().submit(() -> {
            try {
                for (int i = 0; i < 10; i++) {
                    emitter.send("Message " + i);
                    Thread.sleep(1000);
                }
                emitter.complete();
            } catch (Exception ex) {
                emitter.completeWithError(ex);
            }
        });

        return emitter;
    }
}
```

ResponseEntity + StreamingResponseBody

StreamingResponseBody 是一个函数式接口，其内部通过 OutputStream 将数据逐步写入响应流，用它可以实现非阻塞的异步流式传输。

Spring 在处理该返回值时会延迟执行该函数，直到响应提交前才调用 writeTo(OutputStream) 方法。

每次写入后调用 flush() 强制刷新缓冲区，使客户端能实时接收内容。

```text
@GetMapping("/sse/streaming")
public ResponseEntity<StreamingResponseBody> chat() {
    StreamingResponseBody body = outputStream -> {
        for (int i = 0; i < 10; i++) {
            String data = "data chunk " + i + "\n";
            outputStream.write(data.getBytes(StandardCharsets.UTF_8));
            outputStream.flush();
            try {
                Thread.sleep(500); // 模拟延迟
            } catch (InterruptedException e) {
                throw new RuntimeException(e);
            }
        }
    };

    return ResponseEntity.ok()
            .header(HttpHeaders.CONTENT_TYPE, MediaType.TEXT_EVENT_STREAM_VALUE)
            .body(body);
}
```

Flux + WebFlux

Spring WebFlux 是一种响应式web框架，使用 WebClient 和 Netty 等非阻塞 IO 技术进行高效数据传输，支持非阻塞I/O。

```text
@GetMapping(value = "/sse/flux")
public Flux<String> fluxStream() {
    return Flux.interval(Duration.ofSeconds(1))
            .map(seq -> "Stream element - " + seq);
}
```

需要增加依赖：

```
<dependency>
     <groupId>org.springframework.boot</groupId>
     <artifactId>spring-boot-starter-webflux</artifactId>
</dependency>
```

推荐大家都用这种，从代码量也能看出来，它比较简单的。后面要讲的Spring AI中，Flux用的也比较多。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69664a3951b1440001162ffb
