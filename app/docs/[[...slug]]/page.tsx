import { getPageImageUrl, getPageMarkdownUrl, getPageSafe, getQuestions, source } from "@/lib/source";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from "fumadocs-ui/layouts/docs/page";
import { notFound, redirect } from "next/navigation";
import { getMDXComponents } from "@/components/mdx";
import type { Metadata } from "next";
import { createRelativeLink } from "fumadocs-ui/mdx";
import { gitConfig } from "@/lib/shared";
import { QuestionMeta } from "@/components/QuestionMeta";
import Link from "next/link";

export default async function Page(props: PageProps<"/docs/[[...slug]]">) {
  const params = await props.params;
  const page = getPageSafe(params.slug);

  if (!page) {
    // If not found, check if this is /docs or a folder without an index.md
    const decodedSlugs = (params.slug || []).map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
    const prefix = decodedSlugs.join("/");
    const allPages = source.getPages();

    // Find the first document belonging to this directory (or first document in wiki if /docs)
    const childPage = allPages.find((p) => {
      const pSlug = p.slugs.join("/");
      return prefix ? pSlug.startsWith(`${prefix}/`) : true;
    });

    if (childPage) {
      redirect(childPage.url);
    }

    notFound();
  }

  const MDX = page.data.body;
  const markdownUrl = getPageMarkdownUrl(page).url;
  const related = getQuestions()
    .filter((item) => item.url !== page.url && item.data.category === page.data.category)
    .slice(0, 4);

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0">{page.data.description}</DocsDescription>
      <QuestionMeta
        category={page.data.category}
        tags={page.data.tags}
        difficulty={page.data.difficulty}
        frequency={page.data.frequency}
        companies={page.data.companies}
      />
      <div className="flex flex-row gap-2 items-center border-b border-fd-border pb-6">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover
          markdownUrl={markdownUrl}
          githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/content/docs/${page.path}`}
        />
      </div>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
      {related.length > 0 ? (
        <section className="mt-10 border-t border-fd-border pt-6">
          <h2 className="mb-3 text-lg font-semibold">相关问题</h2>
          <ul className="space-y-2 text-sm">
            {related.map((item) => (
              <li key={item.url}>
                <Link href={item.url} className="text-fd-foreground underline-offset-4 hover:underline">
                  {item.data.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </DocsPage>
  );
}

export const dynamicParams = true;

export async function generateStaticParams() {
  // Local/on-demand: avoid huge SSG; folder indexes + leaves render dynamically.
  return [];
}

export async function generateMetadata(props: PageProps<"/docs/[[...slug]]">): Promise<Metadata> {
  const params = await props.params;
  const page = getPageSafe(params.slug);
  if (!page) return {};

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      images: getPageImageUrl(page).url,
    },
  };
}
