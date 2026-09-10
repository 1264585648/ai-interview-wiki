---
title: "✅主流RAG评测框架：RAGAS、TruLens、DeepEval、Phoenix"
---

# ✅主流RAG评测框架：RAGAS、TruLens、DeepEval、Phoenix

为了降低评测的成本，更加"开箱即用"的实现RAG的评测，有很多成熟的框架出现，我们介绍几个目前比较主流的评测框架。

TruLens

开源地址：[https://github.com/truera/trulens](https://github.com/truera/trulens)

官方网站：[https://www.trulens.org/](https://www.trulens.org/)

TruLens 由 TruEra 开发（现被 Snowflake 收购），它的最大特色是提出了“RAG 三元组（RAG Triad）”评估体系，并极其强调对应用运行过程的全链路追踪。

因为他的核心评估体系是RAG三元组，所以他的主要指标是Context Relevance、Groundedness（Faithfulness）、Answer Relevance。

**TruLens 的可观测性集成是他的一个亮点**，可以通过无侵入式的“插桩（Instrumentation）”技术，自动记录应用执行的每一步。无论是提示词的构建、检索器的调用、还是大模型的流式输出，它都能完整记录下来。当应用效果变差时，你可以像查看“慢 SQL 日志”一样，精准回溯到具体是哪个环节、哪条数据出了问题。([https://www.trulens.org/component_guides/instrumentation/](https://www.trulens.org/component_guides/instrumentation/) )

TruLens它对 LangChain/LangGraph 和 Llama-Index 都有比较好的集成，可以方便地用于评估这两个框架搭建的 RAG 应用。

![](assets/dab08a5b7dc4.png)

TruLens 的自动化评估主要依赖“反馈函数（Feedback Functions）”。其底层原理是利用一个强大的 LLM作为裁判，通过精心设计的提示词，对应用的输入、输出和中间结果进行打分（通常是 0-10 分）。

TruLens 提供了一个直观的可视化 Dashboard。当你调整了 RAG 系统的某个参数（比如更换了 Embedding 模型、修改了 Prompt 模板）后，可以并行运行多个版本的实验。Dashboard 会清晰地展示各版本在“RAG 三元组”各项指标上的得分对比，帮助你用数据驱动决策，选出最优版本。

![](assets/2b9feba1eaec.png)

Trulens因为具有比较强大的可观测性支持，比较适合用来评估复杂的智能体，用来诊断具体哪里失败了。尤其是那种《你不仅关心“输出是否好”，更关心“流程中哪里出错”时》的场景。

RAGAS（RAG首选）

开源地址：[https://github.com/vibrantlabsai/ragas](https://github.com/vibrantlabsai/ragas)

官网地址：[https://www.ragas.io/](https://www.ragas.io/)

RAGAS是一个专门针对 RAG 系统设计的开源评估框架。它的核心优势在于**指标设计非常贴合 RAG 的运作机理**，并且支持在没有标准答案的情况下进行自动化评估。

我们前面介绍过的RAG评测的指标他都支持，包括Faithfulness、Answer Relevancy、Context Precision、Context Recall以及Answer Correctness。

**RAGAS 的核心工作原理就是LLM-as-a-Judge，**核心思想是利用强大的大语言模型作为裁判，去自动判断 RAG 系统的输出质量。

RAGAS 最大的亮点之一是**支持无参考答案评估（Reference-free）**。在真实的业务场景中，很多问题（如“这个合同条款有什么风险？”）很难提前写出唯一的标准答案。RAGAS 的 Faithfulness、Context Precision 等指标**不需要标准答案**，只需要“问题+检索到的上下文+模型生成的回答”即可进行自动化打分，极大降低了评测门槛。

RAGAS 是一个独立的评估库，不强绑定某个 RAG 开发框架。无论你用的是 LangChain、LlamaIndex 还是自己手写的 RAG 管道，都可以直接接入使用。

总之，RAGAS就是一个专为 RAG 设计的轻量级评测框架，并且可以无需依赖Ground Truth（也可以依赖），适合用来评估一个纯RAG的系统。

DeepEval（Python单测集成）

开源地址：[https://github.com/confident-ai/deepeval](https://github.com/confident-ai/deepeval)

官网地址：[https://deepeval.com/](https://deepeval.com/)

DeepEval 的设计理念非常像程序员熟悉的单元测试框架（如 Pytest），它主张**用写代码测试用例的方式来测试 LLM**。它非常适合集成到企业的 CI/CD流程中，防止模型上线后出现质量回退。

他的**核心特点**：

- **指标极其丰富**：内置了 30+ 种标准化指标，不仅包含 RAG 常用指标，还涵盖了**安全性检测**（如毒性、偏见、PII 隐私泄露）、**格式验证**（如 JSON 正确性）以及**代理（Agent）指标**（如任务完成度、工具使用正确率）。
- **工程化落地强**：支持本地化部署，确保敏感数据不出境；支持异步处理和分布式评测，非常适合企业级大规模、高并发的评测需求。
- **红队测试**：内置了多种攻击增强策略，可以主动对模型进行“红队测试”，挖掘潜在的安全漏洞。

Phoenix

开源地址：[https://github.com/arize-ai/phoenix](https://github.com/arize-ai/phoenix)

Phoenix也是一个集离线评测合应用可观测性于一身的框架，

- **核心特点**：
- **生产级监控**：除了常规的检索与生成质量评估，Phoenix 还能实时监控线上的**效果指标**（如幻觉率、用户满意度）和**系统指标**（如 P99 延迟、Token 消耗成本）。
- **告警与根因分析**：当线上幻觉率突然飙升或延迟超标时，Phoenix 可以触发告警。你可以直接通过用户反馈（如点了“踩”的回答）快速定位到对应的完整执行链路，排查是知识库更新导致的问题，还是模型接口出现了瓶颈。
- **数据闭环**：能够将生产环境中发现的坏案例（Bad Cases）直接转化为测试数据集，用于下一轮的模型优化，形成持续迭代的闭环。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a0c164551b1440001a13d2a
