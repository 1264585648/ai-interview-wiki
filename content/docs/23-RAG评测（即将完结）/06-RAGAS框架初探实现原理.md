---
title: "✅RAGAS框架初探&实现原理"
---

# ✅RAGAS框架初探&实现原理

RAGAS评估流程

前面我们介绍过了RAGAS，它是一个用于评估RAG管道质量的框架。他的评估流程如下：

![](assets/fdc53a815668.png)

**1. 输入数据源 (Input Data)**

评估需要四个核心数据元素：

- **Question（user_input）**: 用户提出的问题。
- **Answer（response）**: LLM 根据检索内容生成的答案。
- **Context（retrieved_contexts）**: 从向量数据库中检索到的上下文片段。
- **Ground Truth（reference）**: 标注的标准答案（用于衡量准确性）。

**2. 评估处理引擎 (Evaluation Engine)**

这是 RAGAS 的核心，包含三个协作组件：

- **LLM (大语言模型)**: 用于语义分析和相关性判断。
- **Embedding (向量嵌入模型)**: 用于文本向量化和相似度计算。
- **计算引擎**: 执行 MAP 计算、F1 分数统计等数学度量。

**3. 输出评估指标 (Output Metrics)**

系统最终输出多个维度的评分（通常在 0 到 1 之间）：

| **指标名称** | **含义** |
| --- | --- |
| **Faithfulness (忠实度)** | 答案是否仅基于检索到的上下文，有无幻觉。 |
| **Answer Relevance (答案相关性)** | 生成的答案与原问题的匹配程度。 |
| **Context Precision (上下文精准度)** | 检索到的内容中，相关信息排在前面的程度。 |
| **Context Recall (上下文召回率)** | 检索内容是否覆盖了回答问题所需的全部关键点。 |
| **Answer Correctness (答案正确性)** | 生成答案与标准答案的一致性。 |
| Semantic Similarity (语义相似度) | 生成答案与标准答案在语义向量空间上的接近程度。 |

RAGAS评估演示

请注意，我们这里是基于ragas的0.4.3版本的，低了肯定不行，高了也不一定。ragas的版本变化还是比较大的。网上给的示例，包括直接让ai帮忙写的话，基本上在这个版本下都跑不通。所以，请和我版本保持一致。

本文使用的模型，建议使用qwen3.6-plus。我在测试的时候发现qwen3.7-max效果不如qwen3.6-plus，具体原因不明。可能是因为刚出来吧。

环境准备

```
--初始化环境
uv init ragas_demo

cd ragas_demo 
uv venv

-- 激活虚拟环境
# Linux/macOS source 
source .venv/bin/activate

# Windows 
.venv\Scripts\activate
```

创建配置文件

```
echo "OPENAI_API_KEY=sk-你的实际API密钥
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1" > .env
```

添加依赖

```
echo "ragas>=0.4.3
openai>=1.0.0
langchain-openai<0.1.0
langchain<0.1.0
langchain-community<0.1.0
datasets>=2.0.0
python-dotenv>=1.0.0" > requirements.txt

uv pip install -r requirements.txt
```

Context Precision评估

