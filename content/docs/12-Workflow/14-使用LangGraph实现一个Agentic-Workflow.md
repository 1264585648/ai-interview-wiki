---
title: "✅使用LangGraph实现一个Agentic Workflow"
---

# ✅使用LangGraph实现一个Agentic Workflow

我们使用LangGraph实现一个多角色协作的“研究助手”系统，当用户问一个问题（如“AI 对医疗行业有哪些影响？”），系统自动：

1. Planner Agent：制定研究计划（分几步查什么）
2. Researcher Agent：按计划搜索信息（模拟调用搜索引擎）
3. Writer Agent：整合信息写报告
4. Reviewer Agent：检查报告质量，若不满意则要求重写（形成反思循环）

使用langgraph来实现，初始化环境：

```text
uv init agentic_workflow_test
cd agentic_workflow_test
uv venv
source .venv/bin/activate
```

编写main.py中的代码：

```text
import os
from typing import Annotated, Literal, TypedDict, List
from langgraph.graph import StateGraph, START, END
from langchain_openai import ChatOpenAI

# === 配置 ===
OPENAI_API_KEY = "你的 api key"
OPENAI_API_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1"

llm = ChatOpenAI(
    model="deepseek-v3",
    api_key=OPENAI_API_KEY,
    base_url=OPENAI_API_BASE,
    temperature=0.1,
)

# ================================
# 1. 定义全局状态
# ================================
class ResearchState(TypedDict):
    question: str
    plan: List[str]
    research_notes: str
    draft: str
    feedback: str
    approved: bool
    revision_count: int

# ================================
# 2. 增强版 Agent（带详细日志）
# ================================

def planner_agent(state: ResearchState):
    print("\n" + "="*50)
    print("🧠 [Planner] 接收到任务")
    print(f"  用户问题: {state['question']}")
    
    prompt = f"""
    用户问题：{state['question']}
    请制定一个清晰的研究计划，分3-5个具体步骤，每步说明要查什么。
    只输出步骤列表，不要解释。
    """
    response = llm.invoke(prompt)
    plan_steps = [step.strip() for step in response.content.split("\n") if step.strip()]
    
    print("✅ [Planner] 输出研究计划:")
    for i, step in enumerate(plan_steps, 1):
        print(f"   {i}. {step}")
    return {"plan": plan_steps}


def researcher_agent(state: ResearchState):
    print("\n" + "="*50)
    print("🔍 [Researcher] 开始执行研究")
    print("  研究计划:")
    for i, step in enumerate(state["plan"], 1):
        print(f"   {i}. {step}")
    
    plan_text = "\n".join(f"{i+1}. {step}" for i, step in enumerate(state["plan"]))
    prompt = f"""
    根据以下研究计划，模拟搜索并总结关键信息：
    {plan_text}
    请输出简洁的研究笔记（300字以内）。
    """
    response = llm.invoke(prompt)
    
    print("✅ [Researcher] 输出研究笔记:")
    print(f"   {response.content.strip()}")
    return {"research_notes": response.content}

def writer_agent(state: ResearchState):
    print("\n" + "="*50)
    print("✍️ [Writer] 开始撰写报告")
    print(f"  基于问题: {state['question']}")
    print(f"  研究笔记预览: {state['research_notes'][:100]}{'...' if len(state['research_notes']) > 100 else ''}")
    
    # 构造基础 prompt
    prompt = f"""
    基于以下研究笔记，为问题“{state['question']}”写一份专业、简洁的回答（200字左右）：
    {state['research_notes']}
    """
    
    # 如果存在反馈，则加入修改指令
    if state.get("feedback"):
        print(f"  📝 评审反馈: {state['feedback']}")
        prompt += f"\n\n请根据以下评审意见进行修改：\n{state['feedback']}\n确保回答准确、简洁、有洞察力。"

    response = llm.invoke(prompt)
    
    print("✅ [Writer] 输出草稿:")
    print(f"   {response.content.strip()}")
    return {"draft": response.content}

def reviewer_agent(state: ResearchState):
    print("\n" + "="*50)
    print("👀 [Reviewer] 评审当前草稿")
    print(f"  草稿内容: {state['draft']}")
    
    prompt = f"""
    评审以下回答是否满足：准确、简洁、有洞察力。
    如果满意，只回复“APPROVED”。
    如果不满意，请给出具体修改建议（50字以内）：
    
    回答：{state['draft']}
    """
    response = llm.invoke(prompt)
    review_text = response.content.strip()
    
    print("✅ [Reviewer] 评审结果:")
    if "APPROVED" in review_text.upper():
        print("   👍 批准通过！")
        return {"approved": True, "feedback": ""}
    else:
        print(f"   ❌ 需要修改: {review_text}")
        return {
            "approved": False,
            "feedback": review_text,
            "revision_count": state["revision_count"] + 1
        }


# ================================
# 3. 增强版路由逻辑
# ================================
def route_after_review(state: ResearchState) -> Literal["writer", "end"]:
    print("\n" + "-"*40)
    print("🚦 [Router] 决策中...")
    print(f"  当前修订次数: {state['revision_count']}")
    print(f"  是否批准: {state['approved']}")
    
    if state["approved"]:
        print("  → 决定: 流程结束（已批准）")
        return "end"
    elif state["revision_count"] >= 2:
        print("  → 决定: 流程结束（已达最大修订次数）")
        return "end"
    else:
        print(f"  → 决定: 返回 Writer 进行第 {state['revision_count'] + 1} 次修改")
        return "writer"


# ================================
# 4. 构建工作流（保持不变）
# ================================
workflow = StateGraph(ResearchState)
workflow.add_node("planner", planner_agent)
workflow.add_node("researcher", researcher_agent)
workflow.add_node("writer", writer_agent)
workflow.add_node("reviewer", reviewer_agent)

workflow.add_edge(START, "planner")
workflow.add_edge("planner", "researcher")
workflow.add_edge("researcher", "writer")
workflow.add_edge("writer", "reviewer")

workflow.add_conditional_edges(
    "reviewer",
    route_after_review,
    {"writer": "writer", "end": END}
)

app = workflow.compile()

# ================================
# 5. 运行示例
# ================================
if __name__ == "__main__":
    user_question = "AI 对医疗行业有哪些影响？"
    
    print("🚀 启动 Agentic Research Workflow")
    print(f"📌 用户问题: {user_question}\n")

    result = app.invoke({
        "question": user_question,
        "plan": [],
        "research_notes": "",
        "draft": "",
        "feedback": "",
        "approved": False,
        "revision_count": 0
    })
    
    print("\n" + "="*60)
    print("✅ 最终报告：")
    print(result["draft"])
    
    print(f"\n📊 执行统计:")
    print(f"  - 总修订次数: {result['revision_count']}")
    print(f"  - 是否最终批准: {'是' if result['approved'] else '否（达到最大修订次数）'}")
```

