// Sends a correctly SIGNED fake WhatsApp inbound message to your local webhook, for development without Meta.
//   node scripts/simulate-whatsapp.mjs 919876543210 "Yes, I confirm"
//   node scripts/simulate-whatsapp.mjs 919876543210 --button TF_CONFIRM:TF-ABC234
// Reads WHATSAPP_APP_SECRET and WHATSAPP_PHONE_NUMBER_ID from the environment or .env. Test traffic only.
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

if (existsSync(".env")) for (const l of readFileSync(".env", "utf8").split("\n")) { const m = /^([A-Z_]+)="?(.*?)"?$/.exec(l.trim()); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
const [from, a, b] = process.argv.slice(2);
if (!from || !a) { console.error('usage: simulate-whatsapp.mjs <waId> "<text>" | --button <payload>'); process.exit(1); }
const secret = process.env.WHATSAPP_APP_SECRET;
if (!secret) { console.error("WHATSAPP_APP_SECRET is not set"); process.exit(1); }
const id = `wamid.sim.${randomUUID()}`;
const message = a === "--button"
  ? { id, from, type: "interactive", interactive: { type: "button_reply", button_reply: { id: b, title: "button" } } }
  : { id, from, type: "text", text: { body: a } };
const body = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "" }, contacts: [{ wa_id: from, profile: { name: "Simulated" } }], messages: [message] } }] }] });
const sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
const url = (process.env.APP_URL ?? "http://localhost:3000") + "/api/webhooks/whatsapp";
const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sig }, body });
console.log(res.status, await res.text());
