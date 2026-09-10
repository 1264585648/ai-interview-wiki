---
title: "✅重写 PPTX Skill"
---

# ✅重写 PPTX Skill

在之前的课程中，我们给 dodo-agent 实现了 Agent Skills 系统，并使用 Anthropic 官方的 pptx skill 来测试 skills 的效果。官方的 pptx skill 本质上是一份 python-pptx 库的使用指南，教 LLM 如何调用 python-pptx 的 API 来创建 PPT。所以它生成的是 PPT 能用，但视觉效果比较朴素，都是些很单一的元素，甚至在大部分模型下，生成的效果比较差劲。

那么，这节课我们在官方 pptx skill 基础上引入多样化的生成能力，创建两个增强版的 PPT Skill，分别是pillow-pptx（位图方案）和 svg-pptx（矢量图方案）。

为什么官方的不太好用

官方 pptx skill 的工作方式是：让 LLM 编写完整的 Python 脚本，通过 python-pptx 库的 API 来创建 PPT。脚本中调用 `add_textbox`、`add_chart`、`add_shape` 等方法，直接生成最终的 `.pptx` 文件。

这种方式的局限在于：python-pptx 能操作的视觉元素只有 Shape（矩形、圆形、线条等基础几何图形）和文本。想要做出更加丰富的视觉素材效果，光靠python-pptx 是做不到的，它没有较强的绘图能力。

那能不能让 LLM 生成图片素材，再通过 python-pptx 的 `add_picture()` 嵌入到 PPT 里？

这就是我们重写的核心思路，引入图片生成能力，让 LLM 为每个页面编写定制化的绘图代码，生成渐变背景、装饰元素、图标等素材，再组装到 PPT 中。生成图片素材有两种方式：**Pillow 位图**和 **SVG 矢量图**。我们分别创建了两个 Skill 来支持这两种方式。

这边说明一下：这块是我有这样的想法后，让claude code帮我基于官方的pptx重新生成的skills，只是把自己的想法和需求告诉他即可。当然你需要提前安装好`skill-creator`这个能创建skill的skill。

[skills/skills/skill-creator at main · anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/skill-creator)

SVG 与 Pillow

要让 LLM 生成图片素材，有两种常见方式。在深入两个 Skill 的实现之前，先来理解它们的本质区别。

SVG（可缩放矢量图形）

SVG 是一种基于 XML 的矢量图格式，用文本描述图形：

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
  <circle cx="100" cy="100" r="80" fill="#4A1D8E" opacity="0.5"/>
  <circle cx="100" cy="100" r="50" fill="#7C4DFF" opacity="0.8"/>
  <line x1="20" y1="100" x2="180" y2="100" stroke="#00D4FF" stroke-width="2"/>
