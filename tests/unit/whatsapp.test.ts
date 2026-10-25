import { describe, expect, it } from "vitest";
import { signBody, verifySignature } from "@/lib/whatsapp/signature";
import { buttonPayload, parseButtonPayload, parseWebhook } from "@/lib/whatsapp/parse";

describe("webhook signature", () => {
  const body = '{"a":1}';
  it("accepts a correct signature", () => expect(verifySignature(body, signBody(body, "s3cret"), "s3cret")).toBe(true));
  it("rejects wrong secret, tampered body, missing or malformed header", () => {
    expect(verifySignature(body, signBody(body, "other"), "s3cret")).toBe(false);
    expect(verifySignature(body + " ", signBody(body, "s3cret"), "s3cret")).toBe(false);
    expect(verifySignature(body, null, "s3cret")).toBe(false);
    expect(verifySignature(body, "sha256=zzzz", "s3cret")).toBe(false);
    expect(verifySignature(body, "md5=abc", "s3cret")).toBe(false);
    expect(verifySignature(body, signBody(body, "s3cret"), "")).toBe(false);
  });
});

const wrap = (value: unknown) => ({ entry: [{ changes: [{ value }] }] });

describe("webhook parsing", () => {
  it("parses text, button and interactive replies", () => {
    const ev = parseWebhook(wrap({
      metadata: { phone_number_id: "111" },
      contacts: [{ wa_id: "919876543210", profile: { name: "Asha" } }],
      messages: [
        { id: "m1", from: "919876543210", type: "text", text: { body: "Yes" } },
        { id: "m2", from: "919876543210", type: "button", button: { payload: "TF_CONFIRM:TF-AAAAAA", text: "Confirm Order" } },
        { id: "m3", from: "919876543210", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "TF_CANCEL:TF-AAAAAA", title: "Cancel Order" } } },
      ],
    }));
    expect(ev).toHaveLength(3);
    expect(ev[0]).toMatchObject({ kind: "message", text: "Yes", profileName: "Asha", phoneNumberId: "111" });
    expect(ev[1]).toMatchObject({ buttonId: "TF_CONFIRM:TF-AAAAAA" });
    expect(ev[2]).toMatchObject({ buttonId: "TF_CANCEL:TF-AAAAAA" });
  });
  it("parses statuses with errors", () => {
    const ev = parseWebhook(wrap({ metadata: { phone_number_id: "1" }, statuses: [{ id: "w1", status: "failed", timestamp: "1700000000", errors: [{ code: 131026, title: "Undeliverable" }] }] }));
    expect(ev[0]).toMatchObject({ kind: "status", messageId: "w1", status: "failed", errorCode: "131026" });
  });
  it("ignores garbage safely", () => {
    for (const bad of [null, 5, "x", [], {}, { entry: "no" }, { entry: [null, { changes: [{ value: { messages: [{ nope: 1 }] } }] }] }]) {
      expect(parseWebhook(bad)).toEqual([]);
    }
  });
  it("round-trips button payloads and rejects forged ones", () => {
    expect(parseButtonPayload(buttonPayload("CONFIRM", "TF-ABC234"))).toEqual({ action: "CONFIRM", ref: "TF-ABC234" });
    expect(parseButtonPayload("TF_CONFIRM:'; DROP TABLE")).toBeNull();
    expect(parseButtonPayload("TF_HACK:TF-ABC234")).toBeNull();
    expect(parseButtonPayload(undefined)).toBeNull();
  });
});
