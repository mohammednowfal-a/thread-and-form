import { env } from "../env";

export type EmailResult = { sent: true } | { sent: false; reason: "NOT_CONNECTED" };

export function emailConfigured(): boolean {
  return Boolean(env("EMAIL_API_KEY") && env("EMAIL_FROM"));
}

/** Resend-compatible HTTP API. When not configured we report that honestly instead of pretending to send. */
export async function sendEmail(to: string, subject: string, text: string): Promise<EmailResult> {
  if (!emailConfigured()) return { sent: false, reason: "NOT_CONNECTED" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("EMAIL_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env("EMAIL_FROM"), to: [to], subject, text }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Email provider error ${res.status}`);
  return { sent: true };
}
