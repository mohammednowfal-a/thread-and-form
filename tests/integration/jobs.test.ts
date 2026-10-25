import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { backoffSeconds, enqueue, replayJob } from "@/lib/jobs";
import { runWorkerTick } from "@/lib/jobHandlers";
import { makeTenant, placeOrder, resetDb } from "./fixtures";

beforeEach(resetDb);
afterEach(() => {
  vi.unstubAllGlobals();
  process.env.WHATSAPP_PHONE_NUMBER_ID = "";
  process.env.WHATSAPP_ACCESS_TOKEN = "";
});

function configureWhatsApp() {
  process.env.WHATSAPP_PHONE_NUMBER_ID = "123456";
  process.env.WHATSAPP_ACCESS_TOKEN = "TEST_TOKEN_VALUE";
}
const msgFor = (orderId: string) => prisma.whatsAppMessage.findFirstOrThrow({ where: { orderId, direction: "OUTBOUND" } });

describe("job queue", () => {
  it("de-duplicates by key", async () => {
    await enqueue(prisma, { type: "X", payload: {}, dedupeKey: "k1" });
    await enqueue(prisma, { type: "X", payload: {}, dedupeKey: "k1" });
    expect(await prisma.job.count()).toBe(1);
  });
  it("backs off exponentially and caps", () => {
    expect([1, 2, 3, 4, 5, 6, 9].map(backoffSeconds)).toEqual([30, 120, 600, 1800, 7200, 21600, 21600]);
  });
  it("unknown job types die immediately instead of retrying forever", async () => {
    await enqueue(prisma, { type: "NOPE", payload: {} });
    await runWorkerTick();
    expect((await prisma.job.findFirstOrThrow()).status).toBe("DEAD");
  });
  it("two workers never run the same job twice", async () => {
    for (let i = 0; i < 8; i++) await enqueue(prisma, { type: "NOPE", payload: {}, dedupeKey: `j${i}` });
    const [a, b] = await Promise.all([runWorkerTick(8), runWorkerTick(8)]);
    expect(a.processed + b.processed).toBe(8);
    expect((await prisma.job.findMany()).every((j) => j.attempts === 1)).toBe(true);
  });
});

