import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { clientEnv } from "@/env.client";
import { requireRole, type SearchParams } from "@/lib/auth";
import { demoEmailFor } from "@/lib/demo-accounts";
import { readSchemaVersion } from "@/lib/health";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { formatDateOnly, formatIST } from "@/lib/time";
import { ResetDemo } from "./reset-demo";

export const metadata: Metadata = { title: "Admin · Vutto Parts" };

const ERROR_LIMIT = 50;

/**
 * Admin (SPEC §2, §15, §16): demo reset, schema version and commit, demo users (no passwords),
 * the last 50 app_errors and the planted scenarios. Last user activity is the newest activity_log
 * row that is not simulated (every mutating RPC writes one; idempotency is not readable).
 */
export default async function AdminPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { user, workshops } = await requireRole("/admin", await searchParams);
  const t = await getT();
  const supabase = await createClient();

  const [healthRes, metaRes, activityRes, profilesRes, errorsRes] = await Promise.all([
    supabase.rpc("health"),
    supabase.from("demo_meta").select("anchor_date, last_reset_at, last_reset_by, cooldown_seconds").maybeSingle(),
    supabase.from("activity_log").select("created_at, user_id").eq("is_simulated", false).order("id", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("profiles").select("user_id, full_name, role, workshop_id").order("role", { ascending: false }).order("full_name"),
    supabase.from("app_errors").select("id, created_at, user_id, route, code, message, request_id").order("id", { ascending: false }).limit(ERROR_LIMIT),
  ]);
  if (healthRes.error) throw healthRes.error;
  if (metaRes.error) throw metaRes.error;
  if (activityRes.error) throw activityRes.error;
  if (profilesRes.error) throw profilesRes.error;
  if (errorsRes.error) throw errorsRes.error;

  const meta = metaRes.data;
  const profiles = profilesRes.data ?? [];
  const errors = errorsRes.data ?? [];
  const nameOf = new Map(profiles.map((p) => [p.user_id, p.full_name]));
  const codeOf = new Map(workshops.map((w) => [w.id, w.code]));
  const unknownUser = "?";

  const lastReset = !meta?.last_reset_at
    ? t("admin.neverReset")
    : meta.last_reset_by
      ? t("admin.lastReset", { time: formatIST(meta.last_reset_at), name: nameOf.get(meta.last_reset_by) ?? unknownUser })
      : t("admin.lastResetNoUser", { time: formatIST(meta.last_reset_at) });
  const activity = activityRes.data;
  const lastActivity =
    activity?.created_at
      ? t("admin.lastActivity", { time: formatIST(activity.created_at), name: (activity.user_id && nameOf.get(activity.user_id)) || unknownUser })
      : t("admin.noActivity");

  return (
    <>
      <PageHeader title={t("pages.admin")} />

      <section className="mb-6 rounded-xl border p-4" aria-labelledby="admin-system">
        <h2 id="admin-system" className="mb-2 font-semibold">
          {t("admin.system")}
        </h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">{t("admin.schema")}</dt>
            <dd className="font-mono" data-testid="admin-schema">
              {readSchemaVersion(healthRes.data) ?? "?"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("admin.commit")}</dt>
            <dd className="font-mono break-all" data-testid="admin-commit">
              {clientEnv.NEXT_PUBLIC_COMMIT_SHA}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("admin.anchor")}</dt>
            <dd>{meta?.anchor_date ? formatDateOnly(meta.anchor_date) : "–"}</dd>
          </div>
        </dl>
      </section>

      <section className="mb-6 rounded-xl border p-4" aria-labelledby="admin-reset">
        <h2 id="admin-reset" className="font-semibold">
          {t("admin.resetTitle")}
        </h2>
        <p className="mb-1 text-sm text-muted-foreground">{t("admin.resetIntro")}</p>
        <ul className="mb-3 text-sm text-muted-foreground">
          <li data-testid="admin-last-reset">{lastReset}</li>
          <li data-testid="admin-last-activity">{lastActivity}</li>
        </ul>
        <ResetDemo
          userId={user.id}
          lastReset={lastReset}
          lastActivity={lastActivity}
          cooldown={t("admin.cooldown", { n: meta?.cooldown_seconds ?? 120 })}
        />
      </section>

      <section className="mb-6 rounded-xl border p-4" aria-labelledby="admin-planted">
        <h2 id="admin-planted" className="font-semibold">
          <Link href="/admin/planted" className="underline underline-offset-4" data-testid="admin-planted-link">
            {t("admin.plantedLink")}
          </Link>
        </h2>
        <p className="text-sm text-muted-foreground">{t("admin.plantedIntro")}</p>
      </section>

      <section className="mb-6" aria-labelledby="admin-users">
        <h2 id="admin-users" className="font-semibold">
          {t("admin.usersTitle")}
        </h2>
        <p className="mb-2 text-sm text-muted-foreground">{t("admin.usersNote")}</p>
        <div className="overflow-x-auto rounded-xl border">
          <Table data-testid="admin-users">
            <TableHeader>
              <TableRow>
                <TableHead>{t("admin.name")}</TableHead>
                <TableHead>{t("admin.email")}</TableHead>
                <TableHead>{t("admin.role")}</TableHead>
                <TableHead>{t("admin.workshop")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.map((p) => (
                <TableRow key={p.user_id}>
                  <TableCell>{p.full_name}</TableCell>
                  <TableCell className="font-mono text-xs">{demoEmailFor(p.user_id) ?? "–"}</TableCell>
                  <TableCell>{t(`enums.app_role.${p.role}`)}</TableCell>
                  <TableCell>{p.workshop_id ? (codeOf.get(p.workshop_id) ?? "?") : t("admin.allWorkshops")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section aria-labelledby="admin-errors">
        <h2 id="admin-errors" className="font-semibold">
          {t("admin.errorsTitle")}
        </h2>
        {errors.length === 0 ? (
          <EmptyState message={t("admin.errorsEmpty")} />
        ) : (
          <>
            <p className="mb-2 text-sm text-muted-foreground">{t("admin.errorsIntro", { n: ERROR_LIMIT })}</p>
            <div className="overflow-x-auto rounded-xl border">
              <Table data-testid="admin-errors">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("admin.time")}</TableHead>
                    <TableHead>{t("admin.user")}</TableHead>
                    <TableHead>{t("admin.route")}</TableHead>
                    <TableHead>{t("admin.code")}</TableHead>
                    <TableHead>{t("admin.message")}</TableHead>
                    <TableHead>{t("admin.ref")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {errors.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="whitespace-nowrap">{formatIST(e.created_at)}</TableCell>
                      <TableCell>{nameOf.get(e.user_id) ?? unknownUser}</TableCell>
                      <TableCell className="font-mono text-xs">{e.route}</TableCell>
                      <TableCell className="font-mono text-xs">{e.code}</TableCell>
                      <TableCell className="max-w-96 text-xs break-words whitespace-normal">
                        <span className="line-clamp-3">{e.message}</span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{`${e.id}${e.request_id ? ` · ${e.request_id.slice(0, 8)}` : ""}`}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </section>
    </>
  );
}
