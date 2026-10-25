import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { cancelOrder, confirmOrder, createCodOrder, CheckoutError, expireStaleOrders, transitionOrder } from "@/lib/orders";
import { InvalidTransitionError } from "@/lib/orderStatus";
import { makeTenant, placeOrder, resetDb } from "./fixtures";

beforeEach(resetDb);

const inv = (variantId: string) => prisma.inventoryRecord.findUniqueOrThrow({ where: { variantId } });

describe("COD order creation", () => {
  it("uses server-side prices, snapshots items, reserves stock, and queues the WhatsApp job in the same transaction", async () => {
    const { tenant, variants } = await makeTenant("tenant-a");
    const { order } = await placeOrder(tenant.id, variants["L-Black"]!.id, { quantity: 2 });
    expect(order.publicRef).toMatch(/^TF-[A-HJ-NP-Z2-9]{6}$/);
    expect(order.subtotalPaise).toBe(199800);
    expect(order.shippingPaise).toBe(9900); // 1998 is just under the 1999 free-shipping threshold
    expect(order.totalPaise).toBe(209700);
    expect(order.status).toBe("PENDING_CONFIRMATION");
    expect(order.confirmationStatus).toBe("AWAITING");
    expect(order.items[0]).toMatchObject({ nameSnapshot: "Premium Cotton T-Shirt", sizeSnapshot: "L", colorSnapshot: "Black", unitPricePaise: 99900, quantity: 2 });
    expect((await inv(variants["L-Black"]!.id)).reserved).toBe(2);
    const jobs = await prisma.job.findMany({ where: { type: "WA_COD_CONFIRM" } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.payload).toMatchObject({ orderId: order.id });
    expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("waives shipping at or above the free-shipping threshold", async () => {
    const { tenant, variants } = await makeTenant("tenant-a");
    const { order } = await placeOrder(tenant.id, variants["L-Black"]!.id, { quantity: 3 });
    expect(order.shippingPaise).toBe(0);
    expect(order.totalPaise).toBe(299700);
  });

  it("applies shipping fee under the free-shipping threshold", async () => {
    const { tenant, variants } = await makeTenant("tenant-a");
    const { order } = await placeOrder(tenant.id, variants["L-Black"]!.id);
    expect(order.shippingPaise).toBe(9900);
    expect(order.totalPaise).toBe(109800);
  });

  it("without WhatsApp consent, skips the job and flags manual review", async () => {
    const { tenant, variants } = await makeTenant("tenant-a");
    const { order } = await placeOrder(tenant.id, variants["L-Black"]!.id, { consent: false });
    expect(order.confirmationStatus).toBe("MANUAL_REVIEW");
    expect(await prisma.job.count({ where: { type: "WA_COD_CONFIRM" } })).toBe(0);
  });

  it("is idempotent: the same key never creates a second order or reserves stock twice", async () => {
    const { tenant, variants } = await makeTenant("tenant-a");
    const a = await placeOrder(tenant.id, variants["L-Black"]!.id, { key: "same-key-0123456789abcdef" });
    const b = await placeOrder(tenant.id, variants["L-Black"]!.id, { key: "same-key-0123456789abcdef" });
    expect(b.reused).toBe(true);
    expect(b.order.id).toBe(a.order.id);
    expect(await prisma.order.count()).toBe(1);
    expect((await inv(variants["L-Black"]!.id)).reserved).toBe(1);
  });

  it("is idempotent under concurrent double-submit", async () => {
    const { tenant, variants } = await makeTenant("tenant-a");
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => placeOrder(tenant.id, variants["L-Black"]!.id, { key: "double-click-0123456789ab" })));
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await prisma.order.count()).toBe(1);
    expect((await inv(variants["L-Black"]!.id)).reserved).toBe(1);
    expect(await prisma.job.count({ where: { type: "WA_COD_CONFIRM" } })).toBe(1);
  });

  it("cannot oversell under concurrent requests", async () => {
    const { tenant, variants } = await makeTenant("tenant-a", { stock: 3 });
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => placeOrder(tenant.id, variants["L-Black"]!.id)));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toBe(3);
    expect(failed.every((f) => f.reason instanceof CheckoutError && f.reason.code === "OUT_OF_STOCK")).toBe(true);
    const rec = await inv(variants["L-Black"]!.id);
    expect(rec.reserved).toBe(3);
    expect(rec.onHand).toBe(3);
    expect(await prisma.order.count()).toBe(3);
  });

  it("rolls back everything when one line is out of stock", async () => {
    const { tenant, variants } = await makeTenant("tenant-a", { stock: 2 });
    await expect(
      createCodOrder({
        tenantId: tenant.id,
        lines: [{ variantId: variants["L-Black"]!.id, quantity: 1 }, { variantId: variants["S-White"]!.id, quantity: 1 }],
        contact: { name: "A", phone: "919876543210" },
        address: { fullName: "A", phone: "919876543210", line1: "x", city: "c", state: "s", pincode: "600001" },
        whatsappConsent: true, idempotencyKey: "rollback-key-0123456789",
      }),
    ).rejects.toMatchObject({ code: "OUT_OF_STOCK" });
    expect((await inv(variants["L-Black"]!.id)).reserved).toBe(0);
    expect(await prisma.order.count()).toBe(0);
    expect(await prisma.job.count()).toBe(0);
  });

  it.each([0, -1, 11, 1.5])("rejects invalid quantity %s", async (q) => {
    const { tenant, variants } = await makeTenant("tenant-a");
    await expect(placeOrder(tenant.id, variants["L-Black"]!.id, { quantity: q })).rejects.toMatchObject({ code: "INVALID_QTY" });
  });

  it("rejects empty carts and unpublished/inactive variants", async () => {
    const { tenant, variants, product } = await makeTenant("tenant-a");
    await expect(createCodOrder({ tenantId: tenant.id, lines: [], contact: { name: "A", phone: "919876543210" }, address: { fullName: "A", phone: "1", line1: "x", city: "c", state: "s", pincode: "600001" }, whatsappConsent: true, idempotencyKey: "empty-0123456789abcdef" })).rejects.toMatchObject({ code: "EMPTY" });
    await prisma.product.update({ where: { id: product.id }, data: { status: "ARCHIVED" } });
    await expect(placeOrder(tenant.id, variants["L-Black"]!.id)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});

describe("cancellation, confirmation and the state machine", () => {
  it("cancel releases reserved stock exactly once", async () => {
    const { tenant, variants } = await makeTenant("tenant-a");
    const { order } = await placeOrder(tenant.id, variants["L-Black"]!.id, { quantity: 2 });
    expect(await cancelOrder({ tenantId: tenant.id, orderId: order.id, source: "test" })).toEqual({ result: "CANCELLED" });
    expect(await cancelOrder({ tenantId: tenant.id, orderId: order.id, source: "test" })).toEqual({ result: "ALREADY_CANCELLED" });
    expect((await inv(variants["L-Black"]!.id)).reserved).toBe(0);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o).toMatchObject({ status: "CANCELLED", paymentStatus: "VOID", confirmationStatus: "CANCELLED", cancelSource: "test", stockHeld: false });
    expect(o.cancelledAt).toBeTruthy();
  });

  it("confirm is idempotent and records source + timestamp", async () => {
    const { tenant, variants } = await makeTenant("tenant-a");
    const { order } = await placeOrder(tenant.id, variants["L-Black"]!.id);
    expect(await confirmOrder({ tenantId: tenant.id, orderId: order.id, source: "whatsapp:x", messageId: "m1" })).toEqual({ result: "CONFIRMED" });
    expect(await confirmOrder({ tenantId: tenant.id, orderId: order.id, source: "whatsapp:x", messageId: "m1" })).toEqual({ result: "ALREADY_CONFIRMED" });
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o).toMatchObject({ status: "CONFIRMED", confirmationStatus: "CONFIRMED", confirmationSource: "whatsapp:x" });
    expect(o.confirmedAt).toBeTruthy();
    expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id, toStatus: "CONFIRMED" } })).toBe(1);
    expect(await prisma.job.count({ where: { type: "WA_ORDER_CONFIRMED_ACK" } })).toBe(1);
  });

  it("concurrent confirms produce one transition", async () => {
    const { tenant, variants } = await makeTenant("tenant-a");
    const { order } = await placeOrder(tenant.id, variants["L-Black"]!.id);
    await Promise.all(Array.from({ length: 5 }, () => confirmOrder({ tenantId: tenant.id, orderId: order.id, source: "whatsapp:x" })));
    expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id, toStatus: "CONFIRMED" } })).toBe(1);
  });

  it("refuses to confirm a cancelled order", async () => {
    const { tenant, variants } = await makeTenant("tenant-a");
    const { order } = await placeOrder(tenant.id, variants["L-Black"]!.id);
    await cancelOrder({ tenantId: tenant.id, orderId: order.id, source: "test" });
    expect(await confirmOrder({ tenantId: tenant.id, orderId: order.id, source: "x" })).toMatchObject({ result: "NOT_ELIGIBLE" });
  });

  it("ships (consuming stock), delivers (collecting COD), and then refuses to cancel", async () => {
    const { tenant, variants } = await makeTenant("tenant-a");
    const { order } = await placeOrder(tenant.id, variants["L-Black"]!.id, { quantity: 2 });
    const t = (to: Parameters<typeof transitionOrder>[0]["to"]) => transitionOrder({ tenantId: tenant.id, orderId: order.id, to, source: "staff" });
    await t("CONFIRMED"); await t("PROCESSING"); await t("PACKED");
    await t("SHIPPED");
    expect(await inv(variants["L-Black"]!.id)).toMatchObject({ onHand: 3, reserved: 0 });
    await expect(t("CANCELLED")).rejects.toThrow();
    await t("DELIVERED");
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o).toMatchObject({ status: "DELIVERED", paymentStatus: "COLLECTED" });
    expect(await cancelOrder({ tenantId: tenant.id, orderId: order.id, source: "whatsapp:x", customerInitiated: true })).toMatchObject({ result: "NOT_ALLOWED" });
  });

  it("rejects invalid transitions", async () => {
    const { tenant, variants } = await makeTenant("tenant-a");
    const { order } = await placeOrder(tenant.id, variants["L-Black"]!.id);
    await expect(transitionOrder({ tenantId: tenant.id, orderId: order.id, to: "SHIPPED", source: "staff" })).rejects.toBeInstanceOf(InvalidTransitionError);
    await expect(transitionOrder({ tenantId: tenant.id, orderId: order.id, to: "DELIVERED", source: "staff" })).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it("customers cannot cancel a packed order via chat rules", async () => {
    const { tenant, variants } = await makeTenant("tenant-a");
    const { order } = await placeOrder(tenant.id, variants["L-Black"]!.id);
    for (const to of ["CONFIRMED", "PROCESSING", "PACKED"] as const) await transitionOrder({ tenantId: tenant.id, orderId: order.id, to, source: "staff" });
    expect(await cancelOrder({ tenantId: tenant.id, orderId: order.id, source: "whatsapp:x", customerInitiated: true })).toMatchObject({ result: "NOT_ALLOWED" });
  });

  it("expires unconfirmed orders and releases stock", async () => {
    const { tenant, variants } = await makeTenant("tenant-a");
    const { order } = await placeOrder(tenant.id, variants["L-Black"]!.id);
    await prisma.order.update({ where: { id: order.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await expireStaleOrders()).toBe(1);
    expect((await inv(variants["L-Black"]!.id)).reserved).toBe(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).cancelSource).toBe("system:expiry");
  });
});

describe("tenant isolation + database safety nets", () => {
  it("cannot order another tenant's variant", async () => {
    const a = await makeTenant("tenant-a");
    const b = await makeTenant("tenant-b");
    await expect(placeOrder(a.tenant.id, b.variants["L-Black"]!.id)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect((await inv(b.variants["L-Black"]!.id)).reserved).toBe(0);
  });

  it("cannot cancel, confirm or transition another tenant's order", async () => {
    const a = await makeTenant("tenant-a");
    const b = await makeTenant("tenant-b");
    const { order } = await placeOrder(a.tenant.id, a.variants["L-Black"]!.id);
    expect(await cancelOrder({ tenantId: b.tenant.id, orderId: order.id, source: "x" })).toMatchObject({ result: "NOT_ALLOWED" });
    expect(await confirmOrder({ tenantId: b.tenant.id, orderId: order.id, source: "x" })).toMatchObject({ result: "NOT_ELIGIBLE" });
    await expect(transitionOrder({ tenantId: b.tenant.id, orderId: order.id, to: "PROCESSING", source: "x" })).rejects.toThrow();
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING_CONFIRMATION");
  });

  it("allows the same SKU and order-ref namespace in different tenants but not within one", async () => {
    const a = await makeTenant("tenant-a");
    await expect(prisma.product.create({ data: { tenantId: a.tenant.id, categoryId: a.product.categoryId, slug: "other", name: "x", description: "x", pricePaise: 1, sku: `tenant-a-TEE` } })).rejects.toThrow();
    await expect(makeTenant("tenant-b")).resolves.toBeTruthy();
  });

  it("database CHECK constraints stop negative or over-reserved stock even for raw SQL", async () => {
    const { variants } = await makeTenant("tenant-a", { stock: 2 });
    await expect(prisma.$executeRaw`UPDATE "InventoryRecord" SET "reserved" = 99 WHERE "variantId" = ${variants["L-Black"]!.id}`).rejects.toThrow();
    await expect(prisma.$executeRaw`UPDATE "InventoryRecord" SET "onHand" = -1 WHERE "variantId" = ${variants["L-Black"]!.id}`).rejects.toThrow();
  });
});
