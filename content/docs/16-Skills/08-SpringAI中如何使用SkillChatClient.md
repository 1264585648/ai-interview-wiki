---
title: "✅SpringAI中如何使用Skill？（ChatClient）"
---

# ✅SpringAI中如何使用Skill？（ChatClient）

前面我们基于Agent继承了Skill，这一期讲讲直接用ChatClient如何集成。

1、增加依赖，增加skill、修改Skill.md、简历上传到minio、发起请求、输出结果等步骤和上一节课程一样，不重复了。

开发LLM相关代码

```text
package cn.hollis.llm.HelloLlm.agent.react.controller;

import cn.hollis.llm.HelloLlm.agent.react.tools.FileReaderTool;
import com.alibaba.cloud.ai.graph.RunnableConfig;
import com.alibaba.cloud.ai.graph.agent.ReactAgent;
import com.alibaba.cloud.ai.graph.agent.hook.shelltool.ShellToolAgentHook;
import com.alibaba.cloud.ai.graph.agent.hook.skills.SkillsAgentHook;
import com.alibaba.cloud.ai.graph.agent.tools.ShellTool2;
import com.alibaba.cloud.ai.graph.checkpoint.savers.MemorySaver;
import com.alibaba.cloud.ai.graph.exception.GraphRunnerException;
import com.alibaba.cloud.ai.graph.skills.registry.SkillRegistry;
import com.alibaba.cloud.ai.graph.skills.registry.classpath.ClasspathSkillRegistry;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.support.ToolCallbacks;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/skill")
public class SkillController {

    @Autowired
    private ChatModel dashScopeChatModel;

    @PostConstruct
    public void init() {

       /*
          1. 创建 ClasspathSkillRegistry，从 classpath:skills/ 下加载 Skill
         */
        SkillRegistry skillRegistry = ClasspathSkillRegistry.builder()
                .classpathPath("skills")
                .build();

        /*
          2. 创建 read_skill 工具的 ToolCallback
             这是 LLM 在推理时主动调用的工具，用于按需读取某个 Skill 的完整 SKILL.md 内容
         */
        ToolCallback readSkillToolCallback = ReadSkillTool.createReadSkillToolCallback(skillRegistry, null);

        /*
          3. 创建文件读取工具的 ToolCallback
         */
        ToolCallback[] fileReaderToolCallback = ToolCallbacks.from(FileReaderTool.class);

        /*
          4. 创建 SpringAiSkillAdvisor，把 SkillRegistry 注入进去
             Advisor 会在每次对话的 before() 阶段将 Skill 列表追加到 System Prompt
         */
        SpringAiSkillAdvisor skillAdvisor = SpringAiSkillAdvisor.builder()
                .skillRegistry(skillRegistry)
                .build();
        
        /*
          5. 创建 ChatClient，并注入 SkillAdvisor 和 read_skill 工具
         */
        this.chatClient = ChatClient.builder(chatModel)
                .defaultAdvisors(skillAdvisor)
                .defaultToolCallbacks(readSkillToolCallback, fileReaderToolCallback[0])
                .build();

    }


    @RequestMapping("/resumeCheck")
    public String resumeCheck(String message) throws GraphRunnerException {
        return chatClient.prompt()
                .user(message)
                .call()
                .content();
    }
}
```

我们一共给这个ChatClient提供了一个Advisor和一个Tool。

SpringAiSkillAdvisor，把 SkillRegistry 注入进去，这个Advisor 会在每次对话的 before() 阶段将 Skill 列表追加到 System Prompt。

ReadSkillTool，read_skill 工具，这是 LLM 在推理时主动调用的工具，用于按需读取某个 Skill 的完整 SKILL.md 内容。

工具定义

接着，我们需要提供工具，提供一个可以读取文件的工具，包括PDF、MD的读取：