</svg>
```

SVG 是一种**声明式**语言——你只需要描述"想要什么"，不需要描述"怎么画"。比如想要一个渐变背景，只需要声明一个 `<linearGradient>` 元素，渲染引擎会自动处理所有像素计算。

**优势**：

- 纯文本格式，LLM 天然擅长生成（写 XML 标签比写 Python 循环简单得多）
- 矢量图，无限放大不失真，适合投影和打印
- 文件体积极小（几 KB vs 位图的几百 KB）
- 声明式渐变/滤镜：一行声明搞定 Pillow 需要循环才能实现的效果
- 生成速度快：纯文本输出，无需逐像素计算

**缺陷**：

- python-pptx 没有 `add_svg()` 方法，SVG 必须先转成 PNG 才能嵌入 PPT
- SVG 转 PNG 依赖 cairo 渲染引擎，Windows 上需要额外安装 GTK3-Runtime
- 渲染效果依赖转换库（cairosvg）的质量

Pillow（Python 图像处理库）

Pillow 是 Python 最成熟的图像处理库，通过编写 Python 代码直接绘制像素：

```python
from PIL import Image, ImageDraw
img = Image.new('RGBA', (1920, 1080), (13, 13, 26, 255))
draw = ImageDraw.Draw(img)
# 画渐变、圆弧、光晕...
img.save('bg.png')
```

Pillow 是一种**命令式** API——你需要精确地告诉它每一步做什么，比如画渐变需要写循环逐行计算颜色值、画径向渐变需要逐像素计算距离和透明度等等。

**优势**：

- 生成的是标准 PNG 图片，PowerPoint 完美兼容
- `pip install Pillow` 一键安装，无任何系统依赖
- 可控性强，每个像素都可以精确控制

**缺陷**：

- 生成的是位图，放大后会模糊（但 1920x1080 的分辨率在 PPT 中已经足够清晰）
- 文件体积比 SVG 大一些
- LLM 编写 Pillow 绘图代码比较繁琐——画一个简单的三色渐变就需要写 for 循环逐行计算

两种方式的对比

| 维度 | Pillow（位图） | SVG（矢量） |
| --- | --- | --- |
| 输出格式 | 直接生成 PNG | SVG → PNG（需转换后嵌入 PPT） |
| 安装依赖 | `pip install Pillow`<br>，零额外依赖 | 需额外安装 GTK3-Runtime（提供 cairo 库） |
| 画质 | 1920x1080 固定分辨率，放大模糊 | 矢量图，无限放大不失真 |
| 文件体积 | 较大（几百 KB/张） | 极小（几 KB/张） |
| 生成速度 | 逐像素计算，较慢 | 纯文本输出，极快 |
| LLM 友好度 | 编写 Python 命令式代码，较繁琐 | 编写声明式 XML，更自然 |
| 渐变/滤镜 | 需要循环逐行计算 | 一行声明搞定 |
| 适用场景 | 通用场景，零配置优先 | 追求画质和生成效率 |

简单总结：**Pillow 安装简单、兼容性好，适合快速上手；SVG 画质更高、生成更快、LLM 写起来更轻松，但 Windows 上需要安装额外的依赖**。两者各有优势，所以两个都做了。

Pillow PPTX Skill

pillow-pptx 是在官方 pptx skill 基础上重写的增强版，核心改进是将视觉素材生成从"python-pptx 色块"升级为"Pillow 编程绘图"。

文件结构

```text
~/.claude/skills/pillow-pptx/
├── SKILL.md                    ← 技能主文件（提示词+工作流指引）
├── references/
│   └── pillow-patterns.md      ← Pillow 绘图模式库（代码模板）
└── scripts/
    ├── img_utils.py            ← 图片绘制工具函数
    └── pptx_helper.py          ← PPT 组装辅助函数
