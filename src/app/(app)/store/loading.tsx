import { Skeleton } from "@/components/ui/skeleton";

/** The store home's tile grid while the counts load. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-4 w-48" />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
