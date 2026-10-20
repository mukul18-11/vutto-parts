// Loads supabase/seed/template.sql (written by `pnpm seed:gen`) into the database named by
// DATABASE_URL, replacing schema demo_seed. It only stages the template; the copy into public
// happens at the next reset_demo or scheduled reseed (SPEC §15).
//
// Local:      pnpm exec tsx --env-file=.env scripts/load-template.ts
// Production: pnpm exec tsx --env-file=.env.prod.local scripts/load-template.ts --prod
// Never imported from src/.
import { readFileSync } from "node:fs";
import pg from "pg";

async function main(): Promise<void> {
  const prod = process.argv.includes("--prod");
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("Missing env DATABASE_URL");
  const host = new URL(url).hostname;
  const local = host === "127.0.0.1" || host === "localhost";
  if (local && prod) throw new Error("Refusing to run: --prod was passed but DATABASE_URL points at localhost");
  if (!local && !prod) throw new Error(`Refusing to run against ${host} without --prod`);

  const sql = readFileSync(new URL("../supabase/seed/template.sql", import.meta.url), "utf8");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    // One simple-protocol query: the statements run as one implicit transaction.
    await client.query(sql);
    const { rows } = await client.query<{ anchor_date: string }>("select anchor_date::text from demo_seed.meta");
    console.log(`Loaded demo_seed template (anchor ${rows[0].anchor_date}) into ${host}`);
  } finally {
    await client.end();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
