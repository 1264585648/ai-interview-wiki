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

export async function getLLMText(page: WikiPage) {
  return `# ${page.data.title} (${page.url})

${page.data.description ?? ""}`;
}
