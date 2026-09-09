import type { ReactNode } from "react";

export function FollowUpBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="my-4 rounded-lg border border-fd-border bg-fd-card px-4 py-3">
      <h3 className="mb-2 text-base font-semibold">{title}</h3>
      <div className="text-sm leading-7 text-fd-muted-foreground">{children}</div>
    </section>
  );
}
