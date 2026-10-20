import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACTIONS,
  ROLES,
  ROUTES,
  can,
  canAccess,
  homeFor,
  navFor,
  roleAtLeast,
  type ActionKey,
  type Role,
  type RouteKey,
} from "@/lib/permissions";

const allowlist: string[] = JSON.parse(readFileSync("tests/db/rpc-allowlist.json", "utf8"));
// Read functions and exempt RPCs (SPEC §11.1): guarded by RLS / their own checks, not by ACTIONS.
const NOT_ACTIONS = new Set([
  "health",
  "log_app_error",
  "reseed_if_stale_service",
  "search_parts",
  "dead_stock",
  "finding_candidates",
  "fit_badge",
  "kpis",
  "line_candidates",
  "part_candidates",
  "part_waits",
  "reorder_suggestions",
  "stock_ledger",
  "blocked_board_kpis",
  "job_card_history",
]);
// ACTIONS keys that are a variant of an RPC rather than an RPC name.
const DERIVED_ACTIONS = new Set(["move_out_of_quarantine"]);

describe("roles", () => {
  it("are ordered store_keeper < manager < admin", () => {
    expect(ROLES).toEqual(["store_keeper", "manager", "admin"]);
    expect(roleAtLeast("admin", "manager")).toBe(true);
    expect(roleAtLeast("manager", "manager")).toBe(true);
    expect(roleAtLeast("store_keeper", "manager")).toBe(false);
  });

  it("send managers and admin home to /blocked and store keepers to /store", () => {
    expect(homeFor("admin")).toBe("/blocked");
    expect(homeFor("manager")).toBe("/blocked");
    expect(homeFor("store_keeper")).toBe("/store");
  });

  it("every home route is accessible to its role", () => {
    for (const role of ROLES) expect(canAccess(role, homeFor(role))).toBe(true);
  });
});

describe("routes", () => {
  const matrix: Record<RouteKey, Record<Role, boolean>> = {
    "/blocked": { store_keeper: false, manager: true, admin: true },
    "/bikes": { store_keeper: false, manager: true, admin: true },
    "/job-cards": { store_keeper: false, manager: true, admin: true },
    "/store": { store_keeper: true, manager: true, admin: true },
    "/catalogue": { store_keeper: true, manager: true, admin: true },
    "/bins/labels": { store_keeper: true, manager: true, admin: true },
  };
  // Detail-only routes are reached by links and have no navigation entry.
  const DETAIL_ONLY = new Set<RouteKey>(["/job-cards", "/bins/labels"]);

  it("match the expected matrix", () => {
    expect(Object.keys(ROUTES).sort()).toEqual(Object.keys(matrix).sort());
    for (const route of Object.keys(matrix) as RouteKey[]) {
      for (const role of ROLES) expect(canAccess(role, route), `${role} ${route}`).toBe(matrix[route][role]);
    }
  });

  it("navigation lists exactly the accessible routes", () => {
    for (const role of ROLES) {
      const hrefs = navFor(role).map((item) => item.href);
      expect(hrefs).toEqual(
        (Object.keys(ROUTES) as RouteKey[]).filter((r) => canAccess(role, r) && !DETAIL_ONLY.has(r)),
      );
    }
    expect(navFor("store_keeper").map((i) => i.href)).toEqual(["/store", "/catalogue"]);
    expect(navFor("manager").map((i) => i.href)).toEqual(["/blocked", "/bikes", "/store", "/catalogue"]);
  });
});

describe("actions", () => {
  it("name only real RPCs", () => {
    for (const action of Object.keys(ACTIONS)) {
      if (DERIVED_ACTIONS.has(action)) continue;
      expect(allowlist, action).toContain(action);
    }
  });

  it("cover every mutating RPC in the allowlist", () => {
    const mutating = allowlist.filter((fn) => !NOT_ACTIONS.has(fn));
    expect(Object.keys(ACTIONS).filter((a) => !DERIVED_ACTIONS.has(a)).sort()).toEqual(mutating.sort());
  });

  it("use valid roles, with higher roles inheriting lower ones", () => {
    for (const [action, min] of Object.entries(ACTIONS) as [ActionKey, Role][]) {
      expect(ROLES).toContain(min);
      expect(can("admin", action)).toBe(true);
      if (can("store_keeper", action)) expect(can("manager", action)).toBe(true);
    }
  });

  it("match SPEC §2 for representative actions", () => {
    expect(can("store_keeper", "issue_to_job_card")).toBe(true);
    expect(can("store_keeper", "receive_grn")).toBe(true);
    expect(can("store_keeper", "add_job_card_line")).toBe(true);
    expect(can("store_keeper", "send_po")).toBe(false);
    expect(can("store_keeper", "move_out_of_quarantine")).toBe(false);
    expect(can("manager", "confirm_job_card")).toBe(true);
    expect(can("manager", "reset_demo")).toBe(false);
    expect(can("admin", "reset_demo")).toBe(true);
  });
});
