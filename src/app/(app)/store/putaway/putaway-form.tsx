"use client";

import { useState } from "react";
import { BinPicker, type BinOption } from "@/components/bin-picker";
import { EmptyState } from "@/components/empty-state";
import { ErrorDetail } from "@/components/error-detail";
import { QtyStepper } from "@/components/qty-stepper";
import { RpcFormStatus } from "@/components/rpc-form-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Database } from "@/lib/database.types";
import { useT } from "@/lib/i18n/client";
import { useRpcForm } from "@/lib/use-rpc-form";
import { cn } from "@/lib/utils";
import { putaway, type PutawayResult } from "../actions";

type Uom = Database["public"]["Enums"]["uom"];

export type ReceivingItem = {
  bin_id: string;
  part_id: string;
  sku: string;
  name: string;
  name_hi: string | null;
  uom: Uom;
  on_hand: number;
  /** "3d 4h" since the oldest unit arrived, formatted on the server. */
  age: string | null;
  reserved: number;
  reserved_for: { card_code: string; reg_no: string; qty: number; arrived: boolean }[];
  suggested: BinOption | null;
};

type Done = { sku: string; uom: Uom; binCode: string; result: PutawayResult };

/** Receiving-bin stock (oldest first); tap one to put it away. */
export function PutawayList({
  userId,
  workshopCode,
  items,
  bins,
}: {
  userId: string;
  workshopCode: string;
  items: ReceivingItem[];
  bins: BinOption[];
}) {
  const t = useT();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const keyOf = (i: ReceivingItem) => `${i.bin_id}:${i.part_id}`;
  const selected = items.find((i) => keyOf(i) === selectedKey) ?? null;

  return (
    <div className="flex flex-col gap-3">
      {done && (
        <p role="status" className="rounded-xl bg-emerald-50 p-3 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-50" data-testid="putaway-done">
          {t("putaway.done", {
            qty: done.result.qty,
            uom: t(`enums.uom.${done.uom}`),
            sku: done.sku,
            bin: done.binCode,
            left: done.result.from_on_hand,
            now: done.result.to_on_hand,
          })}
        </p>
      )}
      {items.length === 0 && <EmptyState message={t("putaway.empty")} />}
      <ul className="flex flex-col gap-2" data-testid="receiving-list">
        {items.map((item) => {
          const active = keyOf(item) === selectedKey;
          return (
            <li key={keyOf(item)} className={cn("rounded-xl border", active && "border-primary")}>
              <button
                type="button"
                className="flex w-full flex-col gap-1 p-3 text-left"
                aria-expanded={active}
                onClick={() => {
                  setSelectedKey(active ? null : keyOf(item));
                  setDone(null);
                }}
                data-testid={`receiving-${item.sku}`}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm">{item.sku}</span>
                  <span className="font-semibold tabular-nums" data-testid={`receiving-qty-${item.sku}`}>
                    {`${item.on_hand} ${t(`enums.uom.${item.uom}`)}`}
                  </span>
                  {item.reserved > 0 && (
                    <Badge className="bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100">
                      {t("putaway.reserved", { n: Math.min(item.reserved, item.on_hand) })}
                    </Badge>
                  )}
                </span>
                <span className="break-words">{item.name}</span>
                {item.name_hi && <span className="text-sm text-muted-foreground">{item.name_hi}</span>}
                <span className="text-sm text-muted-foreground">
                  {item.age && t("putaway.age", { time: item.age })}
                  {item.suggested && ` · ${t("putaway.sitsIn", { code: item.suggested.code })}`}
                </span>
                {item.reserved_for.length > 0 && (
                  <span className="text-sm">
                    {t("putaway.reservedFor", {
                      list: item.reserved_for.map((r) => `${r.reg_no} (${r.card_code}) ×${r.qty}`).join(", "),
                    })}
                  </span>
                )}
              </button>
              {active && selected && (
                <PutawayForm
                  key={keyOf(selected)}
                  userId={userId}
                  workshopCode={workshopCode}
                  item={selected}
                  bins={bins}
                  onDone={(binCode, result) => {
                    setDone({ sku: selected.sku, uom: selected.uom, binCode, result });
                    setSelectedKey(null);
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PutawayForm({
  userId,
  workshopCode,
  item,
  bins,
  onDone,
}: {
  userId: string;
  workshopCode: string;
  item: ReceivingItem;
  bins: BinOption[];
  onDone: (binCode: string, result: PutawayResult) => void;
}) {
  const t = useT();
  const [binId, setBinId] = useState<string | null>(item.suggested?.id ?? null);
  const [qty, setQty] = useState(item.on_hand);
  // A bin other than where the part already sits needs a second tap (SPEC putaway rule).
  const [warned, setWarned] = useState<string | null>(null);
  const bin = bins.find((b) => b.id === binId) ?? null;
  const different = Boolean(item.suggested && binId && binId !== item.suggested.id);
  const form = useRpcForm(putaway, {
    userId,
    onSuccess: (data) => onDone(bin?.code ?? "", data as unknown as PutawayResult),
  });
  const run = () => {
    if (!binId) return;
    if (different && warned !== binId) {
      setWarned(binId);
      return;
    }
    form.submit({ part_id: item.part_id, from_bin_id: item.bin_id, to_bin_id: binId, qty });
  };

  return (
    <div className="flex flex-col gap-3 border-t p-3" data-testid="putaway-form">
      <BinPicker
        bins={bins}
        workshopCode={workshopCode}
        value={binId}
        onChange={(id) => {
          setBinId(id);
          setWarned(null);
        }}
        suggested={item.suggested}
        testId="putaway-bin"
      />
      <QtyStepper label={t("putaway.qty")} value={qty} min={1} max={item.on_hand} onChange={setQty} uom={item.uom} />
      {different && warned === binId && item.suggested && (
        <p role="alert" className="rounded-lg bg-amber-50 p-2 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-50">
          {t("putaway.differentBin", { code: item.suggested.code, chosen: bin?.code ?? "" })}
        </p>
      )}
      <RpcFormStatus state={form.state} onRetry={run} />
      <ErrorDetail state={form.state} />
      <div className="sticky bottom-0 -mx-3 bg-background px-3 py-2">
        <Button
          type="button"
          className="h-14 w-full text-base"
          disabled={form.disabled || !binId}
          onClick={run}
          data-testid="putaway-submit"
        >
          {form.pending
            ? t("rpcForm.saving")
            : different && warned === binId
              ? t("putaway.confirmDifferent", { code: bin?.code ?? "" })
              : t("putaway.submit", { qty, uom: t(`enums.uom.${item.uom}`), code: bin?.code ?? "…" })}
        </Button>
      </div>
    </div>
  );
}
