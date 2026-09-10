---
title: "✅为什么不用Java解析PDF文档"
---

# ✅为什么不用Java解析PDF文档

一般的知识库内容，通常由word、markdown、pdf以及在线文档这几种形式。其中比较难处理的就是pdf。

我们可以先试一下，用spring ai和langchain4j的话，处理一下pdf，看看什么效果。

先准备一份图文并茂的PDF:

[r7-product-manual-20250123.pdf](https://tcs-devops.aliyuncs.com/storage/133s9231f026e4de78bb4ece70da53f169dd?Signature=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJBcHBJRCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9hcHBJZCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9vcmdhbml6YXRpb25JZCI6IiIsImV4cCI6MTc4OTYwNjMzNSwiaWF0IjoxNzg5MDAxNTM1LCJyZXNvdXJjZSI6Ii9zdG9yYWdlLzEzM3M5MjMxZjAyNmU0ZGU3OGJiNGVjZTcwZGE1M2YxNjlkZCJ9.5qzQITm5gmdmf9Z2EnM327KrH0LBc2EbOU2eMYpb--M&download=r7-product-manual-20250123.pdf)

（以上文档在[01-✅项目中用到的文件.md](01-✅项目中用到的文件.md) 中已提供）

Spring AI

我们之前讲RAG的时候，提到过pdf的处理，可以用PagePdfDocumentReader、ParagraphPdfDocumentReader，我们为此还封装了一个PdfReaderStrategy。

但是他解析PDF效果真的好吗？

我们前面准备了一份PDF，简单预览下：

![image.png](assets/d682890c8374.png)

![image.png](assets/7cb3833655ef.png)

是这种文字呈现左右结构，带图片带表格的。我们写一个单测，用这个PdfReaderStrategy解析一下看看效果：

```text
package cn.hollis.llm.mentor.rag.reader;


import org.junit.jupiter.api.Test;
import org.springframework.ai.document.Document;

import java.io.File;
import java.io.IOException;
import java.util.List;

public class MarkdownReaderStrategyTest {

    @Test
    public void read() {
        PdfReaderStrategy pdfReaderStrategy = new PdfReaderStrategy();
        try {
            List<Document> documents = pdfReaderStrategy.read(new File("/Users/hollis/Desktop/r7-product-manual-20250123.pdf"));
            for (Document document : documents) {
                System.out.println(document.getText());
                System.out.println("===============");
            }
        } catch (IOException e) {

        }
    }
}
```

运行一下，就是以下这种效果。

![image.png](assets/1830fbfc9549.png)

主要问题：

1、格式乱，左右结构并没有区分出来。

2、有大量的空白字符。

3、图片没有解析出来，甚至没有保留。

4、表格没有解析出来，甚至没有保留。

当然，大家应该还记得，我们前面为了特意处理这种PDF的文件，给大家定义过一个PdfMultimodalProcessor，他能帮我们处理带图片的PDF，也可以写个单测运行下看看效果：

（注意，先把里面的processImage方法注释掉，跳过图片处理）

![image.png](assets/55e9facec0ff.png)

```text
@Test
public void load() throws IOException {
    PdfMultimodalProcessor pdfMultimodalProcessor = new PdfMultimodalProcessor();

    try {
        System.out.println(pdfMultimodalProcessor.processPdf(new File("/Users/hollis/Desktop/r7-product-manual-20250123.pdf")));
    } catch (Exception e) {
        throw new RuntimeException(e);
    }
}
```

得到运行结果：

![image.png](assets/8f186255558d.png)

图片可以处理了，但是他也有些缺点：

1、需要自己写代码，实现功能。

2、解析出来的文字中也有很多空格。

3、解析出来的文档结构也不正确。

4、表格无法处理。

LangChain4J

那我们试试langchain4j。他支持下面几种文档处理器，我们使用pdfbox的试一下。

![image.png](assets/fe538bc83227.png)

增加依赖：

```text

<dependency>
    <groupId>dev.langchain4j</groupId>
    <artifactId>langchain4j-document-parser-apache-pdfbox</artifactId>
    <version>1.8.0-beta15</version>
</dependency>
```

单测：

```text
import dev.langchain4j.data.document.Document;
import dev.langchain4j.data.document.DocumentParser;
import dev.langchain4j.data.document.parser.apache.pdfbox.ApachePdfBoxDocumentParser;
import org.junit.Test;

import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;

public class ApachePdfBoxDocumentParserTest {

    @Test
    public void test_parse_pdf_file() {
        try (InputStream inputStream = new FileInputStream("/Users/hollis/Desktop/r7-product-manual-20250123.pdf")) {
            DocumentParser parser = new ApachePdfBoxDocumentParser();
            Document document = parser.parse(inputStream);

            System.out.println(document.text());

        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

}
```

运行结果如下：

![image.png](assets/19bb0a0fc6e3.png)

和Spring AI差不多，文档的结构读取的是正确的了，该有的问题还是有。

也就是说，用JAVA中的工具，解析出来的文档都存在各种问题，而且除了这些问题外，还有些情况也无法处理，比如如果PDF是个扫描件怎么办？PDF中有表格怎么办？PDF中如果存在LaTex公式怎么办，都无能为力了。

所以，我们需要换一种能一次性解决搜游问题的方案。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69be4d8174e403000152308c
