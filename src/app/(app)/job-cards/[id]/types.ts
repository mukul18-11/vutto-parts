// Props shared by the job card page (server) and its client components. Quantities and fit
// data come from the database as loaded; nothing here computes stock numbers.
import type { Database } from "@/lib/database.types";

type Enums = Database["public"]["Enums"];
type Fns = Database["public"]["Functions"];

export type Candidate = Fns["line_candidates"]["Returns"][number];
export type FindingCandidate = Fns["finding_candidates"]["Returns"][number];
export type FitBadgeRow = Fns["fit_badge"]["Returns"][number];

export type CardView = {
  id: string;
  workshop_id: string;
  workshop_code: string;
  code: string;
  status: Enums["job_card_status"];
  needed_by: string | null;
  needs_review_reason: string | null;
  bike_id: string;
  reg_no: string;
  bike_status: Enums["bike_status"];
  variant_id: string | null;
  /** "Hero Splendor Plus BS6 Self Alloy i3S 2021" for the amber fit message. */
  bike_label: string;
  /** Another open (draft/confirmed) card on this bike, when this one is cancelled. */
  open_card_id: string | null;
};

export type LineView = {
  id: string;
  part_id: string;
  sku: string;
  name: string;
  name_hi: string | null;
  uom: Enums["uom"];
  is_universal: boolean;
  qty_required: number;
  qty_reserved: number;
  qty_issued: number;
  qty_returned: number;
  status: Enums["line_status"];
  source: Enums["line_source"];
  cancelled: boolean;
  fit: FitBadgeRow | null;
  eta: { eta_status: string | null; po_code: string | null; expected_on: string | null; is_overdue: boolean | null } | null;
  candidates: Candidate[];
  holders: Holder[];
};

export type Holder = {
  line_id: string;
  card_code: string;
  reg_no: string;
  bike_status: Enums["bike_status"];
  qty_reserved: number;
  blocked: boolean;
};

export type FindingView = {
  id: string;
  code: string;
  label: string;
  area: Enums["finding_area"];
  qty: number | null;
  notes: string | null;
  line_id: string | null;
  line_sku: string | null;
  no_part_reason: string | null;
  part_type: string | null;
  candidates: FindingCandidate[];
};