```

SKILL.md

技能主文件，定义了四阶段工作流：

1. **需求澄清**：询问主题、页数、风格等（用户已提供充分信息时可跳过）
2. **内容规划**：规划每页的内容结构，标注素材类型
3. **生成脚本**：生成一个完整的 Python 脚本，内含 Pillow 绘图代码 + PPT 组装代码
4. **执行脚本**：通过 Bash 工具执行脚本，生成 PPT 文件

SKILL.md 的关键设计是：**不提供预设的图片生成函数**。而是在提示词中给出 Pillow 绘图的代码模板（渐变背景、半透明叠加、几何图案、抽象图标等），让 AI 根据具体 PPT 主题**改编和组合**这些模板。这样每个 PPT 的视觉素材都是定制化的。

scripts/img_utils.py

图片绘制工具函数库，提供通用的辅助能力：

- `hex_to_rgb` / `hex_to_rgba`：十六进制颜色转换
- `lerp_color`：颜色线性插值（用于渐变）
- `draw_gradient`：多色渐变绘制（水平/垂直/对角线）
- `draw_radial_gradient`：径向渐变绘制
- `draw_particle_field`：随机粒子场绘制
- `save_image`：保存图片，自动处理 RGBA 模式

这些函数封装了 Pillow 的底层操作，让 AI 生成的脚本更简洁。比如一个三色渐变背景，用原始 Pillow API 需要写循环逐行绘制，用 `draw_gradient` 一行就够了。

scripts/pptx_helper.py

PPT 组装辅助函数库，提供 6 种页面类型的快速生成：

| 函数 | 用途 |
| --- | --- |
| `create_presentation` | 创建演示文稿，设置宽高比和元数据 |
| `add_rich_title_slide` | 封面页（背景图+装饰图+标题+副标题） |
| `add_icon_content_slide` | 图标内容页（图标+文字列表，最多4项） |
| `add_illustrated_slide` | 插图内容页（左文右图或右文左图） |
| `add_chart_slide` | 图表页（柱/线/饼） |
| `add_quote_slide` | 引用页（大字引言+作者） |
| `add_section_slide` | 章节分隔页 |
| `add_bullet_slide` | 要点列表页 |
| `add_end_slide` | 结尾页 |
| `save_presentation` | 保存文件，输出文件大小和页数 |

此外还内置了 6 套配色方案（商务蓝、科技紫、清新绿、简约灰、创意橙、暗色系），每套方案包含主色、辅色、强调色、背景色、文字色等 7 个色值，确保页面风格统一。

生成的 PPT 效果

![](assets/4ed4f97ad119.png)

SVG PPTX Skill

svg-pptx 是基于 SVG 矢量引擎的 PPT 生成技能，通过 AI 直接编写 SVG 代码生成矢量图片素材（背景、图标、插图、装饰），创建专业美观的 PPT。

前面提到，SVG 相比 Pillow 有画质更高、生成更快、LLM 更擅长等优势。但代价是 SVG 转 PNG 需要依赖 cairo 渲染引擎，Windows 上需要安装 GTK3-Runtime。所以使用 svg-pptx 之前，需要先把环境准备好。

环境准备：安装 GTK3-Runtime

SVG 转 PNG 使用的是 `cairosvg` 这个 Python 库，而 cairosvg 底层依赖 cairo 系统库。在 Linux/macOS 上，cairo 通常通过包管理器就能安装，但在 Windows 上需要手动安装 GTK3-Runtime。

下载安装

访问 GTK for Windows Runtime Environment Installer 的 GitHub Release 页面：

[https://github.com/tschoonj/GTK-for-Windows-Runtime-Environment-Installer/releases/tag/2022-01-04](https://github.com/tschoonj/GTK-for-Windows-Runtime-Environment-Installer/releases/tag/2022-01-04)

下载页面中有多个文件，选择 `gtk3-runtime-xxx-win64.exe` 这个安装程序（文件名中带 `win64`），运行安装即可。建议使用默认安装路径：

```text
C:\Program Files\GTK3-Runtime Win64\
```

安装时选择完整安装（Full Installation），确保包含所有组件。

验证安装

安装完成后，打开一个新的终端窗口（注意必须是新窗口，因为环境变量需要刷新），运行以下命令验证：

```bash
# 检查 cairo DLL 是否存在
dir "C:\Program Files\GTK3-Runtime Win64\bin\libcairo-2.dll"
```

如果输出中能看到文件信息（文件大小、修改日期等），说明 GTK 安装成功。

再验证 Python 依赖是否安装：

```bash
pip install cairosvg
```

如果已经安装过会提示 "Requirement already satisfied"。安装完成后，可以用一行命令快速验证 cairosvg 能否正常工作：

```bash
python -c "import cairosvg; print('cairosvg OK')"
```

或者 cmd 直接输入：`cairosvg --version`

![](assets/7e8c29384ae1.png)

如果输出 `cairosvg OK`，说明环境配置完成。如果报错 `no library called 'cairo-2'`，说明 Python 找不到 cairo DLL，请看下一节的环境变量配置。

环境变量配置

cairosvg 依赖的 `libcairo-2.dll` 位于 GTK3-Runtime 的 `bin` 目录下。Python 需要知道这个 DLL 的位置才能加载它。svg-pptx 的 `svg_utils.py` 中已经内置了自动检测逻辑，会在以下路径中搜索 `libcairo-2.dll`：

```python
if sys.platform == 'win32':
    _gtk_candidates = [
        r'C:\Program Files\GTK3-Runtime Win64\bin',
        r'C:\Program Files (x86)\GTK3-Runtime Win64\bin',
        r'C:\msys64\mingw64\bin',
        r'C:\GTK\bin',
    ]
    for _gtk in _gtk_candidates:
        if os.path.isfile(os.path.join(_gtk, 'libcairo-2.dll')):
            os.add_dll_directory(_gtk)
            os.environ['PATH'] = _gtk + os.pathsep + os.environ.get('PATH', '')
            break
