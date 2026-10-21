import Image from "next/image";
import { cn } from "@/lib/utils";

/** The Vutto logo followed by the product word ("Parts"); reads as the full app name. */
export function Brand({ name, product, className }: { name: string; product: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)} title={name}>
      {/* A 256×63 PNG in public/; unoptimized: it is tiny and served as a static file. */}
      <Image src="/vutto-logo.png" alt="Vutto" width={256} height={63} priority unoptimized className="h-6 w-auto" />
      <span className="font-semibold">{product}</span>
    </span>
  );
}
