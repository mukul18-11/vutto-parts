import { cn } from "@/lib/utils";

/** SPEC §14 empty state: one sentence plus the next action. */
export function EmptyState({ message, action, className }: { message: string; action?: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-dashed p-8 text-center text-muted-foreground",
        className,
      )}
    >
      <p>{message}</p>
      {action}
    </div>
  );
}
