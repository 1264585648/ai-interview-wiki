export function CompanyBadge({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-fd-secondary px-2.5 py-0.5 text-xs text-fd-secondary-foreground">
      {name}
    </span>
  );
}
