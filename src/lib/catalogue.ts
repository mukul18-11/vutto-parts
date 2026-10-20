// Master data shapes shared by the catalogue forms and actions (SPEC §3.1).
import { Constants } from "@/lib/database.types";

const E = Constants.public.Enums;

/** finding_type_parts.attr_key values and the enum each one's attr_value comes from. */
export const ATTR_VALUES = {
  segment: E.vehicle_segment,
  brake_front: E.brake_type,
  brake_rear: E.brake_type,
  start_type: E.start_type,
  wheels: E.wheel_type,
  emission: E.emission_norm,
  fuel: E.fuel_system,
} as const;

export type AttrKey = keyof typeof ATTR_VALUES;
export const ATTR_KEYS = Object.keys(ATTR_VALUES) as [AttrKey, ...AttrKey[]];

/** The enum used to label an attr_key's values (enums.<name>.<value>). */
export const ATTR_ENUM = {
  segment: "vehicle_segment",
  brake_front: "brake_type",
  brake_rear: "brake_type",
  start_type: "start_type",
  wheels: "wheel_type",
  emission: "emission_norm",
  fuel: "fuel_system",
} as const;
