---
title: "✅（选学）自定义支持父子分片的基于Markdown标题的分片器"
---

# ✅（选学）自定义支持父子分片的基于Markdown标题的分片器

我们介绍下一种针对文档比较好用的分片方案——分层父子分片。

比如有下面这个文档，如果单纯按照传统的分片方案，一定会把内容拆的乱七八糟的，比较可行的就是基于markdown的标题期分块，如langchain中的MarkdownHeaderTextSplitter。

```text
# 利刃出鞘（Knives Out）

富豪小说家哈兰·斯隆比在自己85岁生日第二天，被发现在自家庄园离奇自杀，遗留了亿万遗产。久负盛名的大侦探布兰科（丹尼尔·克雷格饰）突然被匿名人士雇佣调查此案真相。同时，哈兰的孙子兰森（克里斯·埃文斯饰）也正在秘密调查此案。当布兰科和哈兰·斯隆比家族的其他人对谈时，他发现事情并没有想象中那么简单。  哈兰家族没有表面上那么和睦，每个人都有着不可告人的秘密，每个人都想得到遗产……究竟这起命案是自杀还是他杀？似乎每个人都有嫌疑。随着一位遗产继承人的意外亮相，真相谜底渐渐浮出水面……

电影链接：[电影链接](https://movie.douban.com/subject/30318116/)

海报图片：<img src="https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2574172427.jpg" alt="海报图片" />

## 类型

剧情 / 喜剧 / 悬疑

## 演职人员

### 导演

莱恩·约翰逊

### 编剧

莱恩·约翰逊

### 演员

丹尼尔·克雷格  安娜·德·阿玛斯  克里斯·埃文斯  杰米·李·柯蒂斯  迈克尔·珊农

## 豆瓣评分

8.2

## 国家

美国

## 语言

英语

## 年份

2019

## 时长

130分钟

---
```

但是这个MarkdownHeaderTextSplitter不仅在Java中没有对应的实现，而且也存在问题。以上文本会被拆成：

```text
# 利刃出鞘（Knives Out）

富豪小说家哈兰·斯隆比在自己85岁生日第二天，被发现在自家庄园离奇自杀，遗留了亿万遗产。久负盛名的大侦探布兰科（丹尼尔·克雷格饰）突然被匿名人士雇佣调查此案真相。同时，哈兰的孙子兰森（克里斯·埃文斯饰）也正在秘密调查此案。当布兰科和哈兰·斯隆比家族的其他人对谈时，他发现事情并没有想象中那么简单。  哈兰家族没有表面上那么和睦，每个人都有着不可告人的秘密，每个人都想得到遗产……究竟这起命案是自杀还是他杀？似乎每个人都有嫌疑。随着一位遗产继承人的意外亮相，真相谜底渐渐浮出水面……

电影链接：[电影链接](https://movie.douban.com/subject/30318116/)

海报图片：<img src="https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2574172427.jpg" alt="海报图片" />

——————————————————————————————————
## 类型

剧情 / 喜剧 / 悬疑
——————————————————————————————————

## 演职人员
——————————————————————————————————

### 导演

莱恩·约翰逊
——————————————————————————————————

### 编剧

莱恩·约翰逊
——————————————————————————————————

### 演员

丹尼尔·克雷格  安娜·德·阿玛斯  克里斯·埃文斯  杰米·李·柯蒂斯  迈克尔·珊农
——————————————————————————————————

## 豆瓣评分

8.2
——————————————————————————————————

## 国家

美国
——————————————————————————————————

## 语言

英语
——————————————————————————————————

## 年份

2019
——————————————————————————————————

## 时长

130分钟

——————————————————————————————————
```

这个分段之后，如果我们查询"克里斯·埃文斯演过的电影"，他会检索到这个分段：

```text
### 演员
丹尼尔·克雷格  安娜·德·阿玛斯  克里斯·埃文斯  杰米·李·柯蒂斯  迈克尔·珊农



Plain Text
```

但是这个分段中并没有关于电影的任何介绍，上下文是丢失的，所以，我们需要在这个分段中能有更多的信息，所以就可以用合并分段，则可以得到这样的层级关系

