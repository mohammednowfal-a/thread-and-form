/** Normalises a phone number to digits-only E.164 without "+" (the format WhatsApp uses as wa_id). */
export function normalizePhone(input: string, defaultCountryCode = "91"): string | null {
  let d = input.replace(/[^\d]/g, "");
  if (!d) return null;
  if (input.trim().startsWith("00")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) {
    if (defaultCountryCode === "91" && !/^[6-9]/.test(d)) return null;
    d = defaultCountryCode + d;
  }
  if (d.length < 11 || d.length > 15) return null;
  if (d.startsWith("91") && d.length === 12 && !/^[6-9]/.test(d.slice(2))) return null;
  return d;
}

export function maskPhone(p: string): string {
  return p.length <= 4 ? "****" : `${"*".repeat(p.length - 4)}${p.slice(-4)}`;
}
