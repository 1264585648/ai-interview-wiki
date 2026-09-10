---
title: "✅Chunk的metadata怎么设计的？怎么用？"
---

# ✅Chunk的metadata怎么设计的？怎么用？

metadata的作用，主要有两方面：

1、记录扩展信息

2、用于数据过滤（如权限控制）

以下是我们定义的一个常量类，我们把需要用到的metadata的key都定义进去了。

```text
package cn.hollis.llm.mentor.know.engine.ai.constant;

/**
 * 元数据的键常量
 * @author Hollis
 */
public class MetadataKeyConstant {
    /**
     * 文件名称
     */
    public static final String FILE_NAME = "fileName";


    public static final String DOC_ID = "docId";

    public static final String CHUNK_ID = "chunkId";

    /**
     * 父块ID
     */
    public static final String PARENT_CHUNK_ID = "parentChunkId";

    /**
     * 同级块ID
     */
    public static final String BROTHER_CHUNK_ID = "brotherChunkId";


    public static final String BROTHER_CHUNK_INDEX = "brotherChunkIndex";

    public static final String BROTHER_CHUNK_TOTAL = "brotherChunkTotal";

    /**
     * 头级别
     */
    public static final String HEADER_LEVEL = "headerLevel";

    /**
     * 访问权限
     */
    public static final String ACCESSIBLE_BY = "accessibleBy";

    /**
     * 文件地址
     */
    public static final String URL = "url";

    /**
     * 文件版本
     */
    public static final String VERSION = "version";

    /**
     * 分类
     */
    public static final String CATEGORY = "category";

    /**
     * 摘要
     */
    public static final String SUMMARY = "summary";

    /**
     * 关键字
     */
    public static final String KEYWORDS = "keywords";

    /**
     * 跳过embedding标记，true表示不需要做embedding
     */
    public static final String SKIP_EMBEDDING = "skipEmbedding";
}
```

扩展信息

向量数据库中我们需要保存一些，比如文档的名称，文档的地址等信息，这些信息可以用来标记当前分段的归属。

父子分块

权限控制

文档引用

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69be4ba451b144000159c394