```text
# 利刃出鞘（Knives Out）

富豪小说家哈兰·斯隆比在自己85岁生日第二天，被发现在自家庄园离奇自杀，遗留了亿万遗产。久负盛名的大侦探布兰科（丹尼尔·克雷格饰）突然被匿名人士雇佣调查此案真相。同时，哈兰的孙子兰森（克里斯·埃文斯饰）也正在秘密调查此案。当布兰科和哈兰·斯隆比家族的其他人对谈时，他发现事情并没有想象中那么简单。  哈兰家族没有表面上那么和睦，每个人都有着不可告人的秘密，每个人都想得到遗产……究竟这起命案是自杀还是他杀？似乎每个人都有嫌疑。随着一位遗产继承人的意外亮相，真相谜底渐渐浮出水面……

电影链接：[电影链接](https://movie.douban.com/subject/30318116/)

海报图片：<img src="https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2574172427.jpg" alt="海报图片" />
——————————————————————————————————
	## 类型
	剧情 / 喜剧 / 悬疑
——————————————————————————————————
	## 演职人员
		### 导演
		莱恩·约翰逊
——————————————————————————————————
		### 编剧
		莱恩·约翰逊
——————————————————————————————————
		### 演员
		丹尼尔·克雷格  安娜·德·阿玛斯  克里斯·埃文斯  杰米·李·柯蒂斯  迈克尔·珊农
——————————————————————————————————
	## 豆瓣评分
	8.2
——————————————————————————————————
	## 国家
	美国
——————————————————————————————————
	## 语言
	英语
——————————————————————————————————
	## 年份
	2019
——————————————————————————————————
	## 时长
	130分钟
```

这个层级关系如何维护呢，可以用metadata，我们根据标题的把文档内容拆成不同的level，一级标题就是一级level，二级标题就是2级level，同时每一个分块的meta中记录这个level，并且还需要记录一个当前分块的chunkId，以及对应的上一层标题及内容的parentChunkId

首先我们先把langchain中的MarkdownHeaderTextSplitter用JAVA实现一遍，我从github上找到一个实现，可以直接拿过来：https://github.com/langchain4j/langchain4j/issues/574

但是因为他是基于langchain4j实现的，我们改用spring ai实现，并且在他的基础上增加对父子分片的支持。

代码实现如下：

````text

/**
 * Markdown文档分割器，基于标题层级进行文档分段
 * 支持保留元数据、父子分段关系等高级特性
 * 
 * @author andyflury （https://github.com/langchain4j/langchain4j/issues/574 ）
 * @author Hollis, 增加对父子分段的支持
 */
public class MarkdownHeaderTextSplitter extends TextSplitter {

    /** 需要分割的标题列表，按标题标记长度倒序排列 */
    private List<Map.Entry<String, String>> headersToSplitOn;
    
    /** 是否按行返回结果 */
    private boolean returnEachLine;
    
    /** 是否剥离标题行本身 */
    private boolean stripHeaders;
    
    /** 是否启用父子分段模式 */
    private boolean parentChildModel;

    /**
     * 构造函数
     * 
     * @param headersToSplitOn 标题分割映射表，key为标题标记（如"#"、"##"），value为元数据中的键名
     * @param returnEachLine 是否按行返回结果，false时会聚合相同元数据的行
     * @param stripHeaders 是否在结果中移除标题行
     * @param parentChildModel 是否启用父子分段模式，启用后会在元数据中添加parentChunkId
     */
    public MarkdownHeaderTextSplitter(Map<String, String> headersToSplitOn, boolean returnEachLine, boolean stripHeaders, boolean parentChildModel) {
        // 按标题标记长度倒序排列，确保优先匹配更长的标记（如"###"优先于"##"）
        this.headersToSplitOn = headersToSplitOn.entrySet().stream()
                .sorted(Comparator.comparingInt(e -> -e.getKey().length()))
                .collect(Collectors.toList());
        this.returnEachLine = returnEachLine;
        this.stripHeaders = stripHeaders;
        this.parentChildModel = parentChildModel;
    }

    /**
     * 重写apply方法以支持元数据的传递
     */
    @Override
    public List<Document> apply(List<Document> documents) {
        if (documents == null || documents.isEmpty()) {
            return Collections.emptyList();
        }

        List<Document> result = new ArrayList<>();
        for (Document doc : documents) {
            List<DocumentWithMetadata> segments = splitWithMetadata(doc.getText(), doc.getMetadata());
            for (DocumentWithMetadata segment : segments) {
                result.add(new Document(segment.getContent(), segment.getMetadata()));
            }
        }
        return result;
    }

    /**
     * 简化版分割方法，不保留元数据
     * 
     * @param text 待分割的文本
     * @return 分割后的文本片段列表
     */
    @Override
    protected List<String> splitText(String text) {
        // 简化版本，仅返回文本内容
        return splitWithMetadata(text, new HashMap<>()).stream()
                .map(DocumentWithMetadata::getContent)
                .collect(Collectors.toList());
    }

