---
title: "✅解决MinerU解析无法获取图片的问题"
---

# ✅解决MinerU解析无法获取图片的问题

前面我们介绍了，可以通过mineru的fast api，将一个pdf转成markdown。但是这个方案有个问题，那就是会丢失其中的图片内容，只会返回一个markdown，但是其中的图片都没有返回。

想要返回图片，直接用fast api的话可以这么做：

以压缩包形式获取结果：

```
curl -X POST http://xx.xxx.xx.xx:8000/file_parse \
  -H "Accept: application/json" \
  -F "files=@/Users/hollis/Downloads/Java八股文介绍.pdf" \
  -F "backend=pipeline" \
  -F "response_format_zip=true" \
  -F "return_images=true" \
  -o result.zip
```

关键参数`response_format_zip=true` 、`return_images=true`

这样就能得到一个压缩包，解压后内容如下，即一个md文件，和一个包含了图片的文件夹。

![image.png](assets/0d23757b425e.png)

代码实现

那么，在java代码中，怎么实现呢？

```text

    /**
     * 调用文件解析接口，获取 ZIP 格式响应
     * 使用 Apache HttpClient 5，支持流式下载大文件
     *
     * @param fileName   文件名
     * @param fileStream 文件输入流
     * @return ZIP 文件字节数组
     */
    private byte[] parsePdfToZip(String fileName, InputStream fileStream) {
        String url = fileParseApiUrl + "/file_parse";

        // 配置请求超时
        RequestConfig requestConfig = RequestConfig.custom().setConnectionRequestTimeout(Timeout.ofMilliseconds(connectTimeout)).setResponseTimeout(Timeout.ofMilliseconds(responseTimeout)).build();

        try (CloseableHttpClient httpClient = HttpClients.custom().setDefaultRequestConfig(requestConfig).build()) {

            HttpPost httpPost = new HttpPost(url);
            httpPost.setHeader("Accept", "application/json");

            // 构建 multipart 请求体，启用 ZIP 格式和返回图片
            HttpEntity multipartEntity = MultipartEntityBuilder.create()
                    .addBinaryBody("files", fileStream, org.apache.hc.core5.http.ContentType.APPLICATION_OCTET_STREAM, fileName)
                    .addTextBody("backend", "pipeline").addTextBody("response_format_zip", "true")
                    .addTextBody("return_images", "true").addTextBody("return_model_output", "false")
                    .addTextBody("return_middle_json", "false").build();


            httpPost.setEntity(multipartEntity);

            log.info("开始调用文件解析接口（ZIP 模式）: {}", url);

            try (CloseableHttpResponse response = httpClient.execute(httpPost)) {
                int statusCode = response.getCode();
                log.info("文件解析接口响应状态码: {}", statusCode);

                HttpEntity responseEntity = response.getEntity();
                if (statusCode == 200 && responseEntity != null) {
                    // 读取响应体为字节数组（ZIP 文件）
                    byte[] zipBytes = EntityUtils.toByteArray(responseEntity);
                    log.info("文件解析接口调用成功，ZIP 文件大小: {} bytes", zipBytes.length);
                    return zipBytes;
                } else {
                    String responseBody = responseEntity != null ? EntityUtils.toString(responseEntity, "UTF-8") : "";
                    log.error("文件解析接口调用失败，状态码: {}, 响应: {}", statusCode, responseBody);
                    throw new RuntimeException("文件解析接口调用失败: HTTP " + statusCode + ", " + responseBody);
                }
            }

        } catch (Exception e) {
            log.error("调用文件解析接口异常", e);
            throw new RuntimeException("调用文件解析接口失败: " + e.getMessage(), e);
        } finally {
            closeQuietly(fileStream);
        }
    }
```

通过指定参数来获取zip压缩文件：

```text
// 构建 multipart 请求体，启用 ZIP 格式和返回图片
            HttpEntity multipartEntity = MultipartEntityBuilder.create()
                    .addBinaryBody("files", fileStream, org.apache.hc.core5.http.ContentType.APPLICATION_OCTET_STREAM, fileName)
                    .addTextBody("backend", "pipeline").addTextBody("response_format_zip", "true")
                    .addTextBody("return_images", "true").addTextBody("return_model_output", "false")
                    .addTextBody("return_middle_json", "false").build();
```

并且，从响应体中把内容读取成byte[]

```text
byte[] zipBytes = EntityUtils.toByteArray(responseEntity);
```

接着，就能拿到一个zip的压缩包了，这个压缩包有两种用法，

![image.png](assets/a88996ef4e5d.png)

用法1：直接把zip上传到minion上，后面用的时候再处理。

