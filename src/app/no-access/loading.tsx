import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-4" aria-busy="true">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-12 w-full" />
    </main>
  );
}
