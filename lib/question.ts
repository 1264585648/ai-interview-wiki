import { pageSchema } from "fumadocs-core/source/schema";
import { z } from "zod";

export const frequencyValues = ["low", "medium", "high"] as const;

export const questionSchema = pageSchema.extend({
  category: z.string().optional(),
  tags: z.array(z.string()).default([]),
  difficulty: z.number().int().min(1).max(5).optional(),
  frequency: z.enum(frequencyValues).optional(),
  companies: z.array(z.string()).default([]),
  updated: z.string().optional(),
  popular: z.boolean().optional(),
});

export const categories = [
  { slug: "prompt-engineering", title: "提示词工程", href: "/docs/prompt-engineering" },
  { slug: "ai", title: "AI Agent", href: "/docs/ai" },
  { slug: "java", title: "Java", href: "/docs/java" },
  { slug: "database", title: "数据库", href: "/docs/database" },
  { slug: "distributed", title: "分布式系统", href: "/docs/distributed" },
  { slug: "system-design", title: "系统设计", href: "/docs/system-design" },
] as const;

export function frequencyLabel(value?: string) {
  if (value === "high") return "高频";
  if (value === "medium") return "中频";
  if (value === "low") return "低频";
  return "未标注";
}
