---
title: "✅Skill的渐进式披露"
---

# ✅Skill的渐进式披露

前面说skill是可以帮我们减少上下文消耗的，但是没讲为什么。这一期讲讲skill的渐进式披露。前面我们介绍过了skill的结构。

把 SKILL.md、Reference、Script 放在一起看，其实它们就共同构成了Agent Skills的核心：**渐进式披露机制**。

所谓渐进式披露，顾名思义，就是不一次性把 Skill 的全部信息塞进上下文，而是根据 Agent 所处的阶段，**按需、分层地加载信息**。

在 Agent Skills 中，这种披露是严格分阶段发生的：

1. **技能发现阶段（L1）**客户端只扫描 Skill 目录，并且只读取 SKILL.md 中由 `---` 包裹的元数据。Agent 在这个阶段只关心一件事：**这个 Skill 是做什么的，当前任务要不要用它**。而 Instruction、Reference、Script 在这个阶段都不会被加载。
2. **执行决策阶段（L2）**当 Agent 基于元数据判断需要使用该 Skill 后，才会加载 SKILL.md 中的 Instruction。此时 Agent 才开始理解：**这个 Skill 具体该怎么用，执行流程是什么，哪些地方需要额外注意。**
3. **细节补充阶段（L3）**Reference 不会自动进入上下文。只有当 Instruction 中明确指示，或执行过程中确实需要查阅某些细节时，Agent 才会按文件粒度读取对应的 Reference 内容。这一步的目的就是**补充当前步骤所必需的最小信息集**。
4. **确定性执行阶段（L4）**当流程中出现不适合交给模型自由生成的部分，Agent 会按 Instruction 的约定调用 Script。Script 负责用稳定、可控的代码完成具体操作，并只把结果返回给 Agent。大模型既不需要理解实现细节，也不会被大量原始内容干扰。只是调用，获取结果即可。

| **层级** | **组件名称** | **内容类型** | **加载策略** | **Token 消耗权重** | **设计目的** |
| --- | --- | --- | --- | --- | --- |
| L1 | Metadata | Skill 名称、描述、版本号 | Always-On (常驻) | 极低 (&lt;1%) | 供模型进行路由决策与意图识别 |
| L2 | Instruction | SKILL.md 正文规则 | On-Demand (命中后加载) | 中等 (5-10%) | 定义具体的业务处理逻辑与SOP |
| L3 | Reference | 外部文档、手册、规范 | Context-Triggered (条件触发) | 高 (可变) | 提供必要的领域知识，用完即弃 |
| L4 | Script | Python/Shell 脚本 | Execution-Only (仅执行) | 零 (不读取代码) | 实现物理世界的副作用 (Side Effects) |

正是这种分层、延迟、按需加载的设计，使 Agent Skills 能够在保证执行稳定性的同时，显著降低上下文 token 的消耗。这也是 Agent Skills 演进为真正工程化能力模块的关键所在。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69ac074151b1440001491601
