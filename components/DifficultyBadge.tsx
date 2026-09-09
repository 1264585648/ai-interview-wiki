export function DifficultyBadge({ value }: { value?: number }) {
  if (!value) return null;
  return (
    <span className="inline-flex items-center rounded-md border border-fd-border px-2 py-0.5 text-xs text-fd-muted-foreground">
      难度 {value}/5
    </span>
  );
}