describe("WhatsApp COD confirmation job", () => {
  it("not connected: reports it honestly, flags the order for manual review, never claims it was sent", async () => {
    const { tenant, variants } = await makeTenant("tenant-a");
    const { order } = await placeOrder(tenant.id, variants["L-Black"]!.id);
    await runWorkerTick();
    const m = await msgFor(order.id);
    expect(m).toMatchObject({ status: "FAILED", errorCode: "NOT_CONFIGURED", providerMessageId: null });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).confirmationStatus).toBe("MANUAL_REVIEW");
    expect((await prisma.job.findFirstOrThrow({ where: { type: "WA_COD_CONFIRM" } })).status).toBe("DONE");
  });

  it("connected (mocked API): sends the template with order-specific buttons and records the provider id as SENT only", async () => {
    configureWhatsApp();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.PROVIDER1" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { tenant, variants } = await makeTenant("tenant-a");
    const { order } = await placeOrder(tenant.id, variants["L-Black"]!.id);
    await runWorkerTick();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/123456/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TEST_TOKEN_VALUE");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ to: "919876543210", type: "template", template: { name: "cod_order_confirmation" } });
    const comps = body.template.components;
    expect(comps[0].parameters[0].text).toBe(order.publicRef);
    expect(comps[0].parameters[2].text).toBe("₹1,098");
    expect(comps[1].parameters[0].payload).toBe(`TF_CONFIRM:${order.publicRef}`);
    expect(comps[2].parameters[0].payload).toBe(`TF_CANCEL:${order.publicRef}`);

    const m = await msgFor(order.id);
    expect(m).toMatchObject({ status: "SENT", providerMessageId: "wamid.PROVIDER1" });
    expect(m.deliveredAt).toBeNull(); // submitted ≠ delivered
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: "PENDING_CONFIRMATION", confirmationStatus: "AWAITING" });
  });

  it("transient provider errors retry with backoff, without creating duplicate messages", async () => {
    configureWhatsApp();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: 131056, message: "pair rate limit" } }), { status: 429 })));
    const { tenant, variants } = await makeTenant("tenant-a");
    const { order } = await placeOrder(tenant.id, variants["L-Black"]!.id);
    await runWorkerTick();
    const job = await prisma.job.findFirstOrThrow({ where: { type: "WA_COD_CONFIRM" } });
    expect(job).toMatchObject({ status: "PENDING", attempts: 1 });
    expect(job.runAt.getTime()).toBeGreaterThan(Date.now() + 20_000);
    expect(job.lastError).toContain("rate limit");
    await prisma.job.update({ where: { id: job.id }, data: { runAt: new Date() } });

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.RETRY_OK" }] }), { status: 200 })));
    await runWorkerTick();
    expect(await prisma.whatsAppMessage.count({ where: { orderId: order.id, direction: "OUTBOUND" } })).toBe(1);
    expect(await msgFor(order.id)).toMatchObject({ status: "SENT", providerMessageId: "wamid.RETRY_OK" });
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("DONE");
  });

  it("permanent provider errors fail immediately and go to manual review", async () => {
    configureWhatsApp();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: 131026, message: "Message undeliverable" } }), { status: 400 })));
    const { tenant, variants } = await makeTenant("tenant-a");
    const { order } = await placeOrder(tenant.id, variants["L-Black"]!.id);
    await runWorkerTick();
    expect(await msgFor(order.id)).toMatchObject({ status: "FAILED", errorCode: "131026" });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).confirmationStatus).toBe("MANUAL_REVIEW");
  });

  it("gives up after max attempts (dead job, failed message, manual review) and replay is safe", async () => {
    configureWhatsApp();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    const { tenant, variants } = await makeTenant("tenant-a");
    const { order } = await placeOrder(tenant.id, variants["L-Black"]!.id);
    await prisma.job.updateMany({ where: { type: "WA_COD_CONFIRM" }, data: { maxAttempts: 2 } });
    for (let i = 0; i < 2; i++) {
      await runWorkerTick();
      await prisma.job.updateMany({ where: { status: "PENDING" }, data: { runAt: new Date() } });
    }
    const m = await msgFor(order.id);
    expect(m.status).toBe("FAILED");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).confirmationStatus).toBe("MANUAL_REVIEW");
    // a dead job (not this one: it finished cleanly) can be replayed only by its own tenant
    await enqueue(prisma, { tenantId: tenant.id, type: "NOPE", payload: {}, dedupeKey: "dead1" });
    await runWorkerTick();
    const dead = await prisma.job.findFirstOrThrow({ where: { dedupeKey: "dead1" } });
    expect(dead.status).toBe("DEAD");
    const other = await makeTenant("tenant-b");
    expect(await replayJob(other.tenant.id, dead.id)).toBe(false);
    expect(await replayJob(tenant.id, dead.id)).toBe(true);
  });

  it("does not leak the access token into stored errors", async () => {
    configureWhatsApp();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: 190, message: "Invalid OAuth access token" } }), { status: 401 })));
    const { tenant, variants } = await makeTenant("tenant-a");
    await placeOrder(tenant.id, variants["L-Black"]!.id);
    await runWorkerTick();
    const dump = JSON.stringify(await prisma.whatsAppMessage.findMany()) + JSON.stringify(await prisma.job.findMany());
    expect(dump).not.toContain("TEST_TOKEN_VALUE");
  });

  it("inside the 24h window the confirmation goes out as interactive buttons with full order details", async () => {
    configureWhatsApp();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.WIN" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { tenant, variants } = await makeTenant("tenant-a");
    await prisma.whatsAppConversation.create({ data: { tenantId: tenant.id, waId: "919876543210", lastInboundAt: new Date() } });
    await placeOrder(tenant.id, variants["L-Black"]!.id);
    await runWorkerTick();
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.type).toBe("interactive");
    expect(body.interactive.body.text).toContain("Product: Premium Cotton T-Shirt");
    expect(body.interactive.body.text).toContain("Size: L");
    expect(body.interactive.body.text).toContain("Color: Black");
    expect(body.interactive.body.text).toContain("COD amount: ₹1,098");
    expect(body.interactive.action.buttons.map((b: { reply: { title: string } }) => b.reply.title)).toEqual(["Confirm Order", "Cancel Order"]);
  });
});
