import Link from "next/link";
import { frequencyLabel } from "@/lib/question";

export function QuestionCard(props: {
  href: string;
  title: string;
  description?: string;
  category?: string;
  tags?: string[];
  difficulty?: number;
  frequency?: string;
}) {
  return (
    <Link
      href={props.href}
      className="flex flex-col gap-2 rounded-xl border border-fd-border bg-fd-card p-4 text-left transition-colors hover:bg-fd-accent"
    >
      <div className="flex items-center justify-between gap-3 text-xs text-fd-muted-foreground">
        <span>{props.category}</span>
        <span>{frequencyLabel(props.frequency)}</span>
      </div>
      <h3 className="text-base font-semibold text-fd-foreground">{props.title}</h3>
      {props.description ? (
        <p className="line-clamp-2 text-sm text-fd-muted-foreground">{props.description}</p>
      ) : null}
      <div className="flex flex-wrap gap-2 text-xs text-fd-muted-foreground">
        {props.difficulty ? <span>难度 {props.difficulty}/5</span> : null}
        {(props.tags ?? []).slice(0, 3).map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
    </Link>
  );
}
