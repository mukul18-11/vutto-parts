import { cn } from "@/lib/utils";

type Props = { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; className?: string };

export function PageHeader({ title, subtitle, actions, className }: Props) {
  return (
    <div className={cn("mb-4 flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
