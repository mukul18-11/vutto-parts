"use client";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useT } from "@/lib/i18n/client";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** The concrete effects of the action, one per line (SPEC §14). */
  effects: React.ReactNode[];
  /** Names the action, e.g. "Post GRN" — never just "OK". */
  confirmLabel: string;
  onConfirm: () => void;
  pending?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  /** Extra content such as RpcFormStatus. */
  children?: React.ReactNode;
};

/** Confirmation as a bottom sheet (never window.confirm). */
export function ConfirmSheet({
  open,
  onOpenChange,
  title,
  description,
  effects,
  confirmLabel,
  onConfirm,
  pending,
  disabled,
  destructive,
  children,
}: Props) {
  const t = useT();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-lg rounded-t-2xl">
        <SheetHeader>
          <SheetTitle className="text-lg">{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        <ul className="list-disc space-y-1 px-8 text-base">
          {effects.map((effect, i) => (
            <li key={i}>{effect}</li>
          ))}
        </ul>
        {children && <div className="px-4">{children}</div>}
        <SheetFooter className="gap-2">
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            className="h-12 w-full text-base"
            disabled={pending || disabled}
            onClick={onConfirm}
          >
            {pending ? t("rpcForm.saving") : confirmLabel}
          </Button>
          <Button type="button" variant="outline" className="h-12 w-full text-base" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
