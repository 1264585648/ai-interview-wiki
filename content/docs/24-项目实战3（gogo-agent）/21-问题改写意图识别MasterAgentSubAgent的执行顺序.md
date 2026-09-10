---
title: "✅问题改写、意图识别、MasterAgent、SubAgent的执行顺序"
---

# ✅问题改写、意图识别、MasterAgent、SubAgent的执行顺序

前面介绍了一些关于问题改写、意图识别、MasterAgent、SubAgent之间的执行的一些顺序内容，这里整体放到一起讲一下。

下面的activeAgent这个分支可以先不用管，这个是后面会讲的。

![](assets/72df2d5500b4.png)

**问题改写不是必经步骤**：先用原始问题跑 L1/L2 快路径，命中则完全跳过 QueryRewritingAgent；未命中才改写后重新识别。

**意图识别三层降级**：L1 规则 → L2 向量 → L3 LLM 兜底。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a5a0d8051b1440001ed9158
