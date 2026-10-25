import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { purgeOldData } from "@/lib/jobHandlers";
import { transitionOrder } from "@/lib/orders";
import { POST as shipWebhook } from "@/app/api/webhooks/shipping/[provider]/route";
import { makeTenant, placeOrder, resetDb } from "./fixtures";

beforeEach(resetDb);

const call = (provider: string, body: unknown, token?: string) =>
  shipWebhook(new Request("http://x/api/webhooks/shipping/" + provider, { method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-webhook-token": token } : {}) }, body: JSON.stringify(body) }), { params: Promise.resolve({ provider }) });

describe("courier webhook", () => {
  async function packedWithShipment() {
    const { tenant, variants } = await makeTenant("tenant-a");
    const { order } = await placeOrder(tenant.id, variants["L-Black"]!.id);
    for (const to of ["CONFIRMED", "PROCESSING", "PACKED"] as const) await transitionOrder({ tenantId: tenant.id, orderId: order.id, to, source: "t" });
    await prisma.shipment.create({ data: { tenantId: tenant.id, orderId: order.id, provider: "shiprocket", trackingNumber: "AWB1234567" } });
    return order;
  }
  it("is disabled until its token is configured, and rejects bad tokens", async () => {
    delete process.env.SHIPROCKET_WEBHOOK_TOKEN;
    expect((await call("shiprocket", {}, "x")).status).toBe(404);
    process.env.SHIPROCKET_WEBHOOK_TOKEN = "ship-secret";
    expect((await call("shiprocket", { awb: "AWB1234567", status: "Delivered" })).status).toBe(401);
    expect((await call("shiprocket", { awb: "AWB1234567", status: "Delivered" }, "wrong")).status).toBe(401);
    expect((await call("unknown", {}, "ship-secret")).status).toBe(404);
  });
  it("moves the order along, ignores duplicates and out-of-order events", async () => {
    process.env.SHIPROCKET_WEBHOOK_TOKEN = "ship-secret";
    const order = await packedWithShipment();
    const st = async () => (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status;
    await call("shiprocket", { awb: "AWB1234567", current_status: "In Transit" }, "ship-secret");
    expect(await st()).toBe("SHIPPED");
    await call("shiprocket", { awb: "AWB1234567", current_status: "Delivered" }, "ship-secret");
    await call("shiprocket", { awb: "AWB1234567", current_status: "Delivered" }, "ship-secret"); // duplicate
    await call("shiprocket", { awb: "AWB1234567", current_status: "In Transit" }, "ship-secret"); // late event
    expect(await st()).toBe("DELIVERED");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe("COLLECTED");
    expect((await call("shiprocket", { awb: "NOPE", status: "Delivered" }, "ship-secret")).status).toBe(200); // unknown AWB ignored
  });
});

describe("data retention", () => {
  it("purges old logs, expired sessions and rate-limit buckets but keeps recent data and all orders", async () => {
    const { tenant, variants } = await makeTenant("tenant-a");
    await placeOrder(tenant.id, variants["L-Black"]!.id);
    const old = new Date(Date.now() - 40 * 86400_000);
    await prisma.webhookEvent.create({ data: { provider: "whatsapp", externalId: "old", payload: {}, status: "PROCESSED", receivedAt: old } });
    await prisma.webhookEvent.create({ data: { provider: "whatsapp", externalId: "old-failed", payload: {}, status: "FAILED", receivedAt: old } });
    await prisma.webhookEvent.create({ data: { provider: "whatsapp", externalId: "new", payload: {}, status: "PROCESSED" } });
    await prisma.rateLimitBucket.create({ data: { key: "expired", count: 1, resetAt: new Date(Date.now() - 1000) } });
    await prisma.rateLimitBucket.create({ data: { key: "live", count: 1, resetAt: new Date(Date.now() + 60000) } });
    await purgeOldData();
    const ids = (await prisma.webhookEvent.findMany()).map((e) => e.externalId).sort();
    expect(ids).toEqual(["new", "old-failed"]); // failed events are kept for replay
    expect((await prisma.rateLimitBucket.findMany()).map((b) => b.key)).toEqual(["live"]);
    expect(await prisma.order.count()).toBe(1);
  });
});
