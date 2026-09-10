---
title: "✅Agentic RAG"
---

# ✅Agentic RAG

RAG的主流程我们都讲完了，后面我们还会讲Agent，RAG往往都是会和Agent配合使用的。

在LLM的应用中，根据RAG的执行时机，或者是谁来决定执行来看的话，RAG系统可以分为2类，一类就是我们这个章节讲的这种，在AgentScope框架中把他叫做Generic RAG。

这种RAG的特点是，每次执行的顺序是固定的，即先做知识库的检索，然后再把检索到的内容交给LLM，由LLM总结后输出。

上面这种模式，我们在项目2中，用的就是这种。因为项目2 做的就是个智能客服，他的主要职责就是基于知识库回答用户问题。所以检索是个固定流程。

还有一种RAG，叫做Agentic RAG，他的特点是把RAG当做Agent的一个工具，什么时候要做知识库的检索，由Agent决定。如果Agent认为当前的问题需要做知识检索的话，他就会去是使用RAG检索和生成。整个过程都是由Agent决定的。

上面这种模式，我们的项目三用到了，会由我们的Agent决定什么时候去查询知识库。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a6ef2bbc71a8900018e3858
