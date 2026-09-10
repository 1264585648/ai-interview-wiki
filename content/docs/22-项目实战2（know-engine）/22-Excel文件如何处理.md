---
title: "✅Excel文件如何处理？"
---

# ✅Excel文件如何处理？

一个优秀的rag系统，肯定要支持很多种类型的文件的处理，那么有一种常见的格式，即excel，我们要如何处理他呢？

我们前面介绍过pdf的处理，使用了mineru这个工具，然后市面上也有一些处理excel的方案，是这样的。会先通过`LibreOffice`将文件转成pdf的形式，再使用minerU进行表格区域识别。如rag anything（ [https://github.com/HKUDS/RAG-Anything](https://github.com/HKUDS/RAG-Anything) ）这个项目就是这么干的。

但是，这么做属实有点**脱库子放屁**了。

excel其实是一种标准的表结构，大体上分为两种处理方案，一种是把他直接存储到关系型数据库中，一种是把他保存在向量数据库中。

如果是关系型数据库，那么就通过SQL语句进行查询。如果是向量数据库，就使用语义相似度查询。

我们先看看如果是使用向量数据库的话，具体如何处理和分段的呢？我们可以参考著名的开源项目ragflow（[https://github.com/infiniflow/ragflow](https://github.com/infiniflow/ragflow) ），看看他是怎么做的。

ragflow中的实现

核心代码在 [https://github.com/infiniflow/ragflow/blob/main/deepdoc/parser/excel_parser.py](https://github.com/infiniflow/ragflow/blob/main/deepdoc/parser/excel_parser.py)中，核心类为 **RAGFlowExcelParser**。

RAGFlowExcelParser 提供两种输出模式：

**模式一：键值对文本输出（默认）**

将每行数据转换为语义化的键值对文本：

```text
def __call__(self, file_like_object):
    # 默认模式：键值对文本输出
    wb = RAGFlowExcelParser._load_excel_to_workbook(file_like_object)
    res = []
    for sheetname in wb.sheetnames:
        ws = wb[sheetname]
        rows = list(ws.rows)
        if not rows:
            continue
        ti = list(rows[0])  # 表头行
        for r in list(rows[1:]):  # 数据行
            fields = []
            for i, c in enumerate(r):
                if not c.value:
                    continue
                t = str(ti[i].value) if i < len(ti) else ""
                t += ("：" if t else "") + str(c.value)
                fields.append(t)
            line = "; ".join(fields)
            # 如果工作表名称不是默认的"Sheet"，则追加到行尾
            if sheetname.lower().find("sheet") < 0:
                line += " ——" + sheetname
            res.append(line)
    return res
```

假如有一个销售报表.xsl：

| 姓名 | 部门 | 销售额 |
| --- | --- | --- |
| 张三 | 销售一部 | 150万 |
| 李四 | 销售二部 | 100万 |

通过ragflow处理后，**输出示例**：

姓名：张三; 部门：销售一部; 销售额：150万 ——销售报表姓名：李四; 部门：销售二部; 销售额：100万 ——销售报表

这种模式，每行都是一个独立的语义单元，每行文本天然适合作为 RAG 的一个 chunk，检索时直接匹配整行内容即可。如上面的例子，就会拆分成两个chunk。

**模式二：HTML 表格输出**

当配置 html4excel=true 时，输出 HTML 格式的表格：

```text
def html(self, fnm, chunk_rows=256):
        from html import escape

        file_like_object = BytesIO(fnm) if not isinstance(fnm, str) else fnm
        wb = RAGFlowExcelParser._load_excel_to_workbook(file_like_object)
        tb_chunks = []

        def _fmt(v):
            if v is None:
                return ""
            return str(v).strip()

        for sheetname in wb.sheetnames:
            ws = wb[sheetname]
            try:
                rows = RAGFlowExcelParser._get_rows_limited(ws)
            except Exception as e:
                logging.warning(f"Skip sheet '{sheetname}' due to rows access error: {e}")
                continue

            if not rows:
                continue

            tb_rows_0 = "<tr>"
            for t in list(rows[0]):
                tb_rows_0 += f"<th>{escape(_fmt(t.value))}</th>"
            tb_rows_0 += "</tr>"

            for chunk_i in range((len(rows) - 1) // chunk_rows + 1):
                tb = ""
                tb += f"<table><caption>{sheetname}</caption>"
                tb += tb_rows_0
                for r in list(rows[1 + chunk_i * chunk_rows : min(1 + (chunk_i + 1) * chunk_rows, len(rows))]):
                    tb += "<tr>"
                    for i, c in enumerate(r):
                        if c.value is None:
                            tb += "<td></td>"
                        else:
                            tb += f"<td>{escape(_fmt(c.value))}</td>"
                    tb += "</tr>"
                tb += "</table>\n"
                tb_chunks.append(tb)

        return tb_chunks
```

**输出示例**：

```text
<table>
  <thead>
    <tr>
      <th>ID</th>
      <th>名称</th>
      <th>描述</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>1</td>
      <td>项目1</td>
      <td>这是第1个项目的描述</td>
    </tr>
    <tr>
      <td>2</td>
      <td>项目2</td>
      <td>这是第2个项目的描述</td>
    </tr>
</table>
```

这种模式，多了一个参数，chunk_row，表示分块的行数，为什么这种模式需要分块？

HTML 表格是一个完整的结构，如果表格有 1000 行，生成的 HTML 会非常庞大，超大 chunk 会导致超出 LLM 的上下文限制、检索时匹配精度下降（噪声太多）、存储和传输效率低，所以需要做一下拆分。

这种模式，在最终输出的过个分块中，每一个分块中都会包含表头。

参考ragflow实现Java版

```text
package cn.hollis.llm.mentor.know.engine.rag.modules.splitter;

import cn.hollis.llm.mentor.know.engine.infra.snowflake.SnowflakeIdGenerator;
import com.alibaba.excel.EasyExcel;
import com.alibaba.excel.context.AnalysisContext;
import com.alibaba.excel.read.listener.ReadListener;
import dev.langchain4j.data.document.Metadata;
import dev.langchain4j.data.segment.TextSegment;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.stream.Collectors;

import static cn.hollis.llm.mentor.know.engine.rag.constant.MetadataKeyConstant.CHUNK_ID;

/**
 * RAGFlow风格的Excel解析器 - Java实现
 * 参考: https://github.com/infiniflow/ragflow
 * <p>
 * 功能特性:
 * 1. 支持 .xlsx 和 .xls 格式
 * 2. 支持 CSV 格式
 * 3. 双模式输出: 键值对模式 / HTML表格模式
 * 4. 智能分块: 按字符数分块大表格（同一行不会被拆分到不同分块）
 * 5. 编码自动检测 (CSV)
 * <p>
 */
public class ExcelSplitter {
    /**
     * 是否使用HTML表格模式
     */
    private boolean htmlMode;

    /**
     * 默认分块字符数
     */
    public static final int DEFAULT_CHUNK_SIZE = 500;

    /**
     * 分块字符数，用于HTML表格模式
     * 表示每个分块包含的最大字符数，同一行不会被拆分到不同的分块中
     */
    private final int chunkSize;

    public ExcelSplitter() {
        this(DEFAULT_CHUNK_SIZE);
    }

    public ExcelSplitter(int chunkSize) {
        this.chunkSize = chunkSize;
        this.htmlMode = false;
    }

    public ExcelSplitter(int chunkSize, boolean htmlMode) {
        this.chunkSize = chunkSize;
        this.htmlMode = htmlMode;
    }

    // ==================== 核心解析方法 ====================

    /**
     * 双模式解析入口
     *
     * @param fileData 文件字节数据
     */
    public List<TextSegment> split(byte[] fileData) throws IOException {
        System.out.println("开始解析Excel文件...");
        FileType fileType = detectFileType(fileData);
        List<String> chunks = new ArrayList<>();
        switch (fileType) {
            case XLSX:
            case XLS:
                chunks = parseExcel(fileData);
                break;
            case CSV:
                chunks = parseCsv(fileData);
                break;
            default:
                throw new IllegalArgumentException("不支持的文件格式");
        }

        return chunks.stream().map(s -> {
            Map<String, Object> metadata = new HashMap<>();
            String parentChunkId = SnowflakeIdGenerator.getInstance().nextIdStr();
            metadata.put(CHUNK_ID, parentChunkId);
            return new TextSegment(s, Metadata.from(metadata));
        }).collect(Collectors.toCollection(ArrayList::new));
    }

    // ==================== Excel解析实现 ====================

    private List<String> parseExcel(byte[] fileData) throws IOException {
        List<List<String>> allRows = new ArrayList<>();

        try (ByteArrayInputStream bis = new ByteArrayInputStream(fileData)) {
            EasyExcel.read(bis, new ReadListener<Map<Integer, String>>() {
                @Override
                public void invoke(Map<Integer, String> data, AnalysisContext context) {
                    // 将Map转换为有序列表
                    List<String> row = new ArrayList<>();
                    int maxIndex = data.keySet().stream().max(Integer::compareTo).orElse(-1);
                    for (int i = 0; i <= maxIndex; i++) {
                        row.add(data.getOrDefault(i, ""));
                    }
                    allRows.add(row);
                }

                @Override
                public void doAfterAllAnalysed(AnalysisContext context) {
                    // 解析完成
                }
                // EasyExcel 默认将第一行视为表头，不会通过 ReadListener.invoke() 回调返回。所以 parseExcel 返回的数据实际上是从 Excel 的第二行开始的。
                // 需要设置 headRowNumber(0) 告诉 EasyExcel 从第一行就开始读取数据
            }).headRowNumber(0).sheet().doRead();
        }

        return processRows(allRows);
    }

    // ==================== CSV解析实现 ====================

    private List<String> parseCsv(byte[] fileData) throws IOException {
        // 检测编码
        Charset charset = detectCharset(fileData);

        List<List<String>> allRows = new ArrayList<>();

        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(new ByteArrayInputStream(fileData), charset))) {

            String line;
            while ((line = reader.readLine()) != null) {
                List<String> row = parseCsvLine(line);
                allRows.add(row);
            }
        }

        return processRows(allRows);
    }

    /**
     * 简单的CSV行解析（处理引号包裹的字段）
     */
    private List<String> parseCsvLine(String line) {
        List<String> fields = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        boolean inQuotes = false;

        for (char c : line.toCharArray()) {
            if (c == '"') {
                inQuotes = !inQuotes;
            } else if (c == ',' && !inQuotes) {
                fields.add(current.toString().trim());
                current = new StringBuilder();
            } else {
                current.append(c);
            }
        }
        fields.add(current.toString().trim());

        return fields;
    }

    // ==================== 数据处理核心 ====================

    private List<String> processRows(List<List<String>> allRows) {
        if (allRows.isEmpty()) {
            return Collections.emptyList();
        }

        // 清理数据：移除非法控制字符
        allRows = cleanData(allRows);

        if (htmlMode) {
            return convertToHtmlChunks(allRows);
        } else {
            return convertToKeyValuePairs(allRows);
        }
    }

    /**
     * 清理非法控制字符
     */
    private List<List<String>> cleanData(List<List<String>> rows) {
        return rows.stream()
                .map(row -> row.stream()
                        .map(this::cleanCell)
                        .collect(Collectors.toList()))
                .collect(Collectors.toList());
    }

    private String cleanCell(String cell) {
        if (cell == null) return "";
        // 移除控制字符 (0x00-0x1F)，保留换行符(0x0A)和制表符(0x09)
        return cell.replaceAll("[\\x00-\\x09\\x0B-\\x0C\\x0E-\\x1F]", "");
    }

    /**
     * 键值对模式转换
     * 格式: "表头1: 值1; 表头2: 值2; ..."
     */
    private List<String> convertToKeyValuePairs(List<List<String>> rows) {
        List<String> result = new ArrayList<>();

        if (rows.size() < 2) {
            return result; // 至少需要表头+一行数据
        }

        List<String> headers = rows.get(0);

        for (int i = 1; i < rows.size(); i++) {
            List<String> row = rows.get(i);
            StringBuilder sb = new StringBuilder();

            for (int j = 0; j < headers.size() && j < row.size(); j++) {
                String header = headers.get(j).trim();
                String value = row.get(j).trim();

                if (!header.isEmpty() || !value.isEmpty()) {
                    if (sb.length() > 0) {
                        sb.append("; ");
                    }
                    sb.append(header).append("：").append(value);
                }
            }

            if (sb.length() > 0) {
                result.add(sb.toString());
            }
        }

        return result;
    }

    /**
     * HTML表格模式转换
     * 按chunkSize字符数分块输出，同一行不会被拆分到不同的分块中
     */
    private List<String> convertToHtmlChunks(List<List<String>> rows) {
        List<String> result = new ArrayList<>();

        if (rows.isEmpty()) {
            return result;
        }

        List<String> headers = rows.get(0);
        List<List<String>> dataRows = rows.subList(1, rows.size());

        // 按chunkSize字符数分块，确保同一行不被拆分
        List<List<String>> currentChunk = new ArrayList<>();
        int currentChunkSize = 0;

        // 计算表头的字符数
        int headerSize = calculateRowSize(headers);

        for (List<String> row : dataRows) {
            int rowSize = calculateRowSize(row);

            // 如果当前分块为空，直接添加当前行（即使超过chunkSize，也要保证至少有一行）
            // 如果当前分块不为空，且添加当前行后不超过chunkSize，则添加
            // 如果当前分块不为空，且添加当前行后会超过chunkSize，则先输出当前分块，再开始新分块
            if (currentChunk.isEmpty()) {
                currentChunk.add(row);
                currentChunkSize = headerSize + rowSize;
            } else if (currentChunkSize + rowSize <= chunkSize) {
                currentChunk.add(row);
                currentChunkSize += rowSize;
            } else {
                // 当前分块已满，输出当前分块
                String html = buildHtmlTable(headers, currentChunk);
                result.add(html);

                // 开始新分块
                currentChunk = new ArrayList<>();
                currentChunk.add(row);
                currentChunkSize = headerSize + rowSize;
            }
        }

        // 处理最后一个分块
        if (!currentChunk.isEmpty()) {
            String html = buildHtmlTable(headers, currentChunk);
            result.add(html);
        }

        return result;
    }

    /**
     * 计算一行的字符数（包括表格标签的字符）
     */
    private int calculateRowSize(List<String> row) {
        int size = 0;
        // 每个单元格会有 <td> 和 </td> 标签，共9个字符
        // 加上换行符等格式化字符
        for (String cell : row) {
            size += (cell != null ? cell.length() : 0) + 9;
        }
        // 加上 <tr> 和 </tr> 标签以及格式化字符
        size += 15;
        return size;
    }

    private String buildHtmlTable(List<String> headers, List<List<String>> dataRows) {
        StringBuilder html = new StringBuilder();
        html.append("<table>\n");

        // 表头
        html.append("  <thead>\n    <tr>\n");
        for (String header : headers) {
            html.append("      <th>").append(escapeHtml(header)).append("</th>\n");
        }
        html.append("    </tr>\n  </thead>\n");

        // 表体
        html.append("  <tbody>\n");
        for (List<String> row : dataRows) {
            html.append("    <tr>\n");
            for (int i = 0; i < headers.size(); i++) {
                String value = i < row.size() ? row.get(i) : "";
                html.append("      <td>").append(escapeHtml(value)).append("</td>\n");
            }
            html.append("    </tr>\n");
        }
        html.append("  </tbody>\n");

        html.append("</table>");
        return html.toString();
    }

    private String escapeHtml(String text) {
        if (text == null) return "";
        return text
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#x27;");
    }

    // ==================== 文件类型检测 ====================

    private enum FileType {
        XLSX, XLS, CSV, UNKNOWN
    }

    /**
     * 通过文件头魔数检测文件类型
     */
    private FileType detectFileType(byte[] data) {
        if (data.length < 4) {
            return FileType.UNKNOWN;
        }

        // ZIP头 -> xlsx (OOXML格式)
        if (data[0] == 0x50 && data[1] == 0x4B && data[2] == 0x03 && data[3] == 0x04) {
            return FileType.XLSX;
        }

        // OLE头 -> xls (BIFF格式)
        if (data[0] == (byte) 0xD0 && data[1] == (byte) 0xCF
                && data[2] == (byte) 0x11 && data[3] == (byte) 0xE0) {
            return FileType.XLS;
        }

        // 简单判断CSV：包含大量逗号或换行符
        String sample = new String(data, 0, Math.min(100, data.length), StandardCharsets.UTF_8);
        if (sample.contains(",") && (sample.contains("\n") || sample.contains("\r"))) {
            return FileType.CSV;
        }

        return FileType.UNKNOWN;
    }

    /**
     * 简单的编码检测
     */
    private Charset detectCharset(byte[] data) {
        // 简单的BOM检测
        if (data.length >= 3 && data[0] == (byte) 0xEF && data[1] == (byte) 0xBB && data[2] == (byte) 0xBF) {
            return StandardCharsets.UTF_8;
        }
        if (data.length >= 2 && data[0] == (byte) 0xFE && data[1] == (byte) 0xFF) {
            return StandardCharsets.UTF_16BE;
        }
        if (data.length >= 2 && data[0] == (byte) 0xFF && data[1] == (byte) 0xFE) {
            return StandardCharsets.UTF_16LE;
        }

        // 默认UTF-8
        return StandardCharsets.UTF_8;
    }

    // ==================== Getters ====================

    public int getChunkSize() {
        return chunkSize;
    }
}
```

Excel To DB

其实，Excel并不适合放到向量数据库中做查询，因为他本身就是结构化数据了，更适合直接灌倒关系型数据库中做SQL的查询。

这也是比较常见的一种实现方式，那么，我们就需要能够提供一个能力，当用户上传excel的时候，可以解析excel的内容，同时创建一张表，并且把数据写入对应的表中。

如下图，是百炼中支持的数据查询类型的知识库，就是这样的处理方式。

![image.png](assets/c82d88f7b036.png)

当用户咨询的时候，再通过text2sql的方式，生成对应的sql语句，去表中做查询。

于是，我们在这里先实现一个把excel写入数据库的方案，后面的查询部分我们在检索的时候继续实现。

代码详见：ExcelProcessServiceImpl，都给大家增加了注释，结合着代码+注释+视频看下即可。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69d3bcd7d31fed0001466741
