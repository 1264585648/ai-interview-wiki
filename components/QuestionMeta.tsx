import { CompanyBadge } from "./CompanyBadge";
import { DifficultyBadge } from "./DifficultyBadge";
import { frequencyLabel } from "@/lib/question";

export function QuestionMeta(props: {
  category?: string;
  tags?: string[];
  difficulty?: number;
  frequency?: string;
  companies?: string[];
}) {
  const tags = props.tags ?? [];
  const companies = props.companies ?? [];

  return (
    <div className="mb-8 flex flex-col gap-3 border-b border-fd-border pb-6">
      <div className="flex flex-wrap items-center gap-2">
        {props.category ? (
          <span className="text-sm font-medium text-fd-foreground">{props.category}</span>
        ) : null}
        {tags.map((tag) => (
          <span key={tag} className="text-xs text-fd-muted-foreground">
            {tag}
          </span>
        ))}
        <DifficultyBadge value={props.difficulty} />
        {props.frequency ? (
          <span className="inline-flex items-center rounded-md bg-fd-primary px-2 py-0.5 text-xs text-fd-primary-foreground">
            {frequencyLabel(props.frequency)}
          </span>
        ) : null}
      </div>
      {companies.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {companies.map((name) => (
            <CompanyBadge key={name} name={name} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
