"use server";

import { z } from "zod";
import { rpcInput, runRpc } from "@/lib/rpc";

// Server actions for the job card screen: one RPC each (SPEC §5, §11). Reasons are 1–200 chars.
const ROUTE = "/job-cards/[id]";
const reason = z.string().trim().min(1, "validation.required").max(200, "validation.tooLong");
const qty = (min: number) =>
  z.number().int("validation.integer").min(min, "validation.qtyRange").max(999, "validation.qtyRange");

const resolveSchema = rpcInput({
  finding_id: z.guid(),
  part_id: z.guid().nullable(),
  no_part_reason: reason.nullable(),
});
export async function resolveFinding(input: z.input<typeof resolveSchema>) {
  return runRpc({
    route: ROUTE,
    schema: resolveSchema,
    input,
    fn: "resolve_finding",
    toArgs: (d) => ({
      p_finding_id: d.finding_id,
      ...(d.part_id ? { p_part_id: d.part_id } : {}),
      ...(d.no_part_reason ? { p_no_part_reason: d.no_part_reason } : {}),
    }),
  });
}

const switchSchema = rpcInput({ line_id: z.guid(), part_id: z.guid() });
export async function switchLinePart(input: z.input<typeof switchSchema>) {
  return runRpc({
    route: ROUTE,
    schema: switchSchema,
    input,
    fn: "switch_line_part",
    toArgs: (d) => ({ p_line_id: d.line_id, p_part_id: d.part_id }),
  });
}

const cardSchema = rpcInput({ card_id: z.guid() });
export async function confirmCard(input: z.input<typeof cardSchema>) {
  return runRpc({ route: ROUTE, schema: cardSchema, input, fn: "confirm_job_card", toArgs: (d) => ({ p_card_id: d.card_id }) });
}

const neededBySchema = rpcInput({ card_id: z.guid(), date: z.iso.date("validation.invalid") });
export async function setNeededBy(input: z.input<typeof neededBySchema>) {
  return runRpc({
    route: ROUTE,
    schema: neededBySchema,
    input,
    fn: "set_needed_by",
    toArgs: (d) => ({ p_card_id: d.card_id, p_date: d.date }),
  });
}

const cardReasonSchema = rpcInput({ card_id: z.guid(), reason });
export async function clearNeedsReview(input: z.input<typeof cardReasonSchema>) {
  return runRpc({
    route: ROUTE,
    schema: cardReasonSchema,
    input,
    fn: "clear_needs_review",
    toArgs: (d) => ({ p_card_id: d.card_id, p_reason: d.reason }),
  });
}
export async function cancelCard(input: z.input<typeof cardReasonSchema>) {
  return runRpc({
    route: ROUTE,
    schema: cardReasonSchema,
    input,
    fn: "cancel_job_card",
    toArgs: (d) => ({ p_card_id: d.card_id, p_reason: d.reason }),
  });
}

const addLineSchema = rpcInput({ card_id: z.guid(), part_id: z.guid(), qty: qty(1), reason: reason.nullable() });
export async function addLine(input: z.input<typeof addLineSchema>) {
  return runRpc({
    route: ROUTE,
    schema: addLineSchema,
    input,
    fn: "add_job_card_line",
    toArgs: (d) => ({ p_card_id: d.card_id, p_part_id: d.part_id, p_qty: d.qty, ...(d.reason ? { p_reason: d.reason } : {}) }),
  });
}

const lineQtySchema = rpcInput({ line_id: z.guid(), qty: qty(0), reason });
export async function setLineQty(input: z.input<typeof lineQtySchema>) {
  return runRpc({
    route: ROUTE,
    schema: lineQtySchema,
    input,
    fn: "set_line_qty",
    toArgs: (d) => ({ p_line_id: d.line_id, p_qty: d.qty, p_reason: d.reason }),
  });
}

const reallocateSchema = rpcInput({ from_line_id: z.guid(), to_line_id: z.guid(), qty: qty(1), reason });
export async function reallocate(input: z.input<typeof reallocateSchema>) {
  return runRpc({
    route: ROUTE,
    schema: reallocateSchema,
    input,
    fn: "reallocate_reservation",
    toArgs: (d) => ({ p_from_line_id: d.from_line_id, p_to_line_id: d.to_line_id, p_qty: d.qty, p_reason: d.reason }),
  });
}

const bikeSchema = rpcInput({ bike_id: z.guid() });
export async function markArrived(input: z.input<typeof bikeSchema>) {
  return runRpc({ route: ROUTE, schema: bikeSchema, input, fn: "mark_arrived", toArgs: (d) => ({ p_bike_id: d.bike_id }) });
}
export async function startRepair(input: z.input<typeof bikeSchema>) {
  return runRpc({ route: ROUTE, schema: bikeSchema, input, fn: "start_repair", toArgs: (d) => ({ p_bike_id: d.bike_id }) });
}
export async function createCard(input: z.input<typeof bikeSchema>) {
  return runRpc({ route: ROUTE, schema: bikeSchema, input, fn: "create_job_card", toArgs: (d) => ({ p_bike_id: d.bike_id }) });
}

const bikeReasonSchema = rpcInput({ bike_id: z.guid(), reason });
export async function cancelBike(input: z.input<typeof bikeReasonSchema>) {
  return runRpc({
    route: ROUTE,
    schema: bikeReasonSchema,
    input,
    fn: "cancel_bike",
    toArgs: (d) => ({ p_bike_id: d.bike_id, p_reason: d.reason }),
  });
}

const closeSchema = rpcInput({ card_id: z.guid(), drop_remaining: z.boolean(), reason: reason.nullable() });
export async function closeCard(input: z.input<typeof closeSchema>) {
  return runRpc({
    route: ROUTE,
    schema: closeSchema,
    input,
    fn: "close_job_card",
    toArgs: (d) => ({
      p_card_id: d.card_id,
      p_drop_remaining: d.drop_remaining,
      ...(d.reason ? { p_reason: d.reason } : {}),
    }),
  });
}