    /**
     * 核心分割逻辑，保留元数据
     * 
     * @param text 待分割的文本
     * @param baseMetadata 基础元数据，会被传递到每个分段中
     * @return 带有元数据的文档片段列表
     */
    private List<DocumentWithMetadata> splitWithMetadata(String text, Map<String, Object> baseMetadata) {
        List<String> lines = Arrays.asList(text.split("\n"));
        List<Line> linesWithMetadata = new ArrayList<>();
        List<String> currentContent = new ArrayList<>();
        Map<String, Object> currentMetadata = new HashMap<>(baseMetadata);
        List<Header> headerStack = new ArrayList<>();  // 标题栈，用于追踪当前的标题层级结构
        Map<String, Object> initialMetadata = new HashMap<>(baseMetadata);

        boolean inCodeBlock = false;  // 是否在代码块中
        String openingFence = "";     // 代码块的开始标记

        for (String line : lines) {
            String strippedLine = line.trim();

            // 处理代码块标记，代码块内的内容不作为标题处理
            if (!inCodeBlock) {
                if (strippedLine.startsWith("```")) &#123;
                    inCodeBlock = !inCodeBlock;
                    openingFence = "```";
                } else if (strippedLine.startsWith("~~~")) {
                    inCodeBlock = !inCodeBlock;
                    openingFence = "~~~";
                }
            } else {
                if (strippedLine.startsWith(openingFence)) {
                    inCodeBlock = false;
                    openingFence = "";
                }
            }

            // 代码块内的内容直接添加，不做标题检测
            if (inCodeBlock) {
                currentContent.add(strippedLine);
                continue;
            }

            // 检测并处理标题行
            interrupted:
            {
                for (Map.Entry<String, String> header : headersToSplitOn) {
                    String sep = header.getKey();    // 标题标记，如"#"、"##"
                    String name = header.getValue(); // 元数据中的键名

                    // 判断是否为有效的标题行
                    if (strippedLine.startsWith(sep) && (strippedLine.length() == sep.length() || strippedLine.charAt(sep.length()) == ' ')) {
                        if (name != null) {
                            // 计算当前标题级别（统计#的个数）
                            int currentHeaderLevel = (int) sep.chars().filter(ch -> ch == '#').count();

                            // 维护标题栈：移除所有级别大于等于当前级别的标题
                            // 这样可以正确处理标题层级关系，如从### 回退到 ##
                            while (!headerStack.isEmpty() && headerStack.get(headerStack.size() - 1).getLevel() >= currentHeaderLevel) {
                                Header poppedHeader = headerStack.remove(headerStack.size() - 1);
                                initialMetadata.remove(poppedHeader.getName());
                            }

                            // 将当前标题加入栈，并更新元数据
                            Header headerType = new Header(currentHeaderLevel, name, strippedLine.substring(sep.length()).trim());
                            headerStack.add(headerType);
                            initialMetadata.put(name, headerType.getData());
                            initialMetadata.put("headerLevel", currentHeaderLevel);
                            // 为每个分段生成唯一ID，用于后续建立父子关系
                            String currentChunkId = UUID.randomUUID().toString();
                            initialMetadata.put("chunkId", currentChunkId);
                        }

                        // 遇到新标题时，保存之前累积的内容
                        if (!currentContent.isEmpty()) {
                            linesWithMetadata.add(new Line(String.join("\n", currentContent), currentMetadata));
                            currentContent.clear();
                        }

                        // 根据stripHeaders配置决定是否保留标题行
                        if (!stripHeaders) {
                            currentContent.add(strippedLine);
                        }

                        break interrupted;
                    }
                }

                // 处理非标题行
                if (!strippedLine.isEmpty()) {
                    currentContent.add(strippedLine);
                } else if (!currentContent.isEmpty()) {
                    // 遇到空行时，保存当前累积的内容
                    linesWithMetadata.add(new Line(String.join("\n", currentContent), currentMetadata));
                    currentContent.clear();
                }
            }

            // 更新当前元数据为最新的标题信息
            currentMetadata = new HashMap<>(initialMetadata);
        }

        // 处理最后累积的内容
        if (!currentContent.isEmpty()) {
            linesWithMetadata.add(new Line(String.join("\n", currentContent), currentMetadata));
        }

        // 根据配置决定返回方式
        List<DocumentWithMetadata> segments;
        if (!returnEachLine) {
            // 聚合模式：将相同元数据的行合并
            segments = aggregateLinesToChunks(linesWithMetadata);
        } else {
            // 逐行模式：保持每行独立
            segments = linesWithMetadata.stream()
                    .map(line -> new DocumentWithMetadata(line.getContent(), line.getMetadata()))
                    .collect(Collectors.toList());
        }

