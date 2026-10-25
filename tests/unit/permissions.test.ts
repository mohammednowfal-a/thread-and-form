import { describe, expect, it } from "vitest";
import { assertCan, can, ForbiddenError } from "@/lib/permissions";
import { normalizePhone } from "@/lib/phone";
import { checkoutSchema } from "@/lib/validation";

describe("role permissions", () => {
  it("owner can manage the team, admin cannot", () => {
    expect(can("OWNER", "team.manage")).toBe(true);
    expect(can("ADMIN", "team.manage")).toBe(false);
  });
  it("analyst is read-only", () => {
    expect(can("ANALYST", "orders.read")).toBe(true);
    expect(can("ANALYST", "orders.update")).toBe(false);
    expect(can("ANALYST", "products.write")).toBe(false);
    expect(() => assertCan("ANALYST", "orders.cancel")).toThrow(ForbiddenError);
  });
  it("fulfilment staff cannot edit products, change integrations or see audit logs", () => {
    expect(can("FULFILLMENT", "orders.fulfil")).toBe(true);
    expect(can("FULFILLMENT", "products.write")).toBe(false);
    expect(can("FULFILLMENT", "integrations.manage")).toBe(false);
    expect(can("FULFILLMENT", "audit.read")).toBe(false);
  });
  it("support can cancel orders and use WhatsApp but not edit catalogue", () => {
    expect(can("SUPPORT", "orders.cancel")).toBe(true);
    expect(can("SUPPORT", "whatsapp.manage")).toBe(true);
    expect(can("SUPPORT", "products.write")).toBe(false);
    expect(can("SUPPORT", "team.manage")).toBe(false);
  });
});

describe("phone + checkout validation", () => {
  it("normalises Indian numbers", () => {
    expect(normalizePhone("98765 43210")).toBe("919876543210");
    expect(normalizePhone("+91 98765-43210")).toBe("919876543210");
    expect(normalizePhone("09876543210")).toBe("919876543210");
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("5876543210")).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
  });
  const base = { name: "Asha", phone: "9876543210", line1: "12 MG Road", city: "Chennai", state: "Tamil Nadu", pincode: "600001", whatsappConsent: true, idempotencyKey: "0123456789abcdef0123" };
  it("accepts a valid checkout payload", () => expect(checkoutSchema.safeParse(base).success).toBe(true));
  it("rejects bad pincode, phone and short idempotency key", () => {
    expect(checkoutSchema.safeParse({ ...base, pincode: "12" }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, phone: "123" }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, idempotencyKey: "short" }).success).toBe(false);
  });
});
