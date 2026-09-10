---
title: "✅基于Dify实现Ai Workflow"
---

# ✅基于Dify实现Ai Workflow

Anthropic在 《[Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)》这篇文章中也提了一些关于workflow用来构建智能体系统的一些"范式"。我们借助这几种范式也顺带介绍下工作流的常见搭建方式。

Prompt Chaining

提示链模式将任务分解为一系列步骤，每次 LLM 调用都处理前一次 LLM 的输出。你可以在任何中间步骤上添加校验（如示图中的“Gate”），以确保该过程仍运行在正轨上。

![](assets/2a080dcfe95e.png)

如以下方式，我们通过一个LLM链，生成一份公众号文章，三个不同的节点，分别做大纲生成，文章生成以及内容润色。

![](assets/a32cb4ea4851.png)

DSL内容（可直接导入Dify）：

[PromptChaining.yml](https://tcs-devops.aliyuncs.com/storage/103r65fd64ed57d76865efa06ac08a67db7b?Signature=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJBcHBJRCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9hcHBJZCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9vcmdhbml6YXRpb25JZCI6IiIsImV4cCI6MTc4OTYwOTg4MCwiaWF0IjoxNzg5MDA1MDgwLCJyZXNvdXJjZSI6Ii9zdG9yYWdlLzEwM3I2NWZkNjRlZDU3ZDc2ODY1ZWZhMDZhYzA4YTY3ZGI3YiJ9.yeWuXKHrp1Si69oIhFF6kmbnp5U7fTU6BuPvXJvA_PU&download=PromptChaining.yml)

Routing

路由模式根据输入类型路由到不同专用处理流程或模型。

![](assets/3aa340c9b0a3.png)

在上面的流程中，我们引入一个问题分类器，做用户的意图识别，根据意图分别路由到不同的分支，生成公众号文章或者小红书文案。

![](assets/2176c607df5e.png)

DSL内容（可直接导入Dify）：

[Routing.yml](https://tcs-devops.aliyuncs.com/storage/103rb6dc6186615fa194781c9a8e71e44bde?Signature=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJBcHBJRCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9hcHBJZCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9vcmdhbml6YXRpb25JZCI6IiIsImV4cCI6MTc4OTYwOTg4MCwiaWF0IjoxNzg5MDA1MDgwLCJyZXNvdXJjZSI6Ii9zdG9yYWdlLzEwM3JiNmRjNjE4NjYxNWZhMTk0NzgxYzlhOGU3MWU0NGJkZSJ9.2ewuJ59AIpmmeYmD33ZX_9aLF03KEM_YHQ_Qn1MqWAU&download=Routing.yml)

Parallelization

LLM有时可以同时处理一项任务，并以编程方式聚合它们的输出，这种工作流称为并行模式。其具备两个关键变体：

- 分段 Sectioning : 将任务分解为并行运行的独立子任务。
- 投票 Voting ：多次运行同一任务，以获取到多样化的输出。

![](assets/cbd0d5838e0c.png)

比如以下工作流，我们通过并行的方式同时生成文章的标题和内容，最终组合成一篇完整的文章。

![](assets/384049550f3d.png)

DSL内容（可直接导入Dify）：

[Parallelization.yml](https://tcs-devops.aliyuncs.com/storage/103ra55d68254db8e4a4c3f968f6eea8c1e2?Signature=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJBcHBJRCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9hcHBJZCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9vcmdhbml6YXRpb25JZCI6IiIsImV4cCI6MTc4OTYwOTg4MCwiaWF0IjoxNzg5MDA1MDgwLCJyZXNvdXJjZSI6Ii9zdG9yYWdlLzEwM3JhNTVkNjgyNTRkYjhlNGE0YzNmOTY4ZjZlZWE4YzFlMiJ9.E3X6om3_2sS7Fu5EzadP0NdwdftNotkmsDZOkWhdDzY&download=Parallelization.yml)

Evaluator-Optimizer

评估者-优化者模式中，调用一个 LLM 生成响应内容，而另一个 LLM 在循环中提供评估和反馈，直到评估被接受通过。

![](assets/6914938ba929.png)

以下流程中，我们增加了一个循环，在循环中不断优化和润色文章内容。

![](assets/25e7f44638d7.png)

DSL内容（可直接导入Dify）：

[Evaluator-Optimizer.yml](https://tcs-devops.aliyuncs.com/storage/103rf6f9c07bec21ce0b317bbcf27990a001?Signature=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJBcHBJRCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9hcHBJZCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9vcmdhbml6YXRpb25JZCI6IiIsImV4cCI6MTc4OTYwOTg4MCwiaWF0IjoxNzg5MDA1MDgwLCJyZXNvdXJjZSI6Ii9zdG9yYWdlLzEwM3JmNmY5YzA3YmVjMjFjZTBiMzE3YmJjZjI3OTkwYTAwMSJ9.ig-6oqPyerMa7JFOoR2W9frPtQCZo0WjiWwPyLZiYj4&download=Evaluator-Optimizer.yml)

Orchestrator-Workers

在协调器-工作者模式中，一个中央协调者 LLM 动态分解任务，将其委派给工作者 LLM，并综合它们的结果。

![](assets/74ba246526c5.png)

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69882cb7d31fed00010e2406