```

这段代码做了两件事：

1. `os.add_dll_directory(_gtk)`：将 GTK 的 bin 目录注册到 Python 的 DLL 搜索路径中。这是 Python 3.8 新增的 API，专门用于解决 Windows 上 DLL 查找的问题
2. **更新 **`PATH`** 环境变量**：同时将 GTK 路径添加到当前进程的 PATH 中，确保子进程也能找到

所以正常情况下，只要 GTK 安装在默认路径，svg-pptx 就能自动找到 cairo DLL，不需要手动配置。

如果 GTK 安装在非默认路径，可以手动将 GTK 的 `bin` 目录添加到系统环境变量 `Path` 中：打开"系统属性" → "环境变量" → 编辑"系统变量"中的 `Path` → 添加 GTK 的 bin 路径。注意修改后需要重启终端才能生效。

SVG PPTX 的原理

理解了环境配置之后，来看看 svg-pptx 的完整工作原理。

```text
LLM 生成 Python 脚本
       ↓
svg_utils.py — 生成 SVG 素材 + 转换为 PNG
  ├─ make_dark_tech_bg()   一行生成科技风背景
  ├─ make_gradient_bg()    一行生成渐变背景
  ├─ svg_particles()       粒子星点
  ├─ svg_hex_grid()        六边形网格
  └─ svg_to_png()          SVG → PNG 转换
       ↓
pptx_helper.py — 组装 PPT
  ├─ add_rich_title_slide()   封面页
  ├─ add_bullet_slide()       要点页
  ├─ add_icon_content_slide() 图标内容页
  ├─ add_chart_slide()        图表页
  └─ save_presentation()      输出 .pptx 文件
```

整个过程分三个阶段：

**第一个阶段，生成 SVG 素材。** 这是 svg-pptx 和 pillow-pptx 最大的区别。Pillow 方案中，LLM 需要写 Python 循环来逐行计算渐变色值；而在 SVG 方案中，svg_utils.py 提供了快速生成函数，一行代码就能生成完整的背景。比如 `make_dark_tech_bg("bg.svg")` 会自动生成包含渐变底色、网格纹理、粒子星点和径向光晕的暗色科技风背景。LLM 也可以直接编写 SVG XML 来实现更定制化的效果。**第二个阶段，SVG 转 PNG。** 因为 python-pptx 没有原生 SVG 嵌入能力（没有 `add_svg()` 方法），所以必须先将 SVG 转换为 PNG 格式。这个转换由 cairosvg 完成，它基于 cairo 渲染引擎，转换质量很高。一张 1920x1080 的背景图转换大约需要 0.5-2 秒。**第三个阶段，PPT 组装。** 这部分和 pillow-pptx 完全一致——使用相同的 pptx_helper.py，调用各种页面函数组装 PPT，最终输出 `.pptx` 文件。

文件结构

```text
~/.claude/skills/svg-pptx/
├── skill.md                    ← 技能主文件（工作流 + 完整脚本模板 + 函数签名速查）
├── references/
│   └── svg-patterns.md         ← SVG 绘图模式库（代码模板）
└── scripts/
    ├── svg_utils.py            ← SVG 生成 + SVG→PNG 转换工具函数
    └── pptx_helper.py          ← PPT 组装辅助函数（与 pillow-pptx 相同 API）
