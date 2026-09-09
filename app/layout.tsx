import { RootProvider } from "fumadocs-ui/provider/next";
import "./global.css";
import type { Metadata } from "next";
import { appNameZh } from "@/lib/shared";

export const metadata: Metadata = {
  title: {
    default: appNameZh,
    template: `%s · ${appNameZh}`,
  },
  description: "AI 工程师面试知识库。Markdown 维护的面试题展示站点。",
};

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col font-sans">
        <RootProvider
          search={{
            options: {
              api: "/api/search",
            },
          }}
        >
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
