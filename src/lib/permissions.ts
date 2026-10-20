// The one role table (SPEC §2, §17): which roles see which routes and which actions. Pages guard
// with requireRole(route), navigation comes from navFor(role), and the permission matrix tests
// read the same table. Roles are ordered (store_keeper < manager < admin); a higher role can do
// everything a lower role can.
import { Constants, type Database } from "@/lib/database.types";
import type { MessageKey } from "@/lib/i18n";

export type Role = Database["public"]["Enums"]["app_role"];

/** Ascending, matching the Postgres enum order that private.authorize compares. */
export const ROLES: readonly Role[] = Constants.public.Enums.app_role;

export function roleAtLeast(role: Role, min: Role): boolean {
  return ROLES.indexOf(role) >= ROLES.indexOf(min);
}

/** nav: the navigation label; detail-only routes (reached by links) have none. */
type RouteRule = { minRole: Role; nav?: MessageKey };

export const ROUTES = {
  "/blocked": { minRole: "manager", nav: "nav.blocked" },
  "/bikes": { minRole: "manager", nav: "nav.bikes" },
  "/job-cards": { minRole: "manager" },
  "/purchasing": { minRole: "manager", nav: "nav.purchasing" },
  "/reorder": { minRole: "manager", nav: "nav.reorder" },
  "/store": { minRole: "store_keeper", nav: "nav.store" },
  "/store/receive": { minRole: "store_keeper" },
  "/store/putaway": { minRole: "store_keeper" },
  "/store/issue": { minRole: "store_keeper" },
  "/stock": { minRole: "store_keeper", nav: "nav.stock" },
  "/stock/count": { minRole: "manager" },
  "/stock/quarantine": { minRole: "manager" },
  "/catalogue": { minRole: "store_keeper", nav: "nav.catalogue" },
  "/bins/labels": { minRole: "store_keeper" },
} as const satisfies Record<string, RouteRule>;

export type RouteKey = keyof typeof ROUTES;

/**
 * Minimum role per mutating RPC, as enforced by private.authorize in each RPC. move_stock out of
 * a quarantine bin needs manager (listed as move_out_of_quarantine); any other move is store_keeper.
 */
export const ACTIONS = {
  // Bikes and job cards (manager)
  create_bike: "manager",
  set_bike_variant: "manager",
  cancel_bike: "manager",
  start_repair: "manager",
  create_job_card: "manager",
  update_draft_findings: "manager",
  resolve_finding: "manager",
  confirm_job_card: "manager",
  cancel_job_card: "manager",
  close_job_card: "manager",
  set_line_qty: "manager",
  switch_line_part: "manager",
  set_needed_by: "manager",
  reallocate_reservation: "manager",
  clear_needs_review: "manager",
  // Purchasing (manager)
  generate_draft_pos: "manager",
  add_draft_line: "manager",
  update_draft_line: "manager",
  remove_draft_line: "manager",
  send_po: "manager",
  set_po_expected_on: "manager",
  short_close_po: "manager",
  cancel_po: "manager",
  // Stock control (manager)
  adjust_stock: "manager",
  return_to_supplier: "manager",
  move_out_of_quarantine: "manager",
  // Store (store_keeper)
  mark_arrived: "store_keeper",
  receive_grn: "store_keeper",
  putaway: "store_keeper",
  move_stock: "store_keeper",
  request_bin_count: "store_keeper",
  issue_to_job_card: "store_keeper",
  return_from_job_card: "store_keeper",
  record_emergency_buy: "store_keeper",
  add_job_card_line: "store_keeper",
  // Admin
  reset_demo: "admin",
} as const satisfies Record<string, Role>;

export type ActionKey = keyof typeof ACTIONS;

export function canAccess(role: Role, route: RouteKey): boolean {
  return roleAtLeast(role, ROUTES[route].minRole);
}

export function can(role: Role, action: ActionKey): boolean {
  return roleAtLeast(role, ACTIONS[action]);
}

export type NavItem = { href: RouteKey; label: MessageKey };

export function navFor(role: Role): NavItem[] {
  const items: NavItem[] = [];
  for (const route of Object.keys(ROUTES) as RouteKey[]) {
    const rule: RouteRule = ROUTES[route];
    if (rule.nav && canAccess(role, route)) items.push({ href: route, label: rule.nav });
  }
  return items;
}

/** Home screen per role: managers and admin start on the blocked board, store keepers in the store. */
export function homeFor(role: Role): RouteKey {
  return role === "store_keeper" ? "/store" : "/blocked";
}
