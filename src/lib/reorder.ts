// Pure TypeScript mirror of the SPEC §7.1 requirement formula (private.po_requirements), kept
// only so the formula has unit tests. Screens never compute stock numbers in TypeScript
// (SPEC §4); they read them from public.reorder_suggestions.

export const ISSUE_WINDOW_DAYS = 28;

export type RequirementInput = {
  usableOnHand: number;
  /** Sent/partially received open_qty plus manual draft lines. */
  onOrder: number;
  outstandingDemand: number;
  /** max(0, issued − returned) over the 28 complete IST days ending yesterday. */
  netIssued28d: number;
  leadTimeDays: number;
  safetyStock: number;
  maxQty: number;
  /** reorder_settings.auto and not a model_specific part. */
  isAuto: boolean;
  /** At least 7 complete days of issue history in the workshop. */
  enoughHistory: boolean;
};

export type Requirement = {
  projected: number;
  avgDailyIssue28d: number;
  /** null for on-demand parts. */
  rop: number | null;
  orderQty: number;
};

export function poRequirement(input: RequirementInput): Requirement {
  const projected = input.usableOnHand + input.onOrder - input.outstandingDemand;
  const avgDailyIssue28d = input.netIssued28d / ISSUE_WINDOW_DAYS;

  if (!input.isAuto) {
    return { projected, avgDailyIssue28d, rop: null, orderQty: Math.max(0, -projected) };
  }

  // ceil(net × lead / 28) in integers, as the SQL does, so no float rounding can shift it.
  const usage = input.enoughHistory
    ? Math.floor((input.netIssued28d * input.leadTimeDays + ISSUE_WINDOW_DAYS - 1) / ISSUE_WINDOW_DAYS)
    : 0;
  const rop = usage + input.safetyStock;
  const orderQty = projected <= rop ? Math.max(input.maxQty, rop + 1) - projected : 0;
  return { projected, avgDailyIssue28d, rop, orderQty };
}
