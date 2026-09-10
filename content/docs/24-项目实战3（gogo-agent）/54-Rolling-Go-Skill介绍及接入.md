---
title: "✅Rolling Go Skill介绍及接入"
---

# ✅Rolling Go Skill介绍及接入

**Rolling Go 是一家全球旅行服务数字化分发平台，链接全球旅行资源。 Rolling Go 针对外部接入，提供了MCP和Skill。**

**Rolling Go Skill**是一套专为 AI 智能体（Agent）和客户端（如 Claude、Cursor 等）打造的全球酒旅服务技能工具包，主要包含**酒店搜索与预订**以及**全球机票查询**功能。

他们目前提供两个Skill（[https://www.rollinggo.store/solutions/skills](https://www.rollinggo.store/solutions/skills) ），一个是针对酒店的（[https://github.com/RollingGo-AI/rollinggo-hotel-skill-cn](https://github.com/RollingGo-AI/rollinggo-hotel-skill-cn) ），能实现查询和预定，一个是针对机票的，只提供查询。

这是我写这个文档的时候最新的skill的内容，和我当时用的时候下载的也不是同一份了，他自己也在更新。

但是内容大差不差，主要是包括了SKILL.md，安装和使用脚本，以及CLI的参数说明。

![image.png](assets/a5370ebfe66c.png)

这个skill适合直接在openclaw这样的agent中使用，但是针对我们的这种agent，其实他并不合适，所以后面我们需要对他做比较大的改造和支持。

rgh的鉴权方式

rgh的适配改造

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a6a0dd8c71a8900018a2c96
