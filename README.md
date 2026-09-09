# AI Engineering Interview Wiki

AI 工程师面试知识库。用 Markdown / MDX 维护面试题，做成可长期阅读的技术 Wiki。

这不是考试系统，没有答题、积分、登录或数据库。

## 技术栈

- Next.js
- React
- TypeScript
- [Fumadocs](https://github.com/fuma-nama/fumadocs)（MIT，作为依赖使用，不复制源码）
- MDX
- 内置 Orama 搜索

## 本地运行

```bash
pnpm install
pnpm dev
```

打开 `http://localhost:3000`。

生产构建：

```bash
pnpm build
pnpm start
```

## 部署

目标是 Cloudflare Pages。仓库里的 GitHub Actions 会在 push 时执行 `pnpm install` 和 `pnpm build`。

把仓库接到 Cloudflare Pages 后，构建命令用 `pnpm install && pnpm build`，Node 22。搜索接口依赖 Next.js route，不要只部署静态文件。

尚未绑定 Cloudflare 账号时，线上地址不会自动出现。

## 目录结构

```text
app/                  页面和搜索接口
components/           题目卡片、元信息、追问块
content/docs/         MDX 题目
lib/source.ts         内容源和 front matter
```

## 内容维护

在 `content/docs/<分类>/` 新增 `.mdx`，补齐 front matter：

- `title`
- `category`
- `tags`
- `difficulty`（1-5）
- `frequency`：`low` | `medium` | `high`
- `companies`
- `updated`

正文固定为：问题、30秒回答、深入理解、面试追问、真实面经、关联知识。

然后在对应目录的 `meta.json` 里登记文件名。

分类页是各目录的 `index.mdx`。首页读取带 `difficulty` 的题目，展示热门和最新。

## 未来扩展

题目、公司、面经、标签以后可以进数据库。现在不要加后台、登录或 AI 生成。
