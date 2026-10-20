// What close_job_card with drop_remaining does to each live line (SPEC §5.2), listed in the
// confirmation sheet before the manager confirms: release reservations, set qty_required to
// net_issued, cancel lines left at 0. Mirrors the RPC; the server stays the source of truth.

export type CloseLine = {
  id: string;
  sku: string;
  qty_required: number;
  qty_reserved: number;
  qty_issued: number;
  qty_returned: number;
};

export type CloseEffect = {
  line_id: string;
  sku: string;
  release: number;
  from_required: number;
  to_required: number;
  cancels: boolean;
};

/** Lines that the drop changes, in the given order; empty when a plain close is possible. */
export function closeEffects(lines: CloseLine[]): CloseEffect[] {
  const out: CloseEffect[] = [];
  for (const l of lines) {
    const net = l.qty_issued - l.qty_returned;
    if (l.qty_reserved === 0 && l.qty_required === net) continue;
    out.push({
      line_id: l.id,
      sku: l.sku,
      release: l.qty_reserved,
      from_required: l.qty_required,
      to_required: net,
      cancels: net === 0,
    });
  }
  return out;
}

/** A plain close (no drop) is allowed only when no line changes and nothing needs review. */
export function canPlainClose(lines: CloseLine[], needsReviewReason: string | null): boolean {
  return needsReviewReason === null && closeEffects(lines).length === 0;
}
