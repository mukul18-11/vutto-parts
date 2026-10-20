// Internal links keep the admin's workshop (?ws=NCR) so workshop-scoped screens stay on it.

/** href plus ?ws=<code> (or &ws=) for admin; unchanged for everyone else. */
export function withWs(href: string, role: string, workshopCode: string): string {
  if (role !== "admin") return href;
  const sep = href.includes("?") ? "&" : "?";
  return `${href}${sep}ws=${encodeURIComponent(workshopCode)}`;
}
