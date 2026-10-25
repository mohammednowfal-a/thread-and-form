import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { createCodOrder } from "@/lib/orders";
import { signBody } from "@/lib/whatsapp/signature";
import { POST as webhookPOST } from "@/app/api/webhooks/whatsapp/route";

export async function resetDb() {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename::text AS tablename FROM pg_tables WHERE schemaname = 'public'`;
  const names = rows.map((r) => `"${r.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE ${names} RESTART IDENTITY CASCADE`);
}

export async function makeTenant(slug: string, opts: { stock?: number } = {}) {
  const tenant = await prisma.tenant.create({ data: { slug, name: slug } });
  const category = await prisma.category.create({ data: { tenantId: tenant.id, slug: "tees", name: "T-Shirts" } });
  const product = await prisma.product.create({
    data: {
      tenantId: tenant.id, categoryId: category.id, slug: "premium-cotton-t-shirt", name: "Premium Cotton T-Shirt",
      description: "Heavyweight cotton tee", pricePaise: 99900, comparePricePaise: 129900, sku: `${slug}-TEE`, status: "PUBLISHED",
      searchText: "premium cotton t-shirt tee tshirt",
    },
  });
  const variants: Record<string, { id: string }> = {};
  for (const [size, color, stock] of [["L", "Black", opts.stock ?? 5], ["M", "Black", opts.stock ?? 5], ["S", "White", 0]] as const) {
    const v = await prisma.productVariant.create({
      data: { tenantId: tenant.id, productId: product.id, size, color, sku: `${slug}-TEE-${size}-${color}`, inventory: { create: { tenantId: tenant.id, onHand: stock } } },
    });
    variants[`${size}-${color}`] = v;
  }
  return { tenant, product, variants };
}

export const PHONE = "919876543210";

export async function placeOrder(tenantId: string, variantId: string, over: Partial<{ quantity: number; key: string; phone: string; consent: boolean }> = {}) {
  return createCodOrder({
    tenantId,
    lines: [{ variantId, quantity: over.quantity ?? 1 }],
    contact: { name: "Asha", phone: over.phone ?? PHONE, email: null },
    address: { fullName: "Asha", phone: over.phone ?? PHONE, line1: "12 MG Road", city: "Chennai", state: "Tamil Nadu", pincode: "600001" },
    whatsappConsent: over.consent ?? true,
    idempotencyKey: over.key ?? randomUUID(),
  });
}

export async function sendWebhook(payload: unknown, opts: { secret?: string; sign?: boolean } = {}) {
  const raw = JSON.stringify(payload);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.sign !== false) headers["x-hub-signature-256"] = signBody(raw, opts.secret ?? "test-app-secret");
  const res = await webhookPOST(new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", headers, body: raw }));
  return { status: res.status, json: res.headers.get("content-type")?.includes("json") ? await res.json() : null };
}

let n = 0;
export const inboundText = (from: string, body: string, id = `wamid.in.${++n}.${randomUUID()}`) => ({
  entry: [{ changes: [{ value: { metadata: { phone_number_id: "" }, contacts: [{ wa_id: from, profile: { name: "Asha" } }], messages: [{ id, from, type: "text", text: { body } }] } }] }],
});
export const inboundButton = (from: string, buttonId: string, id = `wamid.btn.${++n}.${randomUUID()}`) => ({
  entry: [{ changes: [{ value: { metadata: { phone_number_id: "" }, messages: [{ id, from, type: "interactive", interactive: { type: "button_reply", button_reply: { id: buttonId, title: "x" } } }] } }] }],
});
export const statusEvent = (messageId: string, status: string, errors?: unknown[]) => ({
  entry: [{ changes: [{ value: { metadata: { phone_number_id: "" }, statuses: [{ id: messageId, status, timestamp: String(Math.floor(Date.now() / 1000)), errors }] } }] }],
});

export async function lastReply(conversationWaId: string, tenantId: string) {
  const conv = await prisma.whatsAppConversation.findUnique({ where: { tenantId_waId: { tenantId, waId: conversationWaId } } });
  if (!conv) return null;
  return prisma.whatsAppMessage.findFirst({ where: { conversationId: conv.id, direction: "OUTBOUND" }, orderBy: { createdAt: "desc" } });
}
