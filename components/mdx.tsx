import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { FollowUpBlock } from "./FollowUpBlock";

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    FollowUpBlock,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