添加依赖：uv add langgraph langchain-openai

运行代码：uv run main.py

最终输出结果如下：

```text
🚀 启动 Agentic Research Workflow
📌 用户问题: AI 对医疗行业有哪些影响？


==================================================
🧠 [Planner] 接收到任务
  用户问题: AI 对医疗行业有哪些影响？
✅ [Planner] 输出研究计划:
   1. 1. 调查AI在医疗诊断中的应用，包括影像识别、病理分析和早期疾病预测。
   2. 2. 研究AI在医疗管理中的作用，如电子病历处理、医院资源优化和患者流程自动化。
   3. 3. 分析AI在药物研发中的贡献，包括靶点发现、临床试验设计和个性化药物方案。
   4. 4. 评估AI对医患互动的影响，如虚拟助手、远程医疗和健康监测设备。
   5. 5. 探讨AI在医疗行业中的伦理与法律问题，包括数据隐私、算法偏见和监管框架。

==================================================
🔍 [Researcher] 开始执行研究
  研究计划:
   1. 1. 调查AI在医疗诊断中的应用，包括影像识别、病理分析和早期疾病预测。
   2. 2. 研究AI在医疗管理中的作用，如电子病历处理、医院资源优化和患者流程自动化。
   3. 3. 分析AI在药物研发中的贡献，包括靶点发现、临床试验设计和个性化药物方案。
   4. 4. 评估AI对医患互动的影响，如虚拟助手、远程医疗和健康监测设备。
   5. 5. 探讨AI在医疗行业中的伦理与法律问题，包括数据隐私、算法偏见和监管框架。
✅ [Researcher] 输出研究笔记:
   **AI在医疗领域的研究笔记**

1. **医疗诊断**：AI在影像识别（如X光、MRI）中准确率接近专家水平，病理分析可辅助癌症检测，早期预测模型（如糖尿病、阿尔茨海默病）提升干预效率。

2. **医疗管理**：AI优化电子病历结构化与检索，通过预测患者流量改善资源分配，自动化流程（如分诊）缩短等待时间。

3. **药物研发**：加速靶点筛选（如AlphaFold预测蛋白质结构），优化临床试验设计（患者匹配），推动个性化药物（基于基因组数据）。

4. **医患互动**：虚拟助手（如ChatGPT）解答基础咨询，远程医疗平台扩大覆盖，可穿戴设备实时监测慢性病。

5. **伦理与法律**：数据隐私（匿名化处理）、算法偏见（数据多样性不足）、监管滞后（需跨学科协作制定标准）是主要挑战。

**总结**：AI显著提升医疗效率与精准度，但需平衡创新与伦理风险，完善法规以实现可持续发展。 （298字）

==================================================
✍️ [Writer] 开始撰写报告
  基于问题: AI 对医疗行业有哪些影响？
  研究笔记预览: **AI在医疗领域的研究笔记**

1. **医疗诊断**：AI在影像识别（如X光、MRI）中准确率接近专家水平，病理分析可辅助癌症检测，早期预测模型（如糖尿病、阿尔茨海默病）提升干预效率。
...
✅ [Writer] 输出草稿:
   **AI对医疗行业的影响**

AI正在深刻变革医疗行业。在**诊断领域**，AI影像识别（如X光、MRI）准确率媲美专家，病理分析助力癌症早期筛查，预测模型提升慢性病干预效率。**医疗管理**方面，AI优化电子病历处理、预测患者流量以合理分配资源，自动化分诊缩短等待时间。**药物研发**中，AI加速靶点筛选（如AlphaFold）、优化临床试验，推动个性化药物开发。**医患互动**通过虚拟助手、远程医疗和可穿戴设备，提升服务可及性与实时监测能力。

然而，AI应用面临**数据隐私**、**算法偏见**和**监管滞后**等挑战，需通过跨学科协作完善伦理与法律框架。总体而言，AI显著提升医疗效率与精准度，但需平衡创新与风险，以实现可持续发展。 （199字）

==================================================
👀 [Reviewer] 评审当前草稿
  草稿内容: **AI对医疗行业的影响**

AI正在深刻变革医疗行业。在**诊断领域**，AI影像识别（如X光、MRI）准确率媲美专家，病理分析助力癌症早期筛查，预测模型提升慢性病干预效率。**医疗管理**方面，AI优化电子病历处理、预测患者流量以合理分配资源，自动化分诊缩短等待时间。**药物研发**中，AI加速靶点筛选（如AlphaFold）、优化临床试验，推动个性化药物开发。**医患互动**通过虚拟助手、远程医疗和可穿戴设备，提升服务可及性与实时监测能力。

然而，AI应用面临**数据隐私**、**算法偏见**和**监管滞后**等挑战，需通过跨学科协作完善伦理与法律框架。总体而言，AI显著提升医疗效率与精准度，但需平衡创新与风险，以实现可持续发展。 （199字）
✅ [Reviewer] 评审结果:
   👍 批准通过！

----------------------------------------
🚦 [Router] 决策中...
  当前修订次数: 0
  是否批准: True
  → 决定: 流程结束（已批准）

============================================================
✅ 最终报告：
**AI对医疗行业的影响**

AI正在深刻变革医疗行业。在**诊断领域**，AI影像识别（如X光、MRI）准确率媲美专家，病理分析助力癌症早期筛查，预测模型提升慢性病干预效率。**医疗管理**方面，AI优化电子病历处理、预测患者流量以合理分配资源，自动化分诊缩短等待时间。**药物研发**中，AI加速靶点筛选（如AlphaFold）、优化临床试验，推动个性化药物开发。**医患互动**通过虚拟助手、远程医疗和可穿戴设备，提升服务可及性与实时监测能力。

然而，AI应用面临**数据隐私**、**算法偏见**和**监管滞后**等挑战，需通过跨学科协作完善伦理与法律框架。总体而言，AI显著提升医疗效率与精准度，但需平衡创新与风险，以实现可持续发展。 （199字）

📊 执行统计:
  - 总修订次数: 0
  - 是否最终批准: 是
```

