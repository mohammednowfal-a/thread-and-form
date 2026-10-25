export interface InboundEvent {
  kind: "message";
  phoneNumberId: string;
  externalId: string;
  from: string;
  profileName?: string;
  messageType: string;
  text: string;
  buttonId?: string;
}
export interface StatusEvent {
  kind: "status";
  phoneNumberId: string;
  externalId: string;
  messageId: string;
  status: string;
  recipient?: string;
  errorCode?: string;
  errorMessage?: string;
  timestamp?: number;
}
export type WaEvent = InboundEvent | StatusEvent;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** Defensive parser: webhook content is untrusted, so we only extract fields we understand. */
export function parseWebhook(payload: unknown): WaEvent[] {
  const events: WaEvent[] = [];
  if (!isRec(payload)) return events;
  for (const entry of arr(payload.entry)) {
    if (!isRec(entry)) continue;
    for (const change of arr(entry.changes)) {
      if (!isRec(change) || !isRec(change.value)) continue;
      const value = change.value;
      const phoneNumberId = isRec(value.metadata) ? (str(value.metadata.phone_number_id) ?? "") : "";
      const names = new Map<string, string>();
      for (const c of arr(value.contacts)) {
        if (isRec(c) && str(c.wa_id) && isRec(c.profile) && str(c.profile.name)) names.set(c.wa_id as string, c.profile.name as string);
      }
      for (const m of arr(value.messages)) {
        if (!isRec(m)) continue;
        const id = str(m.id);
        const from = str(m.from);
        if (!id || !from) continue;
        const type = str(m.type) ?? "unknown";
        let text = "";
        let buttonId: string | undefined;
        if (type === "text" && isRec(m.text)) text = str(m.text.body) ?? "";
        else if (type === "button" && isRec(m.button)) {
          buttonId = str(m.button.payload);
          text = str(m.button.text) ?? "";
        } else if (type === "interactive" && isRec(m.interactive)) {
          const br = isRec(m.interactive.button_reply) ? m.interactive.button_reply : undefined;
          if (br) {
            buttonId = str(br.id);
            text = str(br.title) ?? "";
          }
        }
        events.push({ kind: "message", phoneNumberId, externalId: id, from, profileName: names.get(from), messageType: type, text: text.slice(0, 1000), buttonId: buttonId?.slice(0, 256) });
      }
      for (const s of arr(value.statuses)) {
        if (!isRec(s)) continue;
        const id = str(s.id);
        const status = str(s.status);
        if (!id || !status) continue;
        const err = arr(s.errors).find(isRec) as Rec | undefined;
        events.push({
          kind: "status", phoneNumberId, externalId: `status:${id}:${status}`, messageId: id, status,
          recipient: str(s.recipient_id), errorCode: err ? String(err.code ?? "") : undefined, errorMessage: err ? (str(err.title) ?? str(err.message)) : undefined,
          timestamp: Number(str(s.timestamp) ?? "") || undefined,
        });
      }
    }
  }
  return events;
}

export const BTN = { CONFIRM: "TF_CONFIRM", CANCEL: "TF_CANCEL", CANCEL_YES: "TF_CANCEL_YES", KEEP: "TF_KEEP" } as const;

export function buttonPayload(action: keyof typeof BTN, ref: string) {
  return `${BTN[action]}:${ref}`;
}
export function parseButtonPayload(id: string | undefined): { action: keyof typeof BTN; ref: string } | null {
  if (!id) return null;
  const m = /^(TF_[A-Z_]+):(TF-[A-Z0-9]{6})$/.exec(id);
  if (!m) return null;
  const action = (Object.keys(BTN) as (keyof typeof BTN)[]).find((k) => BTN[k] === m[1]);
  return action ? { action, ref: m[2] as string } : null;
}
