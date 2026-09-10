---
title: "✅Dify进阶：插件开发"
---

# ✅Dify进阶：插件开发

Dify提供了插件机制，我们可以基于dify的插件能力开发出我们自己的插件，来丰富工作流的功能。本文演示一个脱敏插件的开发全流程。

使用cursor进行插件开发，在dify官网中给出了dify插件开发的prompt：

https://docs.dify.ai/plugin-dev-zh/0211-getting-started-by-prompt

我们可以把这个当做rules设置个cursor，然后借助cursor帮我们开发一个dify的插件。

开发环境安装

开发 Dify 插件需要进行以下准备。本文档是开始插件开发的第一步。

- Dify 插件 CLI 工具
- Python 环境，版本号 ≥ 3.12

Dify 插件 CLI 工具可以通过 Homebrew（在 Linux 和 macOS 上）或独立的二进制可执行文件（在 Windows、Linux 和 macOS 上）进行安装。（其他安装方式：https://docs.dify.ai/plugin-dev-zh/0221-initialize-development-tools ）

```text
brew tap langgenius/dify
brew install dify
```

![](assets/82836db1ef0c.png)

要检查安装是否成功，请运行 `dify version`，应该会显示版本代码。

```text
dify version
```

![](assets/3da960b897bb.png)

Prompt导入

Cursor Settings -> “Rules & Memories”添加新的 rule：

![](assets/26bd95ad9be0.png)

然后把dify的prompt复制进来。

![](assets/c3a339abefd1.png)

创建好之后，在当前项目中就有这样一个rule文件了，在.cursor/rules目录下

![](assets/41fd0d77981d.png)

需求文档生成

接着我们需要一份需求文档，当然也要借助AI来写了。

以下是我让千问帮我生成需求文档的提示词，

![](assets/02ddce2d516a.png)

然后把对应的提示词，复制给cursor，让他帮我生成代码。

```text
我要开发一个dify插件，以下是我的需求文档。

以下是一份面向开发团队和产品负责人的 Dify 脱敏插件需求文档（PRD），内容涵盖背景、目标、功能需求、非功能需求、接口设计、安全合规等关键要素，适用于金融、医疗、政务等强监管场景。

Dify 敏感数据脱敏插件需求文档（PRD）


1. 背景与问题描述

在企业级 AI 应用中，Dify 常被用于构建智能客服、内部知识助手、业务查询机器人等场景。这些应用通常需要调用外部系统（如 CRM、ERP、数据库 API）获取用户数据，并将结果交由大语言模型（LLM）生成自然语言回答。

然而，外部系统返回的数据常包含个人敏感信息（PII），例如：
身份证号
手机号
银行卡号
家庭住址
医疗记录编号

根据《中华人民共和国个人信息保护法》《GDPR》《金融行业数据安全规范》等法规，原始敏感数据不得未经处理直接传入 LLM，否则将导致：
数据泄露风险
合规审计失败
法律责任与声誉损失

当前 Dify 平台缺乏在“工具调用 → LLM 输入”之间对结构化数据进行自动脱敏的能力，必须通过插件扩展实现该关键安全控制点。

2. 目标

开发一个 通用、可配置、高性能的敏感数据脱敏插件，集成到 Dify 工作流中，实现以下目标：
✅ 在 LLM 接收外部工具返回数据前，自动识别并脱敏敏感字段；
✅ 支持主流敏感字段类型（身份证、手机号、银行卡等）；
✅ 保证脱敏过程不破坏原始数据结构，确保 LLM 能正常理解上下文；
✅ 满足金融、医疗等行业合规要求；
✅ 插件可复用、可配置、低侵入，适用于多租户 SaaS 环境。

3. 功能需求
3.1 核心功能

功能 描述
------ ------
自动字段识别 根据预定义字段名关键词（如 phone, id_card）匹配敏感字段
结构化数据脱敏 支持对 JSON 对象、普通字符串、数组递归遍历并脱敏
多种脱敏策略 支持掩码（masking）方式，保留部分可见字符（如 138*5678）
输入输出透明 输入为包含敏感信息字符串，输出为脱敏后的字符串，结构不变
3.2 支持的敏感字段类型（初始版本）

字段类型 示例原始值 脱敏后示例 匹配字段名关键词（不区分大小写）
-------- ---------- ---------- ---------------------------
手机号 13812345678 1385678 phone, mobile, telephone
身份证号 110101199003072316 110101**2316 id_card, identity_card, citizen_id
银行卡号 6222081234567890123 6222******0123 bank_card, card_number, account_no
姓名（可选） 张三 张 或 name, full_name（默认关闭）
注：姓名脱敏默认不启用，因可能影响语义理解，需通过配置开关控制。
3.3 配置能力（未来扩展）
支持通过插件参数动态开启/关闭某类脱敏；
支持自定义正则表达式匹配字段值（如识别未命名但含身份证格式的字段）；
支持租户级脱敏策略配置（高级功能，v2.0 考虑）。

4. 非功能需求

类别 要求
------ ------
性能 单次脱敏处理延迟 ≤ 50ms（95% 分位），支持并发 ≥ 100 QPS
可靠性 脱敏失败时应 fallback 到返回原始数据（或可配置为报错），不得中断工作流
安全性 插件本身不得记录、缓存、传输原始敏感数据；所有处理在内存中完成
兼容性 输入必须为字符串；非法输入应原样返回并记录警告日志
可观测性 提供基础日志（如脱敏字段数量、异常次数），便于监控

5. 插件接口设计（Dify 兼容）
5.1 插件元信息（YAML 示例）

yaml
name: sensitive_data_masker
description: 自动脱敏外部工具返回中的敏感个人信息（手机号、身份证、银行卡等）
version: 1.0.0
type: function
input_params:
name: input_string
type: string
required: true
description: 上游工具返回的原始字符串
output:
type: string
description: 脱敏后的字符串，结构与输入一致
5.2 函数签名（Python 示例）

python
def main(input_string: str) -> str:
"""
输入：字符串（如 '{"user": {"phone": "13812345678", "id_card": "110101199003072316"}}'）
输出：脱敏后 字符串（如 '{"user": {"phone": "1385678", "id_card": "110101***2316"}}'）
"""

6. 使用场景示例

场景：客户询问“我的账户绑定手机号是多少？”

1. Dify 调用内部用户查询 API，返回：
json
{"phone": "13812345678", "id_card": "110101199003072316"}

2. 工作流自动调用 sensitive_data_masker 插件；
3. 插件返回：
json
{"phone": "1385678", "id_card": "110101**2316"}

4. LLM 基于脱敏数据生成回答：“您绑定的手机号是 1385678。”

✅ 整个过程无原始敏感数据进入 LLM，满足合规要求。
```

