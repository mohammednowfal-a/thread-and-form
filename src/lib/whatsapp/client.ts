import { waConfig } from "./config";

export class WhatsAppProviderError extends Error {
  constructor(message: string, public retryable: boolean, public code?: string) {
    super(message);
  }
}

// Meta error codes worth retrying (rate limit / transient). Everything else is treated as permanent.
const RETRYABLE_CODES = new Set(["1", "2", "4", "17", "80007", "130429", "131016", "131056", "133016"]);

async function post(body: Record<string, unknown>): Promise<{ messageId: string }> {
  const c = waConfig();
  if (!c.configured) throw new WhatsAppProviderError("WhatsApp is not connected", false, "NOT_CONFIGURED");
  let res: Response;
  try {
    res = await fetch(`https://graph.facebook.com/${c.apiVersion}/${c.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${c.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...body }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new WhatsAppProviderError("Network error contacting WhatsApp", true, "NETWORK");
  }
  const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { code?: number; message?: string } };
  if (!res.ok || !json.messages?.[0]?.id) {
    const code = String(json.error?.code ?? res.status);
    const retryable = res.status >= 500 || res.status === 429 || RETRYABLE_CODES.has(code);
    // Never include the access token or full payload in the error.
    throw new WhatsAppProviderError(json.error?.message?.slice(0, 200) ?? `WhatsApp API error ${res.status}`, retryable, code);
  }
  return { messageId: json.messages[0].id };
}

/** WhatsApp template parameters cannot contain newlines/tabs or long runs of spaces. */
export function cleanParam(s: string): string {
  return s.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, 900);
}

export function sendText(to: string, body: string) {
  return post({ to, type: "text", text: { body: body.slice(0, 4000), preview_url: false } });
}

export function sendTemplate(to: string, name: string, language: string, bodyParams: string[], quickReplyPayloads: string[] = []) {
  const components: Record<string, unknown>[] = [
    { type: "body", parameters: bodyParams.map((t) => ({ type: "text", text: cleanParam(t) })) },
    ...quickReplyPayloads.map((payload, index) => ({ type: "button", sub_type: "quick_reply", index: String(index), parameters: [{ type: "payload", payload }] })),
  ];
  return post({ to, type: "template", template: { name, language: { code: language }, components } });
}

export function sendButtons(to: string, body: string, buttons: { id: string; title: string }[]) {
  return post({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body.slice(0, 1024) },
      action: { buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) } })) },
    },
  });
}
