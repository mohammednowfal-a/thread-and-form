/*
 * End-to-end journey through the REAL server actions and database (no browser).
 * Only Next.js request plumbing (cookies/headers/redirect/revalidate) is simulated.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => void jar.set(n, v),
    delete: (n: string) => void jar.delete(n),
  }),
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { orderToken, verifyOrderToken } from "@/lib/orderAccess";
import { runWorkerTick } from "@/lib/jobHandlers";
import { getOrder, listOrders } from "@/lib/admin/queries";
import { addToCart, forgotPasswordAction, loginAction, placeOrderAction, registerAction, resetPasswordAction, trackAction } from "@/app/(shop)/actions";
import { addShipment, adjustStock, loginStaffAction, resendConfirmation, saveProduct, updateOrderStatus } from "@/app/admin/actions";
import { buttonPayload } from "@/lib/whatsapp/parse";
import { inboundButton, makeTenant, PHONE, resetDb, sendWebhook } from "./fixtures";

async function redirectOf(fn: () => Promise<unknown>): Promise<string | null> {
  try { await fn(); return null; } catch (e) {
    const d = (e as { digest?: string }).digest;
    if (typeof d === "string" && d.startsWith("NEXT_REDIRECT")) return d.split(";")[2] ?? null;
    throw e;
  }
}
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

const checkoutForm = (key: string, over: Record<string, string> = {}) => fd({
  name: "Asha Raman", phone: "98765 43210", email: "", line1: "12 MG Road", city: "Chennai", state: "Tamil Nadu", pincode: "600001",
  paymentMethod: "COD", whatsappConsent: "on", idempotencyKey: key, ...over,
});

async function staff(tenantId: string, email: string, role: "OWNER" | "SUPPORT" | "ANALYST" | "FULFILLMENT", pw = "StaffPass12345") {
  const u = await prisma.user.create({ data: { email, name: email, passwordHash: await hashPassword(pw) } });
  await prisma.membership.create({ data: { userId: u.id, tenantId, role } });
  return u;
}
async function loginAs(email: string, pw = "StaffPass12345") {
  jar.delete("tf_staff");
  expect(await redirectOf(() => loginStaffAction({}, fd({ email, password: pw })))).toBe("/admin");
}

beforeEach(async () => { await resetDb(); jar.clear(); });

describe("customer journey: browse → cart → COD checkout → WhatsApp → admin", () => {
  it("runs end to end with correct database state at every step", async () => {
    const { tenant, variants } = await makeTenant("tenant-a");
    const other = await makeTenant("tenant-b");
    await staff(tenant.id, "owner@a.test", "OWNER");

    // cart: tampered inputs are clamped/rejected
    expect(await redirectOf(() => addToCart(fd({ variantId: variants["L-Black"]!.id, quantity: "-5" })))).toBe("/cart");
    expect((await prisma.cartItem.findFirstOrThrow()).quantity).toBe(1);
    expect(await redirectOf(() => addToCart(fd({ variantId: variants["L-Black"]!.id, quantity: "999" })))).toBe("/cart");
    expect((await prisma.cartItem.findFirstOrThrow()).quantity).toBe(5); // capped by stock (5), never 999
    expect(await redirectOf(() => addToCart(fd({ variantId: other.variants["L-Black"]!.id, quantity: "1" })))).toBe("/shop"); // other tenant's variant
    expect(await redirectOf(() => addToCart(fd({ variantId: variants["S-White"]!.id, quantity: "1" })))).toMatch(/error=soldout/);
    expect(await prisma.cartItem.count()).toBe(1);
    await redirectOf(() => addToCart(fd({ variantId: variants["M-Black"]!.id, quantity: "1" })));
    expect(await prisma.cartItem.count()).toBe(2);

    // checkout: the browser's claimed total is ignored; the server prices the order
    const key = "journey-key-0123456789abcdef";
    const dest = await redirectOf(() => placeOrderAction({}, checkoutForm(key, { total: "1", price: "1" })));
    expect(dest).toMatch(/^\/order\/TF-[A-Z0-9]{6}\?t=/);
    const order = await prisma.order.findFirstOrThrow({ include: { items: true } });
    expect(order.contactPhone).toBe("919876543210");
    expect(order.subtotalPaise).toBe(6 * 99900);
    expect(order.totalPaise).toBe(6 * 99900); // above free-shipping threshold
    expect(order.paymentMethod).toBe("COD");
    expect(order.items).toHaveLength(2);
    expect(await prisma.cartItem.count()).toBe(0);
    expect((await prisma.inventoryRecord.findUniqueOrThrow({ where: { variantId: variants["L-Black"]!.id } })).reserved).toBe(5);
    expect(await prisma.job.count({ where: { type: "WA_COD_CONFIRM" } })).toBe(1);

    // double submit with the same key does not create a second order
    expect(await redirectOf(() => placeOrderAction({}, checkoutForm(key)))).toBe(dest);
    expect(await prisma.order.count()).toBe(1);

    // guest access token: right one works, wrong one doesn't
    const token = new URL(dest!, "http://x").searchParams.get("t")!;
    expect(verifyOrderToken(order.id, token)).toBe(true);
    expect(verifyOrderToken(order.id, "x".repeat(32))).toBe(false);
    expect(token).toBe(orderToken(order.id));

    // tracking: same generic error for wrong phone; right details succeed
    const bad = await trackAction({}, fd({ ref: order.publicRef, phone: "9000000000" }));
    expect(bad.error).toMatch(/couldn't find/i);
    expect(await redirectOf(() => trackAction({}, fd({ ref: order.publicRef, phone: "+91 98765 43210" })))).toContain(`/order/${order.publicRef}?t=`);

    // WhatsApp: connected (mock provider) → confirmation request sent, order NOT confirmed by sending
    process.env.WHATSAPP_PHONE_NUMBER_ID = "999";
    process.env.WHATSAPP_ACCESS_TOKEN = "tok";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.J1" }] }), { status: 200 })));
    await runWorkerTick();
    expect((await prisma.whatsAppMessage.findFirstOrThrow({ where: { orderId: order.id } })).status).toBe("SENT");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING_CONFIRMATION");
    vi.unstubAllGlobals();
    process.env.WHATSAPP_PHONE_NUMBER_ID = "";
    process.env.WHATSAPP_ACCESS_TOKEN = "";

    // customer taps Confirm in WhatsApp
    await sendWebhook(inboundButton(PHONE, buttonPayload("CONFIRM", order.publicRef)));
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("CONFIRMED");

    // staff fulfil it through the admin
    await loginAs("owner@a.test");
    const step = (to: string) => redirectOf(() => updateOrderStatus(fd({ orderId: order.id, to })));
    expect(await step("SHIPPED")).toMatch(/error=/); // can't skip PROCESSING/PACKED
    await step("PROCESSING"); await step("PACKED");
    expect(await redirectOf(() => addShipment(fd({ orderId: order.id, provider: "manual", trackingNumber: "x" })))).toMatch(/error=/);
    expect(await redirectOf(() => addShipment(fd({ orderId: order.id, provider: "shiprocket", trackingNumber: "" })))).toMatch(/not%20connected|not connected/i);
    expect(await prisma.shipment.count()).toBe(0); // no fake tracking numbers
    await redirectOf(() => addShipment(fd({ orderId: order.id, provider: "manual", trackingNumber: "DL1234567890" })));
    expect((await prisma.shipment.findFirstOrThrow()).trackingNumber).toBe("DL1234567890");
    await step("SHIPPED");
    expect(await prisma.inventoryRecord.findUniqueOrThrow({ where: { variantId: variants["L-Black"]!.id } })).toMatchObject({ onHand: 0, reserved: 0 });
    expect(await step("CANCELLED")).toMatch(/error=/); // shipped orders can't be cancelled
    await step("DELIVERED");
    const done = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(done).toMatchObject({ status: "DELIVERED", paymentStatus: "COLLECTED" });
    expect(await prisma.auditLog.count({ where: { tenantId: tenant.id, action: "order.status" } })).toBeGreaterThanOrEqual(4);

    // dashboard data reflects it
    const { overview } = await import("@/lib/admin/queries");
    const o = await overview(tenant.id);
    expect(o.collectedPaise).toBe(6 * 99900);
    expect(o.byStatus.DELIVERED).toBe(1);
  });
});

describe("authorization", () => {
  it("unauthenticated requests are redirected to staff login", async () => {
    const { tenant, variants } = await makeTenant("tenant-a");
    const { placeOrder } = await import("./fixtures");
    const { order } = await placeOrder(tenant.id, variants["L-Black"]!.id);
    expect(await redirectOf(() => updateOrderStatus(fd({ orderId: order.id, to: "CANCELLED" })))).toBe("/admin/login");
    expect(await redirectOf(() => adjustStock(fd({ variantId: variants["L-Black"]!.id, onHand: "99" })))).toBe("/admin/login");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING_CONFIRMATION");
  });

  it("wrong password and disabled accounts cannot sign in; failures are rate limited", async () => {
    const { tenant } = await makeTenant("tenant-a");
    const u = await staff(tenant.id, "x@a.test", "OWNER");
    expect((await loginStaffAction({}, fd({ email: "x@a.test", password: "nope" }))).error).toMatch(/incorrect/i);
    expect((await loginStaffAction({}, fd({ email: "nobody@a.test", password: "nope" }))).error).toMatch(/incorrect/i); // same message
    await prisma.user.update({ where: { id: u.id }, data: { disabledAt: new Date() } });
    expect((await loginStaffAction({}, fd({ email: "x@a.test", password: "StaffPass12345" }))).error).toMatch(/incorrect/i);
    let limited = false;
    for (let i = 0; i < 10; i++) if ((await loginStaffAction({}, fd({ email: "x@a.test", password: "bad" }))).error?.includes("Too many")) limited = true;
    expect(limited).toBe(true);
  });

  it("server enforces roles even if the UI is bypassed", async () => {
    const { tenant, variants, product } = await makeTenant("tenant-a");
    const { placeOrder } = await import("./fixtures");
    const { order } = await placeOrder(tenant.id, variants["L-Black"]!.id);
    await staff(tenant.id, "support@a.test", "SUPPORT");
    await staff(tenant.id, "analyst@a.test", "ANALYST");
    await staff(tenant.id, "pack@a.test", "FULFILLMENT");

    await loginAs("analyst@a.test");
    await expect(updateOrderStatus(fd({ orderId: order.id, to: "CANCELLED" }))).rejects.toThrow(/permission/i);
    await expect(adjustStock(fd({ variantId: variants["L-Black"]!.id, onHand: "50" }))).rejects.toThrow(/permission/i);
    expect((await saveProduct({}, fd({ id: product.id, name: "Hacked" }))).error).toMatch(/permission/i);

    await loginAs("pack@a.test");
    await expect(updateOrderStatus(fd({ orderId: order.id, to: "CANCELLED" }))).rejects.toThrow(/permission/i); // fulfilment can't cancel
    await expect(updateOrderStatus(fd({ orderId: order.id, to: "CONFIRMED" }))).rejects.toThrow(/permission/i);

    await loginAs("support@a.test");
    await expect(adjustStock(fd({ variantId: variants["L-Black"]!.id, onHand: "50" }))).rejects.toThrow(/permission/i);
    expect(await redirectOf(() => updateOrderStatus(fd({ orderId: order.id, to: "CANCELLED", note: "customer asked" })))).toBe(`/admin/orders/${order.id}`);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("CANCELLED");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).name).toBe("Premium Cotton T-Shirt");
  });

  it("stock can't be adjusted below what open orders have reserved", async () => {
    const { tenant, variants } = await makeTenant("tenant-a");
    const { placeOrder } = await import("./fixtures");
    await placeOrder(tenant.id, variants["L-Black"]!.id, { quantity: 3 });
    await staff(tenant.id, "o@a.test", "OWNER");
    await loginAs("o@a.test");
    expect(await redirectOf(() => adjustStock(fd({ variantId: variants["L-Black"]!.id, onHand: "2" })))).toMatch(/error=/);
    expect((await prisma.inventoryRecord.findUniqueOrThrow({ where: { variantId: variants["L-Black"]!.id } })).onHand).toBe(5);
    await redirectOf(() => adjustStock(fd({ variantId: variants["L-Black"]!.id, onHand: "9", reason: "restock" })));
    expect((await prisma.inventoryRecord.findUniqueOrThrow({ where: { variantId: variants["L-Black"]!.id } })).onHand).toBe(9);
  });
});

describe("tenant isolation in the admin", () => {
  it("staff of tenant B cannot read or modify tenant A's data through queries or actions", async () => {
    const a = await makeTenant("tenant-a");
    const b = await makeTenant("tenant-b");
    const { placeOrder } = await import("./fixtures");
    const { order } = await placeOrder(a.tenant.id, a.variants["L-Black"]!.id);
    await staff(b.tenant.id, "owner@b.test", "OWNER");
    await loginAs("owner@b.test");

    expect(await getOrder(b.tenant.id, order.id)).toBeNull();
    expect((await listOrders(b.tenant.id, {})).items).toHaveLength(0);
    await expect(updateOrderStatus(fd({ orderId: order.id, to: "CANCELLED", note: "x" }))).rejects.toThrow(/not found/i);
    expect(await redirectOf(() => resendConfirmation(fd({ orderId: order.id })))).toMatch(/error=/);
    expect(await redirectOf(() => adjustStock(fd({ variantId: a.variants["L-Black"]!.id, onHand: "0" })))).toMatch(/Variant%20not%20found/); // refused, never writes
    expect((await prisma.inventoryRecord.findUniqueOrThrow({ where: { variantId: a.variants["L-Black"]!.id } })).onHand).toBe(5);
    expect((await saveProduct({}, fd({ id: a.product.id, name: "Stolen", slug: "stolen", sku: "S1", categoryId: b.product.categoryId, description: "d", price: "1", status: "PUBLISHED" }))).error).toMatch(/not found/i);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: a.product.id } })).name).toBe("Premium Cotton T-Shirt");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING_CONFIRMATION");
  });

  it("a staff member's tenant comes from verified membership, never from the request", async () => {
    const a = await makeTenant("tenant-a");
    await makeTenant("tenant-b");
    await staff(a.tenant.id, "owner@a.test", "OWNER");
    await loginAs("owner@a.test");
    const { getStaff } = await import("@/lib/auth");
    expect((await getStaff())?.tenantId).toBe(a.tenant.id);
  });
});

describe("customer accounts", () => {
  it("registers, signs in, and password reset revokes old sessions", async () => {
    const { tenant } = await makeTenant("tenant-a");
    expect(await redirectOf(() => registerAction({}, fd({ name: "Asha", email: "Asha@Example.com", password: "weak" })))).toBeNull(); // rejected, no redirect
    expect(await prisma.customer.count()).toBe(0);
    expect(await redirectOf(() => registerAction({}, fd({ name: "Asha", email: "Asha@Example.com", password: "GoodPassw0rd!" })))).toBe("/account");
    const c = await prisma.customer.findFirstOrThrow();
    expect(c.email).toBe("asha@example.com");
    expect(c.passwordHash).not.toContain("GoodPassw0rd");
    expect((await registerAction({}, fd({ name: "Dup", email: "asha@example.com", password: "GoodPassw0rd!" }))).error).toBeTruthy();

    jar.delete("tf_customer");
    expect((await loginAction({}, fd({ email: "asha@example.com", password: "wrong-password" }))).error).toMatch(/incorrect/i);
    expect(await redirectOf(() => loginAction({}, fd({ email: "asha@example.com", password: "GoodPassw0rd!" })))).toBe("/account");
    expect(await prisma.customerSession.count({ where: { revokedAt: null } })).toBeGreaterThan(0);

    expect((await forgotPasswordAction({}, fd({ email: "asha@example.com" }))).ok).toMatch(/if that email/i);
    expect((await forgotPasswordAction({}, fd({ email: "ghost@example.com" }))).ok).toMatch(/if that email/i); // same response
    const job = await prisma.job.findFirstOrThrow({ where: { type: "EMAIL_PASSWORD_RESET" } });
    const resetToken = new URL((job.payload as { url: string }).url).searchParams.get("token")!;
    expect(await prisma.job.count({ where: { type: "EMAIL_PASSWORD_RESET" } })).toBe(1);

    expect(await redirectOf(() => resetPasswordAction({}, fd({ token: resetToken, password: "BrandNew12345" })))).toBe("/login?reset=1");
    expect(await prisma.customerSession.count({ where: { revokedAt: null } })).toBe(0); // all sessions ended
    expect((await resetPasswordAction({}, fd({ token: resetToken, password: "AnotherOne12345" }))).error).toMatch(/invalid or has expired/i); // single use
    jar.delete("tf_customer");
    expect(await redirectOf(() => loginAction({}, fd({ email: "asha@example.com", password: "BrandNew12345" })))).toBe("/account");
    expect(tenant.id).toBeTruthy();
  });
});