代码生成

接着他就开始工作了：

![](assets/c3899e32e373.png)

可以对比下cursor帮我生成的代码结构和官网中规定的结构：

![](assets/2f3d45e9f80d.png)

![](assets/a39fb11061d1.png)

调试插件

插件开发完成后，接下来需要测试插件是否可以正常运行。Dify 提供便捷地远程调试方式，帮助你快速在测试环境中验证插件功能。前往”插件管理”页获取远程服务器地址和调试 Key。

![](assets/9ff2251f10c2.png)

回到插件项目，拷贝 `.env.example` 文件并重命名为 `.env`（如果没有`.env.example`就直接创建.env创建），将获取的远程服务器地址和调试 Key 等信息填入其中。`.env` 文件：

Copy

```text
INSTALL_METHOD=remote
REMOTE_INSTALL_URL=debug.dify.ai:5003
REMOTE_INSTALL_KEY=********-****-****-****-************
```

![](assets/7c85c0d144fb.png)

运行 `python -m main` 命令启动插件。在插件页即可看到该插件已被安装至 Workspace 内。

![](assets/d0959e7314c2.png)

打包插件

代码开发完成之后，试着打包一下，进入到插件开发目录的上一级，执行打包工具：

```text
dify plugin package ./sensitive_data_masker
```

sensitive_data_masker是我的插件名称

![](assets/bae1b6e9289a.png)

运行后会生成一个difypkg文件。

安装插件

访问 Dify 插件管理页，轻点右上角的**安装插件** → **通过本地文件**安装

![](assets/309318368223.png)

选择我们打包好的插件文件后，可以进行安装了。

![](assets/b0015fee4bff.png)

等待一段时间后，插件安装成功：

![](assets/88d9229e6712.png)

插件使用

使用插件放在工作流中，配置好前后节点和需要的参数字段。

![](assets/9c07b7b9b82b.png)

效果如下：

![](assets/83e802585bd3.png)

常见问题

1、调试过程中，控制台报错。后来发现并不影响使用，可以忽略。

![](assets/81b2291af5d1.png)

其他代码问题，直接用cursor对话解决即可。

插件完整源码

本代码如果要调试，直接运行sh start_server.sh 即可。

[sensitive_data_masker.zip](https://tcs-devops.aliyuncs.com/storage/133rb2927b1b964d70412b947affa4968efa?Signature=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJBcHBJRCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9hcHBJZCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9vcmdhbml6YXRpb25JZCI6IiIsImV4cCI6MTc4OTYxMTY3MiwiaWF0IjoxNzg5MDA2ODcyLCJyZXNvdXJjZSI6Ii9zdG9yYWdlLzEzM3JiMjkyN2IxYjk2NGQ3MDQxMmI5NDdhZmZhNDk2OGVmYSJ9.KsD29YSjstuaIVTMdJt9QtUfqAHyeduqTltW1ojMeYI&download=sensitive_data_masker.zip)

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69882e73a7c8ff00015624d4
