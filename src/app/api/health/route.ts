// Public liveness check (the proxy skips this path). Later it reports public.health() (SPEC §16).
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