`ContextPrecision`（上下文精确度）的核心目的是：**评估检索到的内容里，有多少是真正相关的，并且这些相关的内容是否被排在了前面。（**[https://docs.ragas.io/en/latest/concepts/metrics/available_metrics/context_precision/](https://docs.ragas.io/en/latest/concepts/metrics/available_metrics/context_precision/) ）

核心计算逻辑是 Precision@k 的加权平均。

![](assets/f7553f392a8b.png)

- **K**：检索到的上下文总数（也就是你传入的 `retrieved_contexts` 列表的长度）。
- **Vk**** ：第 ****k**** 个位置的相关性标志（Relevance Indicator）。如果第 ****k****条内容相关， V****k=1****；如果不相关， V****k=0**** 。（靠LLM来评判）**
- **Precision@k**：第 K 位的准确率。

![](assets/61e3c50681c6.png)

我们准备**数据集**如下**：**

- 用户问题：杭州西湖有哪些著名的景点？
- 参考答案：杭州西湖拥有许多著名景点，包括断桥、苏堤、雷峰塔和三潭印月等。
- 检索到的上下文：
- "杭州西湖是中国著名的旅游景点，其中断桥残雪是西湖十景之一。"
- "雷峰塔位于西湖南岸，是西湖的标志性建筑之一。"
- "苏堤春晓也是西湖十景之一，贯穿西湖南北。"
- "北京的故宫是中国明清两代的皇家宫殿。"

代码如下：

```
import asyncio
import os
from openai import AsyncOpenAI 
from dotenv import load_dotenv
from ragas.llms import llm_factory
from ragas.metrics.collections import ContextPrecision

# 加载 .env 文件中的环境变量（如 OPENAI_API_KEY）
load_dotenv()

# --- 设置大语言模型 (LLM) ---
# 初始化 OpenAI 异步客户端
openai_client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
# 使用工厂方法创建 ragas 所需的 LLM 实例（这里以 qwen3.7-max 为例）
llm = llm_factory("qwen3.7-max", client=openai_client)

# --- 创建评估指标 ---
# 初始化“上下文精确度(Context Precision)”评分器
scorer = ContextPrecision(llm=llm)


async def main():
    print("开始执行 RAGAS 上下文精确度评估...")
    
    # 调用 ascore 进行异步评分
    result = await scorer.ascore(
        user_input = "杭州西湖有哪些著名的景点？",
	    reference = "杭州西湖拥有许多著名景点，包括断桥、苏堤、雷峰塔等。",
	    retrieved_contexts = [
	        "杭州西湖是中国著名的旅游景点，其中断桥残雪是西湖十景之一。",
	        "雷峰塔位于西湖南岸，是西湖的标志性建筑之一。",
	        "苏堤春晓也是西湖十景之一，贯穿西湖南北。",
	        "北京的故宫是中国明清两代的皇家宫殿。"  # 这是一个不相关的干扰项
	    ]
    )
    
    # 打印最终的评估结果
    print(f"评估完成！上下文精确度得分 (Context Precision Score): {result.value}")

# 在脚本入口通过 asyncio.run() 驱动执行异步主函数
if __name__ == "__main__":
    print("--- 脚本启动 ---")
    asyncio.run(main())
    print("--- 脚本结束 ---")
```

运行结果：

```
--- 脚本启动 ---
开始执行 RAGAS 上下文精确度评估...
评估完成！上下文精确度得分 (Context Precision Score): 0.99999999995
--- 脚本结束 ---
```

我们验证下结果，根据上面的计算方法：

| 排名 (k) | 内容 | 是否相关 (v_k) | 计算逻辑 (Precision@k) | 当前得分 |
| --- | --- | --- | --- | --- |
| **1** | **断桥**<br>（西湖景点） | **是 (1)** | 前1条里有1条相关：1/1 | **1.0** |
| **2** | **雷峰塔**<br>（西湖景点） | **是 (1)** | 前2条里有2条相关：2/2 | **1.0** |
| **3** | **苏堤**<br>（西湖景点） | **是 (1)** | 前3条里有3条相关：3/3 | **1.0** |
| **4** | **故宫**<br>（北京景点） | **否 (0)** | 前4条里有3条相关：3/4 | **0.75** |

**分子**（加权和）： (1.0×1)+(1.0×1)+(1.0×1)+(0.75×0)=3.0

**分母**（总相关数）：3 （断桥、雷峰塔、苏堤）

**结果**：3.0/3=1.0

但是实际LLM跑出来的结果会趋近于1，但是不会等于1，因为LLM 的“幻觉”或严苛判断，比如负责打分的 LLM（qwen3.7-max）可能会觉得某句话虽然提到了景点，但没有完整回答“有哪些”，从而稍微扣一点分。

如果调整一下检索到的上下文的顺序，那么重新运行一下，

```
retrieved_contexts = [
    "北京的故宫是中国明清两代的皇家宫殿。",
        "杭州西湖是中国著名的旅游景点，其中断桥残雪是西湖十景之一。",
        "雷峰塔位于西湖南岸，是西湖的标志性建筑之一。",
        "苏堤春晓也是西湖十景之一，贯穿西湖南北。"
    ]
```

则变成：

| 排名 (k) | 内容 | 是否相关 (v_k) | 计算逻辑 (Precision@k) | 当前得分 |
| --- | --- | --- | --- | --- |
| **1** | **故宫**<br>（北京景点） | **否 (0)** | 前1条里有1条相关：0/1 | **0****.0** |
| **2** | **雷峰塔**<br>（西湖景点） | **是 (1)** | 前2条里有1条相关：1/2 | **0.5** |
| **3** | **苏堤**<br>（西湖景点） | **是 (1)** | 前3条里有2条相关：2/3 | **0.67** |
| **4** | **断桥**<br>（西湖景点） | **是 (1)** | 前4条里有3条相关：3/4 | **0.75** |

得到结果大概是0.64左右。脚本运行结果也差不多：

```
--- 脚本启动 ---
开始执行 RAGAS 上下文精确度评估...
评估完成！上下文精确度得分 (Context Precision Score): 0.6388888888675925
--- 脚本结束 ---
```

Context Recall评估

**上下文召回率（Context Recall）** 衡量的是有多少相关文档被成功检索了出来。它的核心关注点在于**不要遗漏重要的结果**。（[https://docs.ragas.io/en/latest/concepts/metrics/available_metrics/context_recall/](https://docs.ragas.io/en/latest/concepts/metrics/available_metrics/context_recall/) ）

ragas中提供了多种评估方式，有基于LLM的，有基于传统字符串比较的，如BLEU、ROUGE，还有基于文档ID重合度的。我们重点介绍基于LLM的。

它的核心公式是：

`Context Recall = 参考答案中能被检索上下文支持的声明数量 / 参考答案中的总声明数量`

- 拆解声明
- 评估模型首先会阅读人类给出的【标准答案】（Reference），并将其拆解成若干个独立的、不可再分的客观事实或陈述句（即“声明”，Claims）。目的是把一段完整的回答打散，变成一个个可以被单独验证的知识点。
- 匹配验证
- 接着，评估模型会拿着第一步拆解出来的每一个“声明”，逐一去【检索到的上下文】（Retrieved Contexts）中寻找证据。它会判断：**这个声明里的信息，能不能从检索到的文档里推断出来？**
- 如果能找到依据，该声明标记为“支持”（Attributed）；
- 如果找不到，则标记为“不支持”（Not Attributed）。
- 计算得分
- 最后，统计所有被标记为“支持”的声明数量，除以声明的总数，得出最终的召回率分数（取值范围在 0 到 1 之间）。

实现代码如下：

```
import asyncio
import os
from openai import AsyncOpenAI 
from dotenv import load_dotenv
from ragas.llms import llm_factory
from ragas.metrics.collections import ContextRecall
from ragas.dataset_schema import SingleTurnSample

# 加载 .env 文件中的环境变量（如 OPENAI_API_KEY）
load_dotenv()

# --- 设置大语言模型 (LLM) ---
# 初始化 OpenAI 异步客户端
openai_client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
# 使用工厂方法创建 ragas 所需的 LLM 实例（这里以 qwen3.7-max 为例）
llm = llm_factory("qwen3.7-max", client=openai_client)

# --- 创建评估指标 ---
# 初始化“上下文召回率Context Recall)”评分器
scorer = ContextRecall(llm=llm)


async def main():
    print("开始执行 RAGAS 上下文召回率评估...")

    result = await scorer.ascore(
        user_input = "杭州西湖有哪些著名的景点？",
	    reference = "杭州西湖拥有许多著名景点，包括断桥、苏堤、雷峰塔等。",
	    retrieved_contexts = [
            "北京的故宫是中国明清两代的皇家宫殿。",  # 这是一个不相关的干扰项
	        "杭州西湖是中国著名的旅游景点，其中断桥残雪是西湖十景之一。",
	        "雷峰塔位于西湖南岸，是西湖的标志性建筑之一。",
	        "苏堤春晓也是西湖十景之一，贯穿西湖南北。"
	    ]
    )
    
    print(f"评估完成！上下文召回率得分 (Context Recall Score): {result.value}")

if __name__ == "__main__":
    print("--- 脚本启动 ---")
    asyncio.run(main())
    print("--- 脚本结束 ---")
```

我们验证下结果，根据上面的计算方法：

**拆解声明**：评估模型将标准答案拆分为 **3个** 独立声明：

- 声明1：西湖有断桥。
- 声明2：西湖有苏堤。
- 声明3：西湖有雷峰塔。

**匹配验证**：

- 验证声明1 -> 在文档B中找到对应信息 -> ✅
- 验证声明2 -> 在文档C中找到对应信息 -> ✅
- 验证声明3 -> 在文档C中找到对应信息 -> ✅

1. **计算得分**：
2. 总声明数 = 3
3. 被支持的声明数 = 3
4. **最终得分** = 3 ÷ 3 = 1

代码运行结果：

```
--- 脚本启动 ---
开始执行 RAGAS 上下文召回率评估...
评估完成！上下文召回率得分 (Context Recall Score): 1.0
--- 脚本结束 ---
```

如果标准答案换一下，如"杭州西湖拥有许多著名景点，包括断桥、苏堤、雷峰塔、三潭映月等。"，这时候召回率得分就会下降：

```
--- 脚本启动 ---
开始执行 RAGAS 上下文召回率评估...
评估完成！上下文召回率得分 (Context Recall Score): 0.8
--- 脚本结束 ---
```

Answer Relevancy 评估

Ragas 采用了一种巧妙的“反向重构”方法来计算Answer Relevancy （答案相关性），整个过程不需要人工标注的标准答案（Ground Truth），完全基于向量相似度。

它的核心逻辑是：**如果一个回答是高质量且相关的，那么我们一定能够根据这个回答反向推导出用户原本的问题。**

他的主要流程是：

- 反向生成问题
- 利用LLM，根据 RAG 生成的 `response`（回答），反向生成 N个可能的“用户问题”。
- 计算向量相似度
- 系统会计算这些“反向生成的问题”与“用户原始问题”之间的语义相似度
- 取平均值
- 将所有生成问题的相似度得分取平均值，得到最终的 Answer Relevancy Score。

比如测评代码如下：

```
import asyncio
import os
from openai import AsyncOpenAI 
from dotenv import load_dotenv
from ragas.embeddings.base import embedding_factory
from ragas.llms import llm_factory
from ragas.metrics.collections import AnswerRelevancy

# 加载 .env 文件中的环境变量（如 OPENAI_API_KEY）
load_dotenv()

# --- 设置大语言模型 (LLM) ---
# 初始化 OpenAI 异步客户端
openai_client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
# 使用工厂方法创建 ragas 所需的 LLM 实例（这里以 qwen3.7-max 为例）
llm = llm_factory("qwen3.7-max", client=openai_client)
embeddings = embedding_factory("openai", model="text-embedding-v4", client=openai_client)


# --- 创建评估指标 ---
# 初始化“答案相关性（Answer Relevancy)”评分器
scorer = AnswerRelevancy(llm=llm, embeddings=embeddings)


async def main():
    print("开始执行 RAGAS 答案相关性评估...")
    result = await scorer.ascore(
        user_input="法国在哪里？它的首都是什么？",
        response="法国在西欧，首都是巴黎。"
    )
    
    print(f"评估完成！答案相关性 (Answer Relevancy Score): {result.value}")

if __name__ == "__main__":
    print("--- 脚本启动 ---")
    asyncio.run(main())
    print("--- 脚本结束 ---")
```

最终得到的结果是：

```
--- 脚本启动 ---
开始执行 RAGAS 上下文召回率评估...
评估完成！答案相关性 (Answer Relevancy Score): 0.9571586544877398
--- 脚本结束 ---
```

那如果改一下：

```
result = await scorer.ascore(
        user_input="法国在哪里？它的首都是什么？",
        response="法国的著名作家是雨果"
    )
```

运行结果：

```
--- 脚本启动 ---
开始执行 RAGAS 答案相关性评估...
评估完成！答案相关性 (Answer Relevancy Score): 0.5683216023102122
--- 脚本结束 ---
```

在实际测试的过程中，经常会出现结果不一致的情况，分数不固定，有的时候0.9xx，有的时候就变成了0.7xx，那主要是因为模型幻觉，可以通过设置参数方式抑制幻觉，如：

```
# 使用工厂方法创建 ragas 所需的 LLM 实例，并直接传入 temperature 和 seed
llm = llm_factory(
    "qwen3.7-max", 
    client=openai_client,
    temperature=0.1,  # 降低温度使评估结果更稳定、确定
    seed=42           # 固定随机种子以实现可复现的输出
)
```

Faithfulness评估

所谓忠诚度，其实就是判断AI 生成的 `response`（回答）在事实层面与 `retrieved context`（检索到的上下文）的一致性。

计算步骤：

- **声明提取：**首先，系统会将 AI 生成的回答（Response）拆解成独立的、可验证的**“声明”**。
- **支持性验证：**接着，系统会逐一检查这些声明，判断它们是否可以从提供的检索上下文（Retrieved Contexts）中推断出来。
- **分数计算：**最后，通过一个简单的公式计算出最终分数：**`忠实度得分 = （回答中能被检索上下文支持的声明数量） ÷ （回答中的总声明数量）`**

有以下评估代码：

```
import asyncio
import os
from openai import AsyncOpenAI 
from dotenv import load_dotenv
from ragas.llms import llm_factory
from ragas.metrics.collections import Faithfulness

# 加载 .env 文件中的环境变量（如 OPENAI_API_KEY）
load_dotenv()

# --- 设置大语言模型 (LLM) ---
# 初始化 OpenAI 异步客户端
openai_client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
# 使用工厂方法创建 ragas 所需的 LLM 实例（这里以 qwen3.7-max 为例）
llm = llm_factory("qwen3.7-max", client=openai_client)


# --- 创建评估指标 ---
# 初始化“忠诚度（Faithfulness)”评分器
scorer = Faithfulness(llm=llm)


async def main():
    print("开始执行 RAGAS 忠诚度评估...")
    result = await scorer.ascore(
        user_input="爱因斯坦在哪里出生，什么时候出生的？",
        response="爱因斯坦于 1879 年 3 月 20 日 在德国出生。",
        retrieved_contexts=[
         "Albert Einstein (born 14 March 1879) was a German-born theoretical physicist..."
       ]
    )
    
    print(f"评估完成！忠诚度 (Faithfulness Score): {result.value}")

if __name__ == "__main__":
    print("--- 脚本启动 ---")
    asyncio.run(main())
    print("--- 脚本结束 ---")
```

输出结果：

```
--- 脚本启动 ---
开始执行 RAGAS 忠诚度评估...
评估完成！忠诚度 (Faithfulness Score): 0.5
--- 脚本结束 ---
```

Answer Correctness 评估

`Answer Correctness`（答案正确性）是来评估AI给出的答案和参考答案之间的一致性的。

该指标同时考量两个关键方面，并通过加权平均的方式综合得出最终分数：

- **语义相似度 (Semantic Similarity)**：衡量生成的答案与标准答案（Ground Truth）在含义上的接近程度。
- **事实正确性 (Factual Correctness)**：量化生成的答案与标准答案之间事实重叠的部分。

**事实正确性的计算 (基于 F1 Score)**

事实正确性部分通过计算 F1 Score 来量化。系统会将答案分解为独立的“事实”或“陈述”进行比对：其 F1 Score 的计算公式为：`F1 Score = |TP| / (|TP| + 0.5 × (|FP| + |FN|))`

1. **True Positive (TP)**：在标准答案和生成答案中都存在的事实。
2. **False Positive (FP)**：仅在生成答案中存在，但标准答案中没有的事实（即多出的或编造的信息）。
3. **False Negative (FN)**：仅在标准答案中存在，但生成答案中缺失的事实。

**最终分数的合成**

最终的 `Answer Correctness` 分数是 **语义相似度** 和上述计算出的 **事实正确性 (F1 Score)** 的加权平均值。

1. 用户可以通过 `weights` 参数来调整这两个维度的权重。
2. 分数范围在 0 到 1 之间，分数越高代表答案越接近标准答案。
3. 用户也可以选择设置一个 `threshold`（阈值），将结果分数转换为二进制结果（例如，达到阈值为1，未达到为0）。

代码：

```
import asyncio
import os
from openai import AsyncOpenAI 
from dotenv import load_dotenv
from ragas.llms import llm_factory
from ragas.metrics.collections import AnswerCorrectness
from ragas.embeddings.base import embedding_factory


# 加载 .env 文件中的环境变量（如 OPENAI_API_KEY）
load_dotenv()

# --- 设置大语言模型 (LLM) ---
# 初始化 OpenAI 异步客户端
openai_client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
# 使用工厂方法创建 ragas 所需的 LLM 实例（这里以 qwen3.7-max 为例）
llm = llm_factory("qwen3.7-max", client=openai_client)
embeddings = embedding_factory("openai", model="text-embedding-v4", client=openai_client)



# --- 创建评估指标 ---
# 初始化“答案正确性（Answer Correctness)”评分器
scorer = AnswerCorrectness(llm=llm, embeddings=embeddings)


async def main():
    print("开始执行 RAGAS 答案正确性评估...")
    result = await scorer.ascore(
    user_input="爱因斯坦什么时候出生，出生在哪里？",
    response="爱因斯坦于1879年出生在西班牙。",
    reference="爱因斯坦于1879年出生在德国。"
)
    
    print(f"评估完成！答案正确性 (Answer Correctness Score): {result.value}")

if __name__ == "__main__":
    print("--- 脚本启动 ---")
    asyncio.run(main())
    print("--- 脚本结束 ---")
```

输出结果：

```
--- 脚本启动 ---
开始执行 RAGAS 答案正确性评估...
评估完成！答案正确性 (Answer Correctness Score): 0.5857994993870638
--- 脚本结束 ---
```

指标依赖对比

| 指标 | 问题 | AI回答 | 参考材料 | 标准答案 | LLM | Embedding |
| --- | --- | --- | --- | --- | --- | --- |
| Context Precision<br>上下文准确率 | ✅ |  | ✅ | ✅ | ✅ |  |
| Context Recall<br>上下文召回率 | ✅ |  | ✅ | ✅ | ✅ |  |
| Answer Relevancy<br>答案相关性 | ✅ | ✅ |  |  | ✅ | ✅ |
| Faithfulness<br>忠诚度 | ✅ | ✅ | ✅ |  | ✅ |  |
| Answer Correctness<br>答案准确性 | ✅ | ✅ |  | ✅ | ✅ | ✅ |

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a0c169ca7c8ff0001c234d7