以上的示例中，这个工作流具备了**目标驱动、自主决策、多智能体协作、自我反思与迭代**等特点。

**目标驱动**

整个工作流围绕一个明确的用户问题 `question` 展开，所有 Agent 的行为都服务于回答该问题。

- 入口状态包含 `"question": "AI 对医疗行业有哪些影响？"`
- 所有 Agent 的行为都服务于回答这个问题：
- Planner 制定**针对该问题**的研究计划
- Researcher 搜集**与该问题相关**的信息
- Writer 撰写**对该问题的回答**
- Reviewer 评估回答是否**准确、简洁、有洞察力**（即是否达成“高质量回答”这一子目标）

系统不是随机生成内容，而是以“高质量回答用户问题”为终极目标，所有步骤都是为目标服务的——典型的**目标驱动架构**。

**自主决策**

每个 Agent 基于当前状态独立生成输出，Reviewer 能动态决定流程走向。

- 每个节点函数（如 `planner_agent`）**不依赖外部指令**，而是：
- 读取共享状态（如 `state['question']`）
- 调用 LLM 自主生成下一步内容（如 plan、notes、draft）
- 最关键的是 `reviewer_agent` 和 `route_after_review`：
- Reviewer **自主判断**草稿是否合格（通过 LLM 评审）
- 路由函数根据 `approved` 和 `revision_count`**自主决定**是结束还是返回修改