用法2：把zip下载下来，解压缩，然后把pdf、图片分别上传到minio上。

两种实现都写了，但是建议大家用第二种，原因如下：

1、这个环节的文档处理之后，就要针对文档分段了，如果分段的时候再下载zip，解压操作，不太合适，这个动作按照职责来说，放到这个文档处理阶段更合适。

2、压缩包中的图片，后面我们还是要用的，比如如果用户问问题的额时候，我们是可以把图片返回给用户查看的。所以图片后面还是需要再上传的，那么如果这里直接上传压缩包，图片后期再传一次，就要保存两份了，浪费资源。

3、除了解压，图片上传以外，我们还是要针对markdown中的图片做一些图书处理的。比如转换后的markdown中的图片用的是相对地址，我们需要把图片替换为上传后的网络地址，这样用户才能看得到，还有就是为了让图片可以做检索，我们还要给他生成描述信息。所以这些工作还是要做，那不如在这一起就都干了。

markdown中的图片处理

于是重点看看processDocumentToMarkdownFromZip，主流程：

```text
/**
 * 处理文档转换为 ZIP 格式
 * 1. 调用文档解析接口获取 ZIP（包含 Markdown 和图片）
 * 2. 保存 ZIP 到本地磁盘
 * 3. 解压 ZIP 文件
 * 4. 上传解压后的 md 和图片到 MinIO
 * 5. 替换 md 中的图片地址为 MinIO 地址
 * 6. 调用 LLM 生成图片描述并更新 md
 * 7. 保存 md 的 MinIO 地址到 convertedUrl
 * 8. 异步清理本地临时文件
 *
 * @param document 文档对象
 */
```

其中关键的关于图片处理的流程是：

```text
 /**
     * 处理 Markdown 中的图片标签：替换地址并生成图片描述
     * 匹配格式: `[图片: xxx.png]` 或 `[图片: alt]`
     */
    private String processMarkdownImages(String mdContent, java.util.Map<String, String> imageUrlMap) {
        // 匹配图片标签的正则表达式: `[图片: alt]`
        Pattern pattern = Pattern.compile("!\\[(.*?)\\]\\(([^)]+)\\)");
        Matcher matcher = pattern.matcher(mdContent);

        StringBuffer result = new StringBuffer();
        while (matcher.find()) {
            String altText = matcher.group(1);
            String imagePath = matcher.group(2);

            // 提取图片文件名
            String imageName = Paths.get(imagePath).getFileName().toString();

            // 获取 MinIO 上的图片 URL
            String minioUrl = imageUrlMap.get(imageName);
            if (minioUrl == null) {
                // 如果找不到对应的 MinIO URL，保持原样
                log.warn("未找到图片 {} 对应的 MinIO URL", imageName);
                matcher.appendReplacement(result, Matcher.quoteReplacement(matcher.group(0)));
                continue;
            }

            // 生成图片描述（mock 实现）
            String imageDescription = generateImageDescription(minioUrl);

            // 构建新的图片标签: `[图片: 描述]`
            String newImageTag = "`[图片: " + imageDescription + "]`";
            matcher.appendReplacement(result, Matcher.quoteReplacement(newImageTag));

            log.info("图片标签已处理: {} -> {}", imagePath, minioUrl);
        }
        matcher.appendTail(result);

        return result.toString();
    }
```

干两件事：

1、把``[图片: images/xxx.jpg]`` 替换成``[图片: http:xxx.xx.xx/xxx.jpg]``

2、把``[图片: http:xxx.xx.xx/xxx.jpg]``替换成``[图片: 图片描述]``

其中的图片描述生成逻辑：

```text

/**
 * 生成图片描述
 * 需要注意的是，如果你用的是外部的模型，这个url需要是公网可以访问的url。否则模型需要能和MinIO进行内网通信。
 */
public String generateImageDescription(String imageUrl) {
    OpenAiChatModel chatModel = OpenAiChatModel.builder()
            .apiKey(chatModelApiKey)
            .baseUrl(chatModelBaseUrl)
            .modelName("qwen3-vl-plus")
            .temperature(0.7)
            .logResponses(true)
            .logRequests(true)
            .build();

    UserMessage userMessage = UserMessage.from(new TextContent("请描述这张图片的内容，包括场景、对象、布局、颜色、文字信息，直接输出纯文本描述，不要多余说明。"), new ImageContent(imageUrl));
    return chatModel.chat(userMessage).aiMessage().text();
}
```

用到了一个单独的qwen3-vl-plus模型，因为它能理解图片。并且在usermessage中传入一个ImageContent，还是比较简单的。

ImageContent除了支持上通过url构造，还支持通过base64、Image对象等方式。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69c7872274e40300015b786d
