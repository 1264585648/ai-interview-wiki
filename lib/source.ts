import { loader } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/lucide-icons";
import { docsContentRoute, docsImageRoute, docsRoute } from "./shared";
import { defineDocs } from "fumadocs-mdx/macro";
import { metaSchema } from "fumadocs-core/source/schema";
import { questionSchema } from "./question";

import { applyMdxPreset } from "fumadocs-mdx/config";

const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: questionSchema,
    mdxOptions: applyMdxPreset({
      remarkImageOptions: false,
    }),
  },
  meta: {
    schema: metaSchema,
  },
});

export const source = loader({
  baseUrl: docsRoute,
  source: docs.toFumadocsSource(),
  plugins: [lucideIconsPlugin()],
});

export type WikiPage = ReturnType<typeof source.getPages>[number];

export function isQuestion(page: WikiPage) {
  return typeof page.data.difficulty === "number";
}

export function getQuestions() {
  return source
    .getPages()
    .filter(isQuestion)
    .sort((a, b) => String(b.data.updated ?? "").localeCompare(String(a.data.updated ?? "")));
}

export function getPageImageUrl(page: WikiPage) {
  const segments = [...page.slugs, "image.png"];

  return {
    segments,
    url: "/" + [page.locale, ...docsImageRoute.split("/"), ...segments].filter(Boolean).join("/"),
  };
}

export function getPageMarkdownUrl(page: WikiPage) {
  const segments = [...page.slugs, "content.md"];

  return {
    segments,
    url: "/" + [page.locale, ...docsContentRoute.split("/"), ...segments].filter(Boolean).join("/"),
  };
}

export function getPageSafe(slugs?: string[]) {
  if (!slugs || slugs.length === 0) {
    return null;
  }

  // 1. Direct match with raw slugs
  let page = source.getPage(slugs);
  if (page) return page;

  // 2. Decode each segment with decodeURIComponent (handles %26 for &, full-width Chinese, etc.)
  try {
    const decoded = slugs.map((s) => decodeURIComponent(s));
    page = source.getPage(decoded);
    if (page) return page;
  } catch {}

  // 3. Decode with decodeURI
  try {
    const decoded = slugs.map((s) => decodeURI(s));
    page = source.getPage(decoded);
    if (page) return page;
  } catch {}

  // 4. Normalized path match
  const target = slugs
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    })
    .join("/");

  const allPages = source.getPages();
  const matched = allPages.find(
    (p) => p.slugs.join("/") === target || p.slugs.join("/").toLowerCase() === target.toLowerCase(),
  );
  if (matched) return matched;

  // 5. If slug is a single file name (e.g. from relative link resolving without trailing slash), match last segment
  if (slugs.length === 1) {
    const single = target.toLowerCase();
    const byLast = allPages.find((p) => p.slugs[p.slugs.length - 1].toLowerCase() === single);
    if (byLast) return byLast;
  }

  return null;
}

export async function getLLMText(page: WikiPage) {
  return `# ${page.data.title} (${page.url})

${page.data.description ?? ""}`;
}