```

核心组件

**scripts/svg_utils.py** 提供 SVG 生成和转换能力。它提供了两类函数：

- **快速生成器**：`make_dark_tech_bg(path)` 一行生成科技风背景、`make_gradient_bg(colors, path)` 一行生成渐变背景。这些函数封装了渐变、网格、粒子、光晕等组合效果，LLM 不需要从头拼接 SVG 元素
- **底层构建块**：`svg_linear_gradient`、`svg_particles`、`svg_hex_grid`、`svg_filter_blur` 等，LLM 也可以直接用这些函数组装更定制化的素材

此外还包含前面提到的 GTK 路径自动检测和 SVG→PNG 转换函数 `svg_to_png()`。详细的函数列表和代码模板可以参考 `references/svg-patterns.md`。

**scripts/pptx_helper.py** 与 pillow-pptx 版本完全相同，两个 Skill 共享同一套 PPT 组装逻辑，只是图片素材的生成方式不同。

**references/svg-patterns.md** 是 SVG 代码模板库，包括背景模式、图标模式、插图模式和装饰元素模式。AI 在生成脚本时会参考这些模板，根据 PPT 主题改编参数和组合效果。

来看一个直观的对比。用 Pillow 画一个科技风背景需要写几十行循环代码（渐变计算、粒子随机、光晕叠加...），而 svg-pptx 只需要一行：

```text
make_dark_tech_bg("bg_cover.svg")
```

这行代码会自动生成包含暗色渐变底色、网格纹理、粒子星点和径向光晕的完整背景。如果需要更简单的渐变背景：

```text
make_gradient_bg(["#0A0A1A", "#1A1035", "#0D1B2A"], "bg_content.svg")
```

这就是为什么 svg-pptx 的生成速度更快——LLM 输出的文本量更少，而且不需要逐像素计算。

生成的 PPT 效果

![](assets/2b2a19ef8570.png)

![](assets/380fdbbbd56d.png)

Skills 安装包

[📎svg-pptx.zip](https://www.yuque.com/attachments/yuque/0/2026/zip/38485174/1777997046687-f9a1c8a2-dee6-4c43-817a-5a0836bb0fb3.zip)

[svg-pptx.zip](https://tcs-devops.aliyuncs.com/storage/103w6e29bdcc2d38c5aed3c3e1fda357a0a2?Signature=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJBcHBJRCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9hcHBJZCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9vcmdhbml6YXRpb25JZCI6IiIsImV4cCI6MTc4OTYxMjE0MywiaWF0IjoxNzg5MDA3MzQzLCJyZXNvdXJjZSI6Ii9zdG9yYWdlLzEwM3c2ZTI5YmRjYzJkMzhjNWFlZDNjM2UxZmRhMzU3YTBhMiJ9.DEIVu_av7j6iSiHVB2pZSnEyIYhilVgSt01vID5vS9Y&download=svg-pptx.zip)

[📎pillow-pptx.zip](https://www.yuque.com/attachments/yuque/0/2026/zip/38485174/1777997046522-82453401-83fa-44dc-9390-be07d664dffd.zip)

[pillow-pptx.zip](https://tcs-devops.aliyuncs.com/storage/103wb0c0139293d0d85ea5e289634a347bf6?Signature=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJBcHBJRCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9hcHBJZCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9vcmdhbml6YXRpb25JZCI6IiIsImV4cCI6MTc4OTYxMjE0MywiaWF0IjoxNzg5MDA3MzQzLCJyZXNvdXJjZSI6Ii9zdG9yYWdlLzEwM3diMGMwMTM5MjkzZDBkODVlYTVlMjg5NjM0YTM0N2JmNiJ9.MoR-FmqaoMzys9mh4k67eYNoIQNw4-EKa2k7r8IA30Q&download=pillow-pptx.zip)

遗留问题：上下文膨胀

在测试 PPT Skill 的过程中，我们观察到一个明显的问题：Skills 驱动的复杂任务必定会触发多轮 React 循环——LLM 先加载技能、再分析需求、编写 Python 代码、写入文件、执行脚本，一个 PPT 往往需要很轮工具调用才能完成。而每一轮的 Tool Call 和 Tool Response 都会追加到上下文中，尤其是 PPTX 这种场景，LLM 需要生成大量 Python 代码，一轮 write_file 可能就塞进去几千 token 的内容。加上 Bash 执行后的输出、read_file 返回的文件内容，上下文很快就会膨胀到接近模型窗口上限。

上下文一旦膨胀，LLM 的注意力就会分散——它开始遗忘早期的指令，对 Skill 指引的遵循度下降，甚至丢失用户原始需求的细节，最终导致生成质量急剧下降。

所以在后续的课程中，我们会重点讲解**如何有效管理 Agent 的上下文窗口**，让 Agent 在多轮交互中始终保持高效和专注。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69faec6051b14400018e73b1
