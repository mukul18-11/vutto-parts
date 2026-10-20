// Money is integer paise everywhere (SPEC §13). Never parseFloat × 100 and never divide paise by 100.

const RUPEES = /^(\d{1,7})(?:\.(\d{1,2}))?$/;

/**
 * Parses a rupee amount typed by a user ('195.5', '1,250', '₹ 99.99') into integer paise.
 * Returns null when the input is not a valid amount or is not greater than zero.
 */
export function rupeesToPaise(input: string): number | null {
  const match = RUPEES.exec(input.replace(/[₹,\s]/g, ""));
  if (!match) return null;
  const [, rupees, fraction = ""] = match;
  const paise = Number(rupees) * 100 + Number(fraction.padEnd(2, "0"));
  return paise > 0 ? paise : null;
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

/** Formats integer paise as Indian rupees, e.g. 12345650 → '₹1,23,456.50'. */
export function formatINR(paise: number): string {
  if (!Number.isSafeInteger(paise)) {
    throw new RangeError(`formatINR expects integer paise, got ${paise}`);
  }
  const abs = Math.abs(paise);
  const rupees = (abs - (abs % 100)) / 100;
  const fraction = String(abs % 100).padStart(2, "0");
  // Intl formats an exact decimal string, so no float ever represents the amount.
  const decimal = `${paise < 0 ? "-" : ""}${rupees}.${fraction}` as `${number}`;
  return inr.format(decimal);
}
