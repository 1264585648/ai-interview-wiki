---
title: "✅Spring AI 和 LangChain4J中文档处理功能对比"
---

# ✅Spring AI 和 LangChain4J中文档处理功能对比

前面两个章节我们介绍过了Spring AI和LangChain4J中的RAG中文档分段的相关支持，我们把他们放一起做个简单的对比：

| **对比项** | **Spring AI（+Alibaba）** | **LangChain4J** |
| --- | --- | --- |
| **文档读取（读取到内存中）** | 本地文件格式（Office 文档、PDF 、*mardown*、JSON等）<br>云存储服务（腾讯云 COS、阿里云 OSS 等）<br>数据库（MySQL、MongoDB、SQLite、Elasticsearch 等）<br>在线平台（GitHub、GitLab、语雀、Notion、Bilibili、YouTube 等）<br>其他数据源（邮件、归档文件等） | Amazon S3、Azure Blob、Google Cloude Storage、本地文件格式、Github、Selenium、COS、URL等。 |
| **文档解析（转成Document对象）** | 文档格式（PDF、Markdown、YAML、HTML 等）<br>办公文档（通过 Tika 支持多种 Office 格式）<br>多模态内容（图像 OCR、语音转文字）<br>特殊格式（BibTeX、PDF 表格等）<br>批量处理（目录解析） | TextDocumentParser<br>ApacheTikaDocumentParser<br>ApachePoiDocumentParser<br>ApachePdfBoxDocumentParser<br>MarkdownDocumentParser<br>YamlDocumentParser |
| **文本分段** | TokenTextSplitter（按照固定长度分段）<br>SentenceSplitter（按照语义分段）<br>RecursiveCharacterTextSplitter（递归分段） | DocumentByParagraphSplitter（按段落分割）<br>DocumentByLineSplitter（按行分割）<br>DocumentBySentenceSplitter（按句子语义分割）<br>DocumentByWordSplitter（按单词分割）<br>DocumentByCharacterSplitter（按字符分割）<br>DocumentByRegexSplitter（按正则分割）<br>DocumentSplitters.recursive（递归分割） |
| **文档清洗** |  | HtmlToTextDocumentTransformer（将HTML内容转成纯文本） |
| **元数据加工** | ContentFormatTransformer（元数据统一转换）<br>KeywordMetadataEnricher（关键词提取保存为元数据）<br>SummaryMetadataEnricher（摘要提取保存为元数据） |  |

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6999b30aa7c8ff00015bff7d
