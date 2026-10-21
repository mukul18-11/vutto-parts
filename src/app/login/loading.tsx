import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 p-4" aria-busy="true">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-4 w-56" />
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </main>
  );
}
