"use client";

import { useState } from "react";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { Field, inputClass } from "@/components/forms/field";
import { RpcFormStatus } from "@/components/rpc-form-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n/client";
import { useRpcForm } from "@/lib/use-rpc-form";
import { formatDateOnly } from "@/lib/time";
import { resetDemo } from "./actions";

const CONFIRM_WORD = "RESET";

/** RESET_COOLDOWN carries {retry_after_seconds}. */
function retryAfter(detail: unknown): number | null {
  if (typeof detail !== "object" || detail === null || !("retry_after_seconds" in detail)) return null;
  const n = (detail as { retry_after_seconds: unknown }).retry_after_seconds;
  return typeof n === "number" ? n : null;
}

function anchorOf(data: unknown): string | null {
  if (typeof data !== "object" || data === null || !("anchor_date" in data)) return null;
  const v = (data as { anchor_date: unknown }).anchor_date;
  return typeof v === "string" ? v : null;
}

/**
 * Reset demo data (SPEC §15): type RESET, then a ConfirmSheet with the effects, the last reset and
 * the last user activity (lines formatted on the server).
 */
export function ResetDemo({ userId, lastReset, lastActivity, cooldown }: { userId: string; lastReset: string; lastActivity: string; cooldown: string }) {
  const t = useT();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const form = useRpcForm(resetDemo, {
    userId,
    onSuccess: () => {
      setOpen(false);
      setText("");
    },
  });
  const typed = text.trim() === CONFIRM_WORD;
  const done = form.state.kind === "ok" ? anchorOf(form.state.data) : null;
  const seconds = form.state.kind === "error" && form.state.code === "RESET_COOLDOWN" ? retryAfter(form.state.detail) : null;

  return (
    <div className="flex flex-col gap-3">
      <Field label={t("admin.typeReset")}>
        {(id) => (
          <Input
            id={id}
            className={`${inputClass} font-mono`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder={CONFIRM_WORD}
            data-testid="reset-confirm-input"
          />
        )}
      </Field>
      <Button
        type="button"
        variant="destructive"
        className="h-12 w-full text-base sm:w-auto"
        disabled={!typed || form.disabled}
        onClick={() => {
          form.reset();
          setOpen(true);
        }}
        data-testid="reset-open"
      >
        {t("admin.resetButton")}
      </Button>
      {done && (
        <p role="status" className="rounded-lg bg-emerald-100 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100" data-testid="reset-done">
          {t("admin.done", { date: formatDateOnly(done) })}
        </p>
      )}
      <ConfirmSheet
        open={open}
        onOpenChange={setOpen}
        title={t("admin.sheetTitle")}
        effects={[t("admin.effectReplace"), t("admin.effectLost"), t("admin.effectKept"), lastReset, lastActivity, cooldown]}
        confirmLabel={t("admin.confirm")}
        onConfirm={() => form.submit({ confirm: CONFIRM_WORD })}
        pending={form.pending}
        disabled={form.disabled || !typed}
        destructive
      >
        <RpcFormStatus state={form.state} onRetry={() => form.submit({ confirm: CONFIRM_WORD })} />
        {seconds !== null && <p className="text-sm text-destructive">{t("admin.cooldownRetry", { n: seconds })}</p>}
      </ConfirmSheet>
    </div>
  );
}
