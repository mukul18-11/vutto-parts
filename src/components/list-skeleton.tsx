import { Skeleton } from "@/components/ui/skeleton";

/** loading.tsx skeleton for list and detail pages (SPEC §14). */
export function ListSkeleton({ rows = 4, strip = false }: { rows?: number; strip?: boolean }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-32" />
      {strip && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}
