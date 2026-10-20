import type { Database } from "@/lib/database.types";

type Enums = Database["public"]["Enums"];
export type EnumName = keyof Enums;
/** Every value of every Postgres enum must have a label (a missing value fails typecheck). */
export type EnumLabels = { [E in EnumName]: Record<Enums[E], string> };

const enums: EnumLabels = {
  app_role: { store_keeper: "Store keeper", manager: "Manager", admin: "Admin" },
  bike_status: {
    purchased: "Purchased",
    at_workshop: "At workshop",
    in_repair: "In repair",
    ready: "Ready",
    cancelled: "Cancelled",
  },
  bin_kind: { normal: "Normal", receiving: "Receiving", quarantine: "Quarantine" },
  brake_type: { drum: "Drum", disc: "Disc" },
  doc_type: { job_card: "Job card", po: "Purchase order", grn: "Goods receipt" },
  emergency_reason: {
    no_stock: "No stock",
    supplier_late: "Supplier late",
    wrong_part_received: "Wrong part received",
    other: "Other",
  },
  emission_norm: { bs3: "BS3", bs4: "BS4", bs6: "BS6", bs6_obd2: "BS6 OBD2", bs6_obd2b: "BS6 OBD2B" },
  finding_area: {
    engine: "Engine",
    brakes: "Brakes",
    drivetrain: "Drivetrain",
    electrical: "Electrical",
    body: "Body",
    tyres_suspension: "Tyres and suspension",
  },
  fitment_source: { catalogue: "Catalogue", learned: "Learned" },
  fuel_system: { carb: "Carburettor", fi: "Fuel injection", ei: "Electronic injection" },
  job_card_status: { draft: "Draft", confirmed: "Confirmed", closed: "Closed", cancelled: "Cancelled" },
  line_source: { suggested: "Suggested", manual: "Manual", extra: "Extra" },
  line_status: {
    needed: "Needed",
    partially_reserved: "Partly reserved",
    reserved: "Reserved",
    issued: "Issued",
    cancelled: "Cancelled",
  },
  move_type: {
    grn: "Goods receipt",
    putaway: "Putaway",
    move: "Move",
    issue: "Issue",
    return_to_stock: "Return to stock",
    return_to_quarantine: "Return to quarantine",
    return_to_supplier: "Return to supplier",
    adjust_in: "Adjust in",
    adjust_out: "Adjust out",
    emergency_in: "Emergency buy",
  },
  part_category: { consumable: "Consumable", wear: "Wear", model_specific: "Model specific" },
  po_line_source: { suggested: "Suggested", manual: "Manual" },
  po_status: {
    draft: "Draft",
    sent: "Sent",
    partially_received: "Partly received",
    received: "Received",
    closed: "Closed",
    cancelled: "Cancelled",
  },
  start_type: { kick: "Kick", self: "Self", kick_self: "Kick and self" },
  supplier_kind: { oem_dealer: "OEM dealer", wholesaler: "Wholesaler", local_market: "Local market" },
  uom: { pcs: "pcs", set: "set", pair: "pair", bottle: "bottle", kit: "kit" },
  vehicle_segment: { motorcycle: "Motorcycle", scooter: "Scooter", moped: "Moped" },
  wheel_type: { spoke: "Spoke", alloy: "Alloy", steel: "Steel" },
};

// Not `as const`: values stay `string`, so hi (typed as Dictionary) can hold different text.
export const en = {
  common: {
    appName: "Vutto Parts",
    signOut: "Sign out",
    cancel: "Cancel",
    retry: "Retry",
    reload: "Reload",
    loading: "Loading…",
    asOf: "as of {time} IST",
    inclGst: "per unit, incl. GST",
    decrease: "Decrease",
    increase: "Increase",
    comingSoon: "This screen is being built.",
    simulated: "Simulated",
  },
  login: {
    title: "Sign in",
    subtitle: "Sign in to your workshop.",
    email: "Email",
    password: "Password",
    submit: "Sign in",
    wrongPassword: "Wrong email or password.",
    demoHeading: "Demo logins",
    demoNote: "Shared demo accounts. Credentials are restored automatically every 30 minutes.",
    demoPasswordChanged:
      "Another visitor changed this demo password. It is restored within 30 minutes; try another role meanwhile.",
    signInAs: "Sign in as {name}",
    failed: "Sign-in failed. Try again.",
    demo: {
      admin: "Admin",
      ncr_manager: "NCR Manager",
      ncr_store: "NCR Store keeper",
      jpr_manager: "Jaipur Manager",
      jpr_store: "Jaipur Store keeper",
    },
  },
  nav: {
    blocked: "Blocked bikes",
    store: "Store",
  },
  header: {
    workshop: "Workshop",
    // The toggle shows the other language.
    switchLanguage: "हिंदी",
    switchLanguageLabel: "Switch to Hindi",
    menu: "Menu",
  },
  footer: {
    simulated: "Simulated demo data · refreshed {date} · times in IST",
    notSeeded: "Simulated demo data · times in IST",
    schema: "schema {version}",
    commit: "commit {sha}",
  },
  access: {
    forbiddenTitle: "Not available for your role",
    forbiddenBody: "Your role cannot open this screen.",
    goHome: "Go to your home screen",
    noAccessTitle: "No workshop access",
    noAccessBody: "Your account has no profile yet, so it cannot open any screen. Ask an admin to add you.",
  },
  pages: {
    blocked: "Blocked bikes",
    store: "Store",
  },
  rpcForm: {
    notConfirmed: "Not confirmed – Retry",
    notConfirmedHint: "We could not confirm the save. Your entries are kept; tap Retry.",
    appUpdated: "App was updated – Reload",
    offline: "You are offline. Submitting is paused until the connection is back.",
    earlierSaved: "Your earlier submit was saved",
    saving: "Saving…",
  },
  validation: {
    invalid: "This value is not valid.",
    required: "Required.",
    integer: "Enter a whole number.",
    qtyRange: "Enter a whole number from {min} to {max}.",
    money: "Enter an amount like 195.50.",
    tooLong: "Too long.",
  },
  enums,
};

export type Dictionary = typeof en;
