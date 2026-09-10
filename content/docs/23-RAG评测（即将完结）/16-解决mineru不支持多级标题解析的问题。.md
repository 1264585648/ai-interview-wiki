---
title: "✅解决mineru不支持多级标题解析的问题。"
---

# ✅解决mineru不支持多级标题解析的问题。

因为我们之前讲过mineru他默认是不支持多级标题的，所以文档转换成markdown之后，就都会变成1级标题。

虽然官方给出过一个解决方案：[https://github.com/opendatalab/MinerU/discussions/3135](https://github.com/opendatalab/MinerU/discussions/3135)

但是我实测下来他效果并不好，因为他是通过模型来判断标题的字符大小来决定标题层级的，效果并不好。我实测之后他没有都识别成1级标题了，但是都给我识别成2级标题了。。。。

所以我们需要自己想办法解决。我们遇到过类似的情况，解决办法给大家分享下。

1、如果pdf中原来带目录的话，我们可以基于他的目录做解析

2、如果pdf中不带目录，但是带书签（有些文档把书签当目录用），那么我可就可以基于书签做解析。

比如我们示例中用的智界R7的用户手册，他就是后面这种，文档打开是这样的：

![](assets/c5ae72561ead.png)

可以看到他的书签就和他的标题几乎是对应的，并且也有层级结构。所以我们没有借助它来做。

首先，我们需要先导出一份书签，实测wps就可以，但是需要windows版才行，mac不支持。

（下图来自官方文档）

![](assets/64b82f32e456.png)

按照如图操作，导出标签。如下：

[【书签】r7-product-manual-20250123.xml](https://tcs-devops.aliyuncs.com/storage/103u5d6357841dd75c78209661b745e954ce?Signature=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJBcHBJRCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9hcHBJZCI6IjVlNzQ4MmQ2MjE1MjJiZDVjN2Y5YjMzNSIsIl9vcmdhbml6YXRpb25JZCI6IiIsImV4cCI6MTc4OTYwODU1OSwiaWF0IjoxNzg5MDAzNzU5LCJyZXNvdXJjZSI6Ii9zdG9yYWdlLzEwM3U1ZDYzNTc4NDFkZDc1Yzc4MjA5NjYxYjc0NWU5NTRjZSJ9.UzPeaM8t0ZyUusoO6uqEwnuKogFFAuogBKl9zathLp0&download=%E3%80%90%E4%B9%A6%E7%AD%BE%E3%80%91r7-product-manual-20250123.xml)

这里面有标题结构。

![](assets/b3de8b4ac4f8.png)

然后通过代码脚本，处理我们使用mineru基于pdf处理过的md文件：

````python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
基于 XML 书签定义的目录结构，处理 Markdown 文件中的一级标题：

规则：
1. 解析 XML 书签，建立"标题名 -> 标题等级（INDENT）"的映射；
2. 遍历 Markdown 文件中所有的一级标题（以 "# " 开头）：
   - 如果该标题在 XML 书签中出现：将 "# " 替换为对应等级数量的 "#"，
     例如 INDENT=2 → "## "，INDENT=3 → "### "；
   - 如果该标题在 XML 书签中不存在：去掉 "# " 前缀，使其变成普通段落文本；
3. 二级及以上的标题（## / ### 等）保持不变。
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from typing import Dict, List, Tuple


def build_title_level_map(xml_path: str) -> Dict[str, int]:
    """
    解析 XML 书签文件，返回 {标题名称: 标题等级} 的映射。

    若同一标题在书签中以不同 INDENT 多次出现，则选取出现次数最多的 INDENT；
    若并列，则取最小（即更靠近顶层）的等级。
    """
    tree = ET.parse(xml_path)
    root = tree.getroot()

    # 同名条目可能多次出现在书签里，先按名称收集所有的 INDENT 值
    name_indents: Dict[str, List[int]] = defaultdict(list)

    for item in root.iter("ITEM"):
        name = item.get("NAME")
        indent_str = item.get("INDENT")
        if name is None or indent_str is None:
            continue
        try:
            indent = int(indent_str)
        except ValueError:
            continue
        # 标题文本前后可能有空白，统一去掉
        name_indents[name.strip()].append(indent)

    title_level: Dict[str, int] = {}
    for name, indents in name_indents.items():
        counter = Counter(indents)
        # 出现次数最多 → 等级最小
        most_common_count = max(counter.values())
        candidates = [lvl for lvl, cnt in counter.items() if cnt == most_common_count]
        title_level[name] = min(candidates)

    return title_level


# 匹配一级标题：以 "# " 开头，且不是 "## "、"### " 等
H1_PATTERN = re.compile(r"^#\s+(.*\S)\s*$")


def process_markdown(
    md_path: str,
    title_level: Dict[str, int],
    output_path: str,
) -> Tuple[int, int, int]:
    """
    处理 Markdown 文件，按规则修改一级标题。

    返回 (一级标题总数, 命中目录被改写为对应等级的数量, 未命中被降级为正文的数量)。
    """
    with open(md_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    total_h1 = 0
    matched = 0
    demoted = 0

    new_lines: List[str] = []
    in_code_block = False
    code_fence_re = re.compile(r"^\s*(```|~~~)")

    for line in lines:
        # 跳过代码块内的 "# xxx"，避免误改
        if code_fence_re.match(line):
            in_code_block = not in_code_block
            new_lines.append(line)
            continue

        if in_code_block:
            new_lines.append(line)
            continue

        match = H1_PATTERN.match(line)
        if match:
            total_h1 += 1
            title = match.group(1).strip()
            if title in title_level:
                level = title_level[title]
                # 保证 level >= 1
                level = max(1, int(level))
                new_line = f"&#123;'#' * level&#125; &#123;title&#125;\n"
                new_lines.append(new_line)
                matched += 1
            else:
                # 不在目录里 → 转为普通段落文本
                new_lines.append(f"&#123;title&#125;\n")
                demoted += 1
        else:
            new_lines.append(line)

    with open(output_path, "w", encoding="utf-8") as f:
        f.writelines(new_lines)

    return total_h1, matched, demoted


def main() -> int:
    parser = argparse.ArgumentParser(
        description="根据 XML 书签调整 Markdown 中的一级标题等级"
    )
    default_dir = os.path.dirname(os.path.abspath(__file__))
    parser.add_argument(
        "--xml",
        default=os.path.join(default_dir, "【书签】r7-product-manual-20250123.xml"),
        help="XML 书签文件路径",
    )
    parser.add_argument(
        "--md",
        default=os.path.join(
            default_dir,
            "MinerU_markdown_r7-product-manual-20250123_2028781865782407168.md",
        ),
        help="待处理的 Markdown 文件路径",
    )
    parser.add_argument(
        "--out",
        default=None,
        help="输出文件路径，缺省时在原文件名后追加 .processed.md",
    )
    args = parser.parse_args()

    if not os.path.isfile(args.xml):
        print(f"[错误] XML 文件不存在: &#123;args.xml&#125;", file=sys.stderr)
        return 1
    if not os.path.isfile(args.md):
        print(f"[错误] Markdown 文件不存在: &#123;args.md&#125;", file=sys.stderr)
        return 1

    out_path = args.out
    if not out_path:
        base, ext = os.path.splitext(args.md)
        out_path = f"&#123;base&#125;.processed&#123;ext or '.md'&#125;"

    print(f"读取 XML 书签:  &#123;args.xml&#125;")
    title_level = build_title_level_map(args.xml)
    print(f"  -> 共解析 &#123;len(title_level)&#125; 个唯一标题")

    print(f"处理 Markdown: &#123;args.md&#125;")
    total_h1, matched, demoted = process_markdown(args.md, title_level, out_path)
    print(f"  -> 一级标题总数 : &#123;total_h1&#125;")
    print(f"  -> 命中目录改写 : &#123;matched&#125;")
    print(f"  -> 未命中被降级 : &#123;demoted&#125;")
    print(f"已写出结果: &#123;out_path&#125;")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
````

运行后，得到一个新的md文件，其中的标题就是有多级标题的了：

[https://nfturbo-file.oss-cn-hangzhou.aliyuncs.com/llm/MinerU_markdown_r7-product-manual-20250123_2028781865782407168.processed.md](https://nfturbo-file.oss-cn-hangzhou.aliyuncs.com/llm/MinerU_markdown_r7-product-manual-20250123_2028781865782407168.processed.md)

效果如下：

![](assets/26c457a80e14.png)

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a1a8d2874e4030001a6775c