没有中央控制器硬编码“第几步该做什么”，而是每个 Agent 根据上下文**自主推理并行动**，符合“自主决策”原则。

**多智能体协作**

✅ **体现方式**：四个角色分工明确，通过共享状态接力协作。

| 智能体 | 职责 | 依赖输入 | 输出贡献 |
| --- | --- | --- | --- |
| Planner | 制定研究路径 | 用户问题 | `plan` |
| Researcher | 信息搜集 | `plan` | `research_notes` |
| Writer | 内容生成 | `research_notes` | `draft` |
| Reviewer | 质量把关 | `draft` | `approved`<br>/<br>`feedback` |

- 它们**不直接调用彼此**，而是通过读写 `ResearchState` 进行**松耦合协作**
- 流程图构成一个**协作流水线 + 反馈环**，体现“团队合作”模式

不是单个大模型端到端生成，而是多个专业化“角色”像团队一样协同完成复杂任务——这是多智能体系统的核心思想。

**自我反思与迭代**

系统具备“写 → 评 → 改”的反馈循环，实现自我优化。

- Reviewer 不仅判断好坏，还提供**具体修改建议**（如“请补充临床应用案例”）；
- Writer 在下一轮会**结合反馈重写**（prompt 中显式加入 `feedback`）；
- 虽然最多允许 2 次修订，体现**有限但有效的自我修正能力**。（也可以设置更多得次数）

系统能识别自身输出的不足，并主动改进——这是“反思”的本质。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69882f6951b1440001341fb3
