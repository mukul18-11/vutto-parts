// Pure helpers for the purchasing and receiving screens. Money is integer paise (SPEC §13).

/** SPEC §7.4: a GRN price that differs from the PO price by 5% or more shows as a variance. */
export function priceVariance(poPaise: number | null, invoicePaise: number | null): boolean {
  if (poPaise == null || invoicePaise == null || poPaise <= 0) return false;
  return Math.abs(invoicePaise - poPaise) * 100 >= poPaise * 5;
}

/** Accepted units on a GRN line (the server computes the same; shown before posting). */
export function acceptedQty(received: number | null, damaged: number, wrongPart: number): number | null {
  if (received == null) return null;
  return received - damaged - wrongPart;
}

/**
 * wa.me link that opens WhatsApp with the PO text. A 10-digit Indian number gets the 91 prefix;
 * without a usable phone the link lets the user pick the chat.
 */
export function whatsappUrl(phone: string | null | undefined, text: string): string {
  let digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  const target = digits.length >= 11 && digits.length <= 15 ? digits : "";
  return `https://wa.me/${target}?text=${encodeURIComponent(text)}`;
}
