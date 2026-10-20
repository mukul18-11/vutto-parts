"use client";

import { useState } from "react";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { ErrorDetail } from "@/components/error-detail";
import { Field, NativeSelect } from "@/components/forms/field";
import { PartPicker } from "@/components/part-picker";
import { QtyStepper } from "@/components/qty-stepper";
import { RpcFormStatus } from "@/components/rpc-form-status";
import { Button } from "@/components/ui/button";
import type { Database } from "@/lib/database.types";
import { useT } from "@/lib/i18n/client";
import { formatIST } from "@/lib/time";
import { useRpcForm } from "@/lib/use-rpc-form";
import { adjustStock, type AdjustResult, type StaleMove } from "../../actions";

type Uom = Database["public"]["Enums"]["uom"];
type Reason = "count_correction" | "lost" | "found";
const REASONS: Reason[] = ["count_correction", "lost", "found"];

export type CountItem = { part_id: string; sku: string; name: string; name_hi: string | null; uom: Uom; expected: number };

type Props = {
  userId: string;
  workshopId: string;
  bin: { id: string; code: string };
  items: CountItem[];
  loadedAt: string;
};

/** Every part in the bin with a count entry; "Add part" counts a part the system does not show here. */
export function CountSheet({ userId, workshopId, bin, items, loadedAt }: Props) {
  const t = useT();
  const [extra, setExtra] = useState<CountItem[]>([]);
  const all = [...items, ...extra.filter((e) => !items.some((i) => i.part_id === e.part_id))];
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t("count.hint")}</p>
      <ul className="flex flex-col gap-3" data-testid="count-rows">
        {all.map((item) => (
          <CountRow key={item.part_id} userId={userId} workshopId={workshopId} bin={bin} item={item} loadedAt={loadedAt} />
        ))}
      </ul>
      <details className="rounded-xl border p-3">
        <summary className="min-h-10 cursor-pointer font-medium">{t("count.addPart")}</summary>
        <p className="mb-2 text-sm text-muted-foreground">{t("count.addPartHint")}</p>
        <PartPicker
          workshopId={workshopId}
          onPick={(p) =>
            setExtra((prev) =>
              prev.some((e) => e.part_id === p.part_id)
                ? prev
                : [...prev, { part_id: p.part_id, sku: p.sku, name: p.name, name_hi: p.name_hi, uom: p.uom, expected: 0 }],
            )
          }
        />
      </details>
    </div>
  );
}

