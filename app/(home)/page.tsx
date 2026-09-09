import Link from "next/link";
import { QuestionCard } from "@/components/QuestionCard";
import { categories } from "@/lib/question";
import { getQuestions } from "@/lib/source";

export default function HomePage() {
  const questions = getQuestions();
  const popular = questions.filter((page) => page.data.popular).slice(0, 6);
  const latest = questions.slice(0, 6);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-12 px-6 py-12">
      <section className="flex flex-col gap-4">
        <p className="text-sm text-fd-muted-foreground">AI Engineering Interview Wiki</p>
        <h1 className="text-4xl font-semibold tracking-tight">AI 工程师面试知识库</h1>
        <p className="max-w-2xl text-base leading-7 text-fd-muted-foreground">
          用 Markdown / MDX 持续维护面试题。这里只展示和整理内容，不做在线答题。
        </p>
        <div className="flex gap-3 text-sm">
          <Link href="/docs" className="rounded-md bg-fd-primary px-3 py-2 text-fd-primary-foreground">
            浏览目录
          </Link>
          <span className="self-center text-fd-muted-foreground">搜索 ⌘K / Ctrl K</span>
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">分类入口</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {categories.map((item) => (
            <Link
              key={item.slug}
              href={item.href}
              className="rounded-xl border border-fd-border px-4 py-5 text-sm font-medium hover:bg-fd-accent"
            >
              {item.title}
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">热门问题</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {popular.map((page) => (
            <QuestionCard
              key={page.url}
              href={page.url}
              title={page.data.title}
              description={page.data.description}
              category={page.data.category}
              tags={page.data.tags}
              difficulty={page.data.difficulty}
              frequency={page.data.frequency}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">最新更新</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {latest.map((page) => (
            <QuestionCard
              key={page.url}
              href={page.url}
              title={page.data.title}
              description={page.data.description}
              category={page.data.category}
              tags={page.data.tags}
              difficulty={page.data.difficulty}
              frequency={page.data.frequency}
            />
          ))}
        </div>
      </section>
    </main>
  );
}