        return segments;
    }

    /**
     * 聚合行为分块
     * 将具有相同元数据的行合并为一个分块，并处理父子关系
     * 
     * @param lines 待聚合的行列表
     * @return 聚合后的文档片段列表
     */
    private List<DocumentWithMetadata> aggregateLinesToChunks(List<Line> lines) {
        List<Line> aggregatedChunks = new ArrayList<>();
        for (Line line : lines) {
            // 情况1：元数据相同，直接合并到上一个分块
            if (!aggregatedChunks.isEmpty() && aggregatedChunks.get(aggregatedChunks.size() - 1).getMetadata().equals(line.getMetadata())) {
                Line last = aggregatedChunks.get(aggregatedChunks.size() - 1);
                last.setContent(last.getContent() + "  \n" + line.getContent());
            } 
            // 情况2：元数据不同但上一行以标题结尾且未剥离标题，则也合并
            // 这样可以将标题和其下的第一段内容合并在一起
            else if (!aggregatedChunks.isEmpty() && !aggregatedChunks.get(aggregatedChunks.size() - 1).getMetadata().equals(line.getMetadata())
                    && aggregatedChunks.get(aggregatedChunks.size() - 1).getMetadata().size() < line.getMetadata().size()
                    && aggregatedChunks.get(aggregatedChunks.size() - 1).getContent().split("\n")[aggregatedChunks.get(aggregatedChunks.size() - 1).getContent().split("\n").length - 1].startsWith("#") && !stripHeaders) {

                Line last = aggregatedChunks.get(aggregatedChunks.size() - 1);
                last.setContent(last.getContent() + "  \n" + line.getContent());
            } 
            // 情况3：创建新分块
            else {
                aggregatedChunks.add(line);
            }
        }

        // 处理父子分段关系
        if (parentChildModel) {
            try {
                // 遍历所有分块，为非顶级标题建立父子关系
                for (int i = 0; i < aggregatedChunks.size(); i++) {
                    Map<String, Object> currentMetaData = aggregatedChunks.get(i).getMetadata();
                    Integer headerLevel = (Integer) currentMetaData.get("headerLevel");
                    // 顶级标题（level=1）或无标题的分块跳过
                    if (headerLevel == null || headerLevel == 1) {
                        continue;
                    }

                    // 向前查找第一个级别更低的标题作为父节点
                    if (headerLevel > 1) {
                        for (int j = i - 1; j >= 0; j--) {
                            Map<String, Object> lastMetaData = aggregatedChunks.get(j).getMetadata();
                            Integer lastHeaderLevel = (Integer) lastMetaData.get("headerLevel");
                            if (lastHeaderLevel != null && lastHeaderLevel < headerLevel) {
                                // 将父节点的chunkId设置为当前节点的parentChunkId
                                currentMetaData.put("parentChunkId", lastMetaData.get("chunkId"));
                                break;
                            }
                        }
                    }
                }
            } catch (Exception e) {
                System.out.println("父子模式转换失败，" + e.getMessage());
            }
        }

        return aggregatedChunks.stream()
                .map(chunk -> new DocumentWithMetadata(chunk.getContent(), chunk.getMetadata()))
                .collect(Collectors.toList());
    }

    /**
     * 内部类：表示带有元数据的文本行
     */
    public static class Line {
        /** 文本内容 */
        private String content;
        /** 元数据信息 */
        private Map<String, Object> metadata;

        public Line(String content, Map<String, Object> metadata) {
            this.content = content;
            this.metadata = metadata;
        }

        public String getContent() {
            return content;
        }

        public void setContent(String content) {
            this.content = content;
        }

        public Map<String, Object> getMetadata() {
            return metadata;
        }

        public void setMetadata(Map<String, Object> metadata) {
            this.metadata = metadata;
        }
    }

    /**
     * 内部类：表示Markdown标题
     */
    public static class Header {
        /** 标题级别（1-6） */
        private int level;
        /** 元数据中的键名 */
        private String name;
        /** 标题文本内容（不含#标记） */
        private String data;

        public Header(int level, String name, String data) {
            this.level = level;
            this.name = name;
            this.data = data;
        }

        public int getLevel() {
            return level;
        }

        public void setLevel(int level) {
            this.level = level;
        }

        public String getName() {
            return name;
        }

        public void setName(String name) {
            this.name = name;
        }

        public String getData() {
            return data;
        }

        public void setData(String data) {
            this.data = data;
        }
    }

    /**
     * 内部类：携带元数据的文档片段
     */
    private static class DocumentWithMetadata {
        private final String content;
        private final Map<String, Object> metadata;

        public DocumentWithMetadata(String content, Map<String, Object> metadata) {
            this.content = content;
            this.metadata = new HashMap<>(metadata);
        }

        public String getContent() {
            return content;
        }

        public Map<String, Object> getMetadata() {
            return metadata;
        }
    }
}
````

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/697218e63fb918000103bd15