function CountRow({
  userId,
  workshopId,
  bin,
  item,
  loadedAt,
}: {
  userId: string;
  workshopId: string;
  bin: { id: string; code: string };
  item: CountItem;
  loadedAt: string;
}) {
  const t = useT();
  // An entry belongs to the expected qty it was counted against: after STALE_COUNT the page
  // refreshes with the new on hand, the entry blanks and the manager recounts.
  const [entry, setEntry] = useState<{ counted: number | null; expected: number }>({ counted: null, expected: item.expected });
  const counted = entry.expected === item.expected ? entry.counted : null;
  const setCounted = (n: number | null) => setEntry({ counted: n, expected: item.expected });
  const [reason, setReason] = useState<Reason>("count_correction");
  const [open, setOpen] = useState(false);
  const form = useRpcForm(adjustStock, { userId, onSuccess: () => setCounted(null) });
  const uom = t(`enums.uom.${item.uom}`);
  const delta = counted === null ? 0 : counted - item.expected;
  const run = () => {
    if (counted === null) return;
    setOpen(false);
    form.submit({
      workshop_id: workshopId,
      bin_id: bin.id,
      part_id: item.part_id,
      counted_qty: counted,
      expected_on_hand: item.expected,
      reason,
      loaded_at: loadedAt,
    });
  };
  const result = form.state.kind === "ok" ? (form.state.data as AdjustResult) : null;
  const stale = form.state.kind === "error" && form.state.code === "STALE_COUNT" ? (form.state.detail as { moves?: StaleMove[]; current?: number } | null) : null;

  const effects = [
    t("count.effectCount", { bin: bin.code, sku: item.sku, from: item.expected, to: counted ?? 0, uom }),
    delta === 0
      ? t("count.effectNoChange")
      : delta > 0
        ? t("count.effectIn", { n: delta, uom, reason: t(`count.reason_${reason}`) })
        : t("count.effectOut", { n: -delta, uom, reason: t(`count.reason_${reason}`) }),
    ...(delta < 0 ? [t("count.effectReleaseWarning")] : []),
    t("count.effectClearsRequest"),
  ];

  return (
    <li className="flex flex-col gap-3 rounded-xl border p-3" data-testid={`count-row-${item.sku}`}>
      <div>
        <p className="font-mono text-sm">{item.sku}</p>
        <p className="break-words font-medium">{item.name}</p>
        {item.name_hi && <p className="text-sm text-muted-foreground">{item.name_hi}</p>}
        <p className="text-sm">
          {t("count.expected", { n: item.expected, uom })}
        </p>
      </div>
      <QtyStepper
        label={t("count.counted")}
        value={counted}
        min={0}
        max={9999}
        onChange={setCounted}
        onClear={() => setCounted(null)}
        uom={item.uom}
        testId={`counted-${item.sku}`}
      />
      <Field label={t("count.reason")}>
        {(id) => (
          <NativeSelect id={id} value={reason} onChange={(e) => setReason(e.target.value as Reason)}>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {t(`count.reason_${r}`)}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <Button
        type="button"
        className="h-12 text-base"
        disabled={form.disabled || counted === null}
        onClick={() => setOpen(true)}
        data-testid={`save-count-${item.sku}`}
      >
        {form.pending ? t("rpcForm.saving") : t("count.save")}
      </Button>

      {stale && (
        <div role="alert" className="rounded-lg border border-amber-400 bg-amber-50 p-2 text-sm dark:bg-amber-950" data-testid={`stale-${item.sku}`}>
          <p className="font-medium">{t("count.stale")}</p>
          <ul className="mt-1 list-disc pl-5">
            {(stale.moves ?? []).map((m) => (
              <li key={m.id}>
                {t("count.staleMove", {
                  who: m.user_full_name ?? "–",
                  what: t(`enums.move_type.${m.move_type as Database["public"]["Enums"]["move_type"]}`),
                  delta: m.bin_delta === null ? "" : m.bin_delta > 0 ? `+${m.bin_delta}` : String(m.bin_delta),
                  at: formatIST(m.created_at),
                })}
              </li>
            ))}
          </ul>
          <p className="mt-1">{t("count.recount")}</p>
        </div>
      )}
      {form.state.kind === "error" && !stale && <ErrorDetail state={form.state} />}
      <RpcFormStatus state={form.state} onRetry={run} />

      {result && (
        <div role="status" className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-950 dark:bg-emerald-950 dark:text-emerald-50" data-testid={`count-result-${item.sku}`}>
          <p>{result.delta === 0 ? t("count.resultNoChange", { n: result.on_hand, uom }) : t("count.resultChanged", { delta: result.delta > 0 ? `+${result.delta}` : String(result.delta), n: result.on_hand, uom })}</p>
          {result.released_bikes.length > 0 && (
            <div className="mt-1 text-red-900 dark:text-red-200">
              <p className="font-medium">{t("count.lostReservation")}</p>
              <ul className="list-disc pl-5">
                {result.released_bikes.map((b) => (
                  <li key={b.card_code}>{`${b.reg_no ?? "–"} (${b.card_code})`}</li>
                ))}
              </ul>
            </div>
          )}
          {result.allocated.length > 0 && (
            <p className="mt-1">
              {t("count.allocated", { list: result.allocated.map((a) => `${a.reg_no} (${a.card_code}) ×${a.qty}`).join(", ") })}
            </p>
          )}
        </div>
      )}

      <ConfirmSheet
        open={open}
        onOpenChange={setOpen}
        title={t("count.confirmTitle", { sku: item.sku, bin: bin.code })}
        effects={effects}
        confirmLabel={t("count.confirm")}
        onConfirm={run}
        pending={form.pending}
        disabled={form.disabled}
        destructive={delta < 0}
      />
    </li>
  );
}