```text
package cn.hollis.llm.mentor.agent.tools;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.poi.hssf.usermodel.HSSFWorkbook;
import org.apache.poi.hwpf.HWPFDocument;
import org.apache.poi.hwpf.extractor.WordExtractor;
import org.apache.poi.sl.usermodel.TextShape;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xslf.usermodel.XMLSlideShow;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.apache.poi.xwpf.usermodel.XWPFParagraph;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;

import org.springframework.core.io.ClassPathResource;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/**
 * 通用文件读取工具，供 ReactAgent 调用。
 * 支持格式：PDF、Word（docx/doc）、Excel（xlsx/xls）、PowerPoint（pptx）、
 * 纯文本（txt/md/csv/log/xml/json/yaml/yml/properties）
 */
public class FileReaderTool {

    private static final Logger log = LoggerFactory.getLogger(FileReaderTool.class);

    /**
     * 单次返回文本的最大字符数，防止超出上下文窗口
     */
    private static final int MAX_CHARS = 8000;

    @Tool(description = """
            读取文件并返回其文本内容。支持从绝对路径、classpath 或网络地址读取。
            支持格式：
              - PDF (.pdf)
              - Word (.docx / .doc)
              - Excel (.xlsx / .xls)  —— 返回所有 Sheet 的表格文本
              - PowerPoint (.pptx)    —— 返回所有幻灯片的文字
              - 纯文本 (.txt / .md / .csv / .log / .xml / .json / .yaml / .yml / .properties)
            参数 path 可以是：
              - 文件的绝对路径，如：/Users/hollis/data/sample.txt
              - classpath 路径，以 classpath: 开头，如：classpath:templates/sample.txt
              - 网络地址，以 http:// 或 https:// 开头，如：http://localhost:9001/api/v1/download-shared-object/xxx
            对于 PDF 文件，可选参数 startPage / endPage 指定读取页码范围（从 1 开始）；其他格式忽略此参数。
            若文本过长会自动截断并在末尾注明剩余字符数。
            """)
    public String read_file(
            @ToolParam(description = "文件路径，可以是绝对路径、classpath: 开头或 http(s):// 开头的 URL，如 /Users/hollis/data/sample.txt、classpath:templates/sample.txt 或 http://example.com/file.pdf") String path,
            @ToolParam(required = false, description = "【仅 PDF 有效】起始页码（从 1 开始，默认第 1 页）") Integer startPage,
            @ToolParam(required = false, description = "【仅 PDF 有效】结束页码（含，默认最后一页）") Integer endPage) {

        log.info("Starting execution of tool: read_file, path: {}, startPage: {}, endPage: {}", path, startPage, endPage);
        if (path == null || path.isBlank()) {
            return "Error: path 不能为空";
        }

        // 判断路径类型
        if (path.startsWith("classpath:")) {
            String resourcePath = path.substring("classpath:".length());
            return readFromClasspath(resourcePath, startPage, endPage);
        } else if (path.startsWith("http://") || path.startsWith("https://")) {
            return readFromUrl(path, startPage, endPage);
        } else {
            return readFromFilesystem(path, startPage, endPage);
        }
    }

    private String readFromClasspath(String resourcePath, Integer startPage, Integer endPage) {
        ClassPathResource resource = new ClassPathResource(resourcePath);
        if (!resource.exists()) {
            return "Error: classpath 资源不存在 -> " + resourcePath;
        }

        String ext = getExtension(resourcePath).toLowerCase();

        try (InputStream is = resource.getInputStream()) {
            return switch (ext) {
                case "pdf" -> readPdfFromStream(is, startPage, endPage);
                case "docx" -> readDocxFromStream(is);
                case "doc" -> readDocFromStream(is);
                case "xlsx" -> readExcelFromStream(is, false);
                case "xls" -> readExcelFromStream(is, true);
                case "pptx" -> readPptxFromStream(is);
                default -> readTextFromStream(is, ext);
            };
        } catch (Exception e) {
            log.error("读取 classpath 文件失败: {}", resourcePath, e);
            return "Error: 读取 classpath 文件失败 -> " + e.getMessage();
        }
    }

    private String readFromFilesystem(String filePath, Integer startPage, Integer endPage) {
        File file = new File(filePath);
        if (!file.exists()) {
            return "Error: 文件不存在 -> " + filePath;
        }
        if (!file.canRead()) {
            return "Error: 文件无读取权限 -> " + filePath;
        }

        String ext = getExtension(file.getName()).toLowerCase();

        try {
            return switch (ext) {
                case "pdf" -> readPdf(file, startPage, endPage);
                case "docx" -> readDocx(file);
                case "doc" -> readDoc(file);
                case "xlsx" -> readExcel(file, false);
                case "xls" -> readExcel(file, true);
                case "pptx" -> readPptx(file);
                default -> readText(file);
            };
        } catch (Exception e) {
            log.error("读取文件失败: {}", filePath, e);
            return "Error: 读取文件失败 -> " + e.getMessage();
        }
    }

    private String readFromUrl(String urlString, Integer startPage, Integer endPage) {
        try {
            URL url = URI.create(urlString).toURL();
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(30000); // 30秒连接超时
            connection.setReadTimeout(60000);    // 60秒读取超时
            connection.setInstanceFollowRedirects(true);

            int responseCode = connection.getResponseCode();
            if (responseCode != HttpURLConnection.HTTP_OK) {
                return "Error: HTTP 请求失败，状态码 -> " + responseCode;
            }

            // 尝试从 Content-Disposition 头获取文件名
            String contentDisposition = connection.getHeaderField("Content-Disposition");
            String filename = null;
            if (contentDisposition != null && contentDisposition.contains("filename=")) {
                filename = contentDisposition.replaceAll(".*filename=\"([^\"]+)\".*", "$1");
            }

            // 如果无法从头获取，从 URL 路径获取
            if (filename == null || filename.isBlank()) {
                String path = url.getPath();
                int lastSlash = path.lastIndexOf('/');
                filename = (lastSlash >= 0 && lastSlash < path.length() - 1) ? path.substring(lastSlash + 1) : "download";
            }

            String ext = getExtension(filename).toLowerCase();

            try (InputStream is = connection.getInputStream()) {
                return switch (ext) {
                    case "pdf" -> readPdfFromStream(is, startPage, endPage);
                    case "docx" -> readDocxFromStream(is);
                    case "doc" -> readDocFromStream(is);
                    case "xlsx" -> readExcelFromStream(is, false);
                    case "xls" -> readExcelFromStream(is, true);
                    case "pptx" -> readPptxFromStream(is);
                    default -> readTextFromStream(is, ext);
                };
            }
        } catch (Exception e) {
            log.error("从网络地址读取文件失败: {}", urlString, e);
            return "Error: 从网络地址读取文件失败 -> " + e.getMessage();
        }
    }

    // -------------------------------------------------------------------------
    // PDF
    // -------------------------------------------------------------------------
    private String readPdf(File file, Integer startPage, Integer endPage) throws IOException {
        try (PDDocument doc = Loader.loadPDF(file)) {
            return readPdfDocument(doc, startPage, endPage);
        }
    }

    private String readPdfFromStream(InputStream is, Integer startPage, Integer endPage) throws IOException {
        try (PDDocument doc = Loader.loadPDF(is.readAllBytes())) {
            return readPdfDocument(doc, startPage, endPage);
        }
    }

    private String readPdfDocument(PDDocument doc, Integer startPage, Integer endPage) throws IOException {
        int total = doc.getNumberOfPages();
        int from = (startPage != null && startPage >= 1) ? startPage : 1;
        int to = (endPage != null && endPage >= 1) ? Math.min(endPage, total) : total;

        if (from > total) {
            return String.format("Error: startPage(%d) 超过文件总页数(%d)", from, total);
        }

        PDFTextStripper stripper = new PDFTextStripper();
        stripper.setStartPage(from);
        stripper.setEndPage(to);
        stripper.setSortByPosition(true);

        String text = stripper.getText(doc);
        String header = String.format("[PDF  共 %d 页，本次读取第 %d-%d 页]\n\n", total, from, to);
        return header + truncate(text);
    }

    // -------------------------------------------------------------------------
    // Word docx
    // -------------------------------------------------------------------------
    private String readDocx(File file) throws IOException {
        try (XWPFDocument doc = new XWPFDocument(new FileInputStream(file))) {
            return readDocxDocument(doc);
        }
    }

    private String readDocxFromStream(InputStream is) throws IOException {
        try (XWPFDocument doc = new XWPFDocument(is)) {
            return readDocxDocument(doc);
        }
    }

    private String readDocxDocument(XWPFDocument doc) {
        StringBuilder sb = new StringBuilder();
        for (XWPFParagraph para : doc.getParagraphs()) {
            String text = para.getText();
            if (text != null && !text.isBlank()) {
                sb.append(text).append("\n");
            }
        }
        return "[Word (.docx)]\n\n" + truncate(sb.toString());
    }

    // -------------------------------------------------------------------------
    // Word doc (旧格式)
    // -------------------------------------------------------------------------
    private String readDoc(File file) throws IOException {
        try (HWPFDocument doc = new HWPFDocument(new FileInputStream(file));
             WordExtractor extractor = new WordExtractor(doc)) {
            return readDocExtractor(extractor);
        }
    }

    private String readDocFromStream(InputStream is) throws IOException {
        try (HWPFDocument doc = new HWPFDocument(is);
             WordExtractor extractor = new WordExtractor(doc)) {
            return readDocExtractor(extractor);
        }
    }

    private String readDocExtractor(WordExtractor extractor) {
        String text = String.join("\n", extractor.getParagraphText());
        return "[Word (.doc)]\n\n" + truncate(text);
    }

    // -------------------------------------------------------------------------
    // Excel xlsx / xls
    // -------------------------------------------------------------------------
    private String readExcel(File file, boolean isOld) throws IOException {
        try (InputStream is = new FileInputStream(file);
             Workbook wb = isOld ? new HSSFWorkbook(is) : new XSSFWorkbook(is)) {
            return readExcelWorkbook(wb, isOld);
        }
    }

    private String readExcelFromStream(InputStream is, boolean isOld) throws IOException {
        try (Workbook wb = isOld ? new HSSFWorkbook(is) : new XSSFWorkbook(is)) {
            return readExcelWorkbook(wb, isOld);
        }
    }

    private String readExcelWorkbook(Workbook wb, boolean isOld) {
        StringBuilder sb = new StringBuilder();
        DataFormatter formatter = new DataFormatter();

        for (int si = 0; si < wb.getNumberOfSheets(); si++) {
            Sheet sheet = wb.getSheetAt(si);
            sb.append("=== Sheet: ").append(sheet.getSheetName()).append(" ===\n");
            for (Row row : sheet) {
                StringBuilder rowSb = new StringBuilder();
                for (Cell cell : row) {
                    if (rowSb.length() > 0) rowSb.append("\t");
                    rowSb.append(formatter.formatCellValue(cell));
                }
                String rowStr = rowSb.toString().trim();
                if (!rowStr.isEmpty()) {
                    sb.append(rowStr).append("\n");
                }
            }
            sb.append("\n");
        }
        String ext = isOld ? ".xls" : ".xlsx";
        return "[Excel (" + ext + ") 共 " + wb.getNumberOfSheets() + " 个 Sheet]\n\n" + truncate(sb.toString());
    }

    // -------------------------------------------------------------------------
    // PowerPoint pptx
    // -------------------------------------------------------------------------
    private String readPptx(File file) throws IOException {
        try (XMLSlideShow ppt = new XMLSlideShow(new FileInputStream(file))) {
            return readPptxShow(ppt);
        }
    }

    private String readPptxFromStream(InputStream is) throws IOException {
        try (XMLSlideShow ppt = new XMLSlideShow(is)) {
            return readPptxShow(ppt);
        }
    }

    private String readPptxShow(XMLSlideShow ppt) {
        StringBuilder sb = new StringBuilder();
        int slideNum = 1;
        for (var slide : ppt.getSlides()) {
            sb.append("--- 第 ").append(slideNum++).append(" 页 ---\n");
            for (var shape : slide.getShapes()) {
                if (shape instanceof TextShape<?, ?> ts) {
                    String text = ts.getText();
                    if (text != null && !text.isBlank()) {
                        sb.append(text).append("\n");
                    }
                }
            }
            sb.append("\n");
        }
        return "[PowerPoint (.pptx) 共 " + ppt.getSlides().size() + " 页]\n\n" + truncate(sb.toString());
    }

    // -------------------------------------------------------------------------
    // 纯文本（txt/md/csv/log/xml/json/yaml/yml/properties 等）
    // -------------------------------------------------------------------------
    private String readText(File file) throws IOException {
        String content = Files.readString(file.toPath(), StandardCharsets.UTF_8);
        String ext = getExtension(file.getName()).toUpperCase();
        return "[文本文件 (." + ext.toLowerCase() + ")]\n\n" + truncate(content);
    }

    private String readTextFromStream(InputStream is, String ext) throws IOException {
        String content = new String(is.readAllBytes(), StandardCharsets.UTF_8);
        return "[文本文件 (." + ext.toLowerCase() + ")]\n\n" + truncate(content);
    }

    // -------------------------------------------------------------------------
    // 工具方法
    // -------------------------------------------------------------------------
    private String truncate(String text) {
        if (text == null) return "";
        if (text.length() <= MAX_CHARS) return text;
        int remaining = text.length() - MAX_CHARS;
        return text.substring(0, MAX_CHARS)
                + String.format("\n\n...[内容过长，已截断，剩余约 %d 字符未显示，请指定更小的范围继续读取]", remaining);
    }

    private String getExtension(String filename) {
        int dot = filename.lastIndexOf('.');
        return (dot >= 0 && dot < filename.length() - 1) ? filename.substring(dot + 1) : "";
    }
}
```

以上是一个新的文件读取工具，我们在之前的工具的基础上，让他同时能够读取classpath下的文件和网络文件，这样能解决他无法直接读取classpath下的jd.md和我们上传后的简历Pdf的问题，因为之前这个工具只能从绝对路径读取文件。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69aeab3451b14400014aa228
