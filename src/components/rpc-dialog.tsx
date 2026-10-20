"use client";

import { useState } from "react";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { ErrorDetail } from "@/components/error-detail";
import { Field } from "@/components/forms/field";
import { RpcFormStatus } from "@/components/rpc-form-status";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/lib/i18n/client";
import type { RpcEnvelope, RpcResult } from "@/lib/rpc-form-logic";
import { useRpcForm, type FormValues, type RpcFormState } from "@/lib/use-rpc-form";

type Props<P extends RpcEnvelope, T> = {
  userId: string;
  action: (input: P) => Promise<RpcResult<T>>;
  /** The form values; null keeps the submit disabled. Gets the reason text. */
  values: (reason: string) => FormValues<P> | null;
  triggerLabel: string;
  triggerVariant?: "default" | "outline" | "secondary" | "ghost" | "destructive" | "link";
  triggerClassName?: string;
  triggerTestId?: string;
  title: string;
  description?: string;
  confirmLabel: string;
  /** SPEC §14 confirmation sheet (with the concrete effects) instead of a dialog. */
  sheet?: boolean;
  effects?: React.ReactNode[];
  reason?: "required" | "optional" | "none";
  reasonLabel?: string;
  /** Text the reason starts with (editable), e.g. "re-inspected". */
  defaultReason?: string;
  destructive?: boolean;
  disabled?: boolean;
  /** Extra fields (controlled by the caller). */
  children?: React.ReactNode;
  onOpenChange?: (open: boolean) => void;
  onSuccess?: (data: T) => void;
  renderError?: (state: RpcFormState<T>) => React.ReactNode;
};

const REASON_MAX = 200;

/** A button that opens a dialog (or a confirmation sheet) and runs one RPC with an optional reason. */
export function RpcDialog<P extends RpcEnvelope, T>(props: Props<P, T>) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(props.defaultReason ?? "");
  const { submit, pending, disabled, state, reset } = useRpcForm(props.action, {
    userId: props.userId,
    onSuccess: (data) => {
      setOpen(false);
      setReason(props.defaultReason ?? "");
      props.onSuccess?.(data);
    },
  });
  const mode = props.reason ?? "none";
  const trimmed = reason.trim();
  const values = props.values(trimmed);
  const blocked = values === null || (mode === "required" && trimmed.length === 0) || trimmed.length > REASON_MAX;

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) reset();
    props.onOpenChange?.(next);
  };
  const run = () => values && submit(values);

  const fields = (
    <div className="flex flex-col gap-3">
      {props.children}
      {mode !== "none" && (
        <Field label={props.reasonLabel ?? (mode === "required" ? t("form.reason") : t("form.reasonOptional"))}>
          {(id) => (
            <Textarea id={id} value={reason} maxLength={REASON_MAX} onChange={(e) => setReason(e.target.value)} />
          )}
        </Field>
      )}
      <RpcFormStatus state={state} onRetry={run} />
      {props.renderError ? props.renderError(state) : <ErrorDetail state={state} />}
    </div>
  );

  return (
    <>
      <Button
        type="button"
        variant={props.triggerVariant ?? "outline"}
        className={props.triggerClassName ?? "h-11"}
        data-testid={props.triggerTestId}
        disabled={props.disabled}
        onClick={() => changeOpen(true)}
      >
        {props.triggerLabel}
      </Button>
      {props.sheet ? (
        <ConfirmSheet
          open={open}
          onOpenChange={changeOpen}
          title={props.title}
          description={props.description}
          effects={props.effects ?? []}
          confirmLabel={props.confirmLabel}
          onConfirm={run}
          pending={pending}
          disabled={disabled || blocked}
          destructive={props.destructive}
        >
          {fields}
        </ConfirmSheet>
      ) : (
        <Dialog open={open} onOpenChange={changeOpen}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{props.title}</DialogTitle>
              {props.description && <DialogDescription>{props.description}</DialogDescription>}
            </DialogHeader>
            {fields}
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" className="h-12 text-base" onClick={() => changeOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                variant={props.destructive ? "destructive" : "default"}
                className="h-12 text-base"
                disabled={disabled || blocked}
                onClick={run}
              >
                {pending ? t("rpcForm.saving") : props.confirmLabel}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/** A single button that runs one RPC (no dialog) and shows the outcome under it. */
export function RpcButton<P extends RpcEnvelope, T>({
  userId,
  action,
  values,
  label,
  variant,
  className,
  testId,
  onSuccess,
  renderError,
}: {
  userId: string;
  action: (input: P) => Promise<RpcResult<T>>;
  values: FormValues<P>;
  label: string;
  variant?: "default" | "outline" | "secondary";
  className?: string;
  testId?: string;
  onSuccess?: (data: T) => void;
  renderError?: (state: RpcFormState<T>) => React.ReactNode;
}) {
  const t = useT();
  const { submit, pending, disabled, state } = useRpcForm(action, { userId, onSuccess });
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Button
        type="button"
        variant={variant ?? "default"}
        className={className ?? "h-11"}
        data-testid={testId}
        disabled={disabled}
        onClick={() => submit(values)}
      >
        {pending ? t("rpcForm.saving") : label}
      </Button>
      <RpcFormStatus state={state} onRetry={() => submit(values)} />
      {renderError ? renderError(state) : <ErrorDetail state={state} />}
    </div>
  );
}
