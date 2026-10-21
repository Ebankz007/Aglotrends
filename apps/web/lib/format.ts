/** Format integer cents as a USD string: 123456 → "$1,234.56". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Format integer cents with an explicit currency code.
 *  123456, "USD" → "$1,234.56"   123456, "USDT" → "1,234.56 USDT" */
export function formatCurrency(cents: number, currency = "USD"): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const value = (abs / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const code = (currency || "USD").toUpperCase();
  if (code === "USD") return `${sign}$${value}`;
  return `${sign}${value} ${code}`;
}

/** Format a date as "Sep 25, 2026". Date-only strings (YYYY-MM-DD) are parsed
 *  as local midnight so they don't slip a day in negative-offset timezones. */
export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date =
    typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)
      ? new Date(`${d}T00:00:00`)
      : new Date(d);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Format a date+time as "Sep 25, 2026, 14:03". */
export function formatDateTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Percent from bps: 1000 → "10%". */
export function formatBps(bps: number): string {
  return `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

/** Short id for display: first 8 chars, uppercased. */
export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8).toUpperCase() : "—";
}
