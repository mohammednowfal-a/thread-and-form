import type { Order, OrderItem, Tenant, WhatsAppConversation } from "@prisma/client";
import { prisma } from "../db";
import { confirmOrder, cancelOrder } from "../orders";
import { CUSTOMER_CANCELLABLE, STATUS_LABEL } from "../orderStatus";
import { formatMoney } from "../money";
import { POLICY } from "../policies";
import { availableOf } from "../inventory";
import { aiClassify, type AiIntent } from "./ai";
import { classifyReply, extractOrderRef, isOptIn, isOptOut } from "./intent";
import { buttonPayload, parseButtonPayload, type InboundEvent } from "./parse";
import { queueReply } from "./outbound";

type Ctx = {
  lastProductId?: string;
  pending?: { type: "CHOOSE_ORDER"; intent: "CONFIRM" | "CANCEL"; at: number } | { type: "CANCEL_CONFIRM"; ref: string; at: number };
};
const PENDING_TTL_MS = 30 * 60_000;

type OrderFull = Order & { items: OrderItem[] };

export async function handleInbound(p: { tenant: Tenant; conv: WhatsAppConversation; ev: InboundEvent }): Promise<void> {
  const { tenant, conv, ev } = p;
  const waId = conv.waId;
  const say = (body: string, opts?: { orderId?: string; buttons?: { id: string; title: string }[] }) => queueReply(tenant.id, conv.id, body, opts);
  const ctx: Ctx = (conv.pendingAction as Ctx | null) ?? {};
  const saveCtx = (c: Ctx) => prisma.whatsAppConversation.update({ where: { id: conv.id }, data: { pendingAction: c as object } });
  const text = ev.text.trim();

  // --- Consent management first -------------------------------------------------
  if (isOptOut(text)) {
    await prisma.$transaction([
      prisma.whatsAppConversation.update({ where: { id: conv.id }, data: { optedOutAt: new Date() } }),
      prisma.order.updateMany({
        where: { tenantId: tenant.id, contactPhone: waId, status: "PENDING_CONFIRMATION", confirmationStatus: "AWAITING" },
        data: { confirmationStatus: "MANUAL_REVIEW" },
      }),
    ]);
    await say("You are unsubscribed from THREAD & FORM messages on WhatsApp. Our team will contact you by phone about any pending order. Reply START to turn messages back on.");
    return;
  }
  if (isOptIn(text)) {
    await prisma.whatsAppConversation.update({ where: { id: conv.id }, data: { optedOutAt: null } });
    await say("Welcome back! You will receive order updates from THREAD & FORM on WhatsApp again.");
    return;
  }
  if (conv.optedOutAt) return; // respect opt-out: no further automated replies

  // --- Button taps (explicit, order-specific) ----------------------------------
  const btn = parseButtonPayload(ev.buttonId);
  if (btn) {
    const order = await findOwnedOrder(tenant.id, waId, btn.ref);
    if (!order) return say("I could not find that order for this WhatsApp number. Please contact support if you think this is a mistake.");
    if (btn.action === "CONFIRM") return doConfirm(order);
    if (btn.action === "CANCEL" || btn.action === "CANCEL_YES") return doCancel(order);
    if (btn.action === "KEEP") {
      await saveCtx({ ...ctx, pending: undefined });
      return say(`No problem, order ${order.publicRef} stays on hold. Tap below when you are ready.`, { orderId: order.id, buttons: confirmButtons(order.publicRef) });
    }
  }

  if (ev.messageType !== "text") {
    return say("I can read text messages and the Confirm / Cancel buttons. Please type your question, or send 'help'.");
  }

  const ref = extractOrderRef(text);
  const pending = ctx.pending && Date.now() - ctx.pending.at < PENDING_TTL_MS ? ctx.pending : undefined;

  // --- Awaiting a "cancel? yes/no" answer ---------------------------------------
  if (pending?.type === "CANCEL_CONFIRM") {
    const order = await findOwnedOrder(tenant.id, waId, pending.ref);
    const t = text.toLowerCase();
    if (order && /^(yes|y|yeah|yep|cancel|cancel it|yes cancel|yes, cancel)\b/.test(t)) return doCancel(order);
    if (order && /^(no|n|nope|keep|don'?t cancel|do not cancel)\b/.test(t)) {
      await saveCtx({ ...ctx, pending: undefined });
      return say(`Okay, order ${order.publicRef} is not cancelled.`, { orderId: order.id, buttons: confirmButtons(order.publicRef) });
    }
    if (order) {
      return say(`Do you want to cancel order ${order.publicRef}?`, { orderId: order.id, buttons: [{ id: buttonPayload("CANCEL_YES", order.publicRef), title: "Yes, cancel" }, { id: buttonPayload("KEEP", order.publicRef), title: "Keep order" }] });
    }
  }

  // --- Confirm / cancel by free text -------------------------------------------
  let intent = classifyReply(text);
  if (intent === "OTHER" && ref && pending?.type === "CHOOSE_ORDER") intent = pending.intent;

  if (intent === "CONFIRM" || intent === "CANCEL" || intent === "AMBIGUOUS") {
    const eligible = await eligibleOrders(tenant.id, waId);
    const named = ref ? eligible.find((o) => o.publicRef === ref) : undefined;

    if (ref && !named) {
      const other = await findOwnedOrder(tenant.id, waId, ref);
      if (!other) return say(`I could not find order ${ref} for this WhatsApp number.`);
      return say(`Order ${other.publicRef} is currently: ${STATUS_LABEL[other.status]}. It is not waiting for confirmation.`);
    }
    if (eligible.length === 0 && intent !== "AMBIGUOUS") {
      return say("You have no orders waiting for confirmation right now. Ask me 'where is my order?' for the latest status.");
    }
    if (eligible.length === 0) return answerQuestion(tenant, conv, text, ctx, say, saveCtx);

    const target = named ?? (eligible.length === 1 ? eligible[0] : undefined);
    if (!target) {
      await saveCtx({ ...ctx, pending: { type: "CHOOSE_ORDER", intent: intent === "CANCEL" ? "CANCEL" : "CONFIRM", at: Date.now() } });
      const list = eligible.slice(0, 5).map((o) => `${o.publicRef} - ${formatMoney(o.totalPaise, o.currency)}`).join("\n");
      return say(`You have ${eligible.length} orders waiting for confirmation:\n${list}\n\nWhich one do you mean? Reply with the order number, for example "confirm ${eligible[0]?.publicRef}".`);
    }
    if (intent === "CONFIRM") return doConfirm(target);
    if (intent === "CANCEL") {
      await saveCtx({ ...ctx, pending: { type: "CANCEL_CONFIRM", ref: target.publicRef, at: Date.now() } });
      return say(`Just to be sure: cancel order ${target.publicRef} (${formatMoney(target.totalPaise, target.currency)})?`, {
        orderId: target.id,
        buttons: [{ id: buttonPayload("CANCEL_YES", target.publicRef), title: "Yes, cancel" }, { id: buttonPayload("KEEP", target.publicRef), title: "Keep order" }],
      });
    }
    return say(`I want to be sure I understood. Do you want to confirm order ${target.publicRef} for ${formatMoney(target.totalPaise, target.currency)} (pay on delivery)?`, { orderId: target.id, buttons: confirmButtons(target.publicRef) });
  }

  return answerQuestion(tenant, conv, text, ctx, say, saveCtx);

  // ------------------------------------------------------------------------------
  async function doConfirm(order: OrderFull) {
    const r = await confirmOrder({ tenantId: tenant.id, orderId: order.id, source: `whatsapp:${waId}`, messageId: ev.externalId });
    await saveCtx({ ...ctx, pending: undefined });
    if (r.result === "CONFIRMED") return; // the acknowledgement is queued by confirmOrder's transaction
    if (r.result === "ALREADY_CONFIRMED") return say(`Order ${order.publicRef} is already confirmed. Thank you!`);
    await prisma.order.updateMany({ where: { id: order.id, tenantId: tenant.id, status: "PENDING_CONFIRMATION" }, data: { confirmationStatus: "MANUAL_REVIEW" } });
    return say(`I could not confirm order ${order.publicRef} automatically (${r.reason}). Our team will contact you shortly.`);
  }

  async function doCancel(order: OrderFull) {
    await saveCtx({ ...ctx, pending: undefined });
    if (!CUSTOMER_CANCELLABLE.includes(order.status) && order.status !== "CANCELLED") {
      return say(`Order ${order.publicRef} is already ${STATUS_LABEL[order.status].toLowerCase()}, so I cannot cancel it here. Our support team will help you: ${tenant.supportEmail ?? "please reply to this chat"}.`);
    }
    const r = await cancelOrder({ tenantId: tenant.id, orderId: order.id, source: `whatsapp:${waId}`, reason: "Cancelled by customer on WhatsApp", customerInitiated: true });
    if (r.result === "ALREADY_CANCELLED") return say(`Order ${order.publicRef} is already cancelled.`);
    if (r.result === "NOT_ALLOWED") return say(`I cannot cancel order ${order.publicRef}: ${r.reason}. Our team will follow up.`);
  }
}

const confirmButtons = (ref: string) => [
  { id: buttonPayload("CONFIRM", ref), title: "Confirm Order" },
  { id: buttonPayload("CANCEL", ref), title: "Cancel Order" },
];

/** Ownership check: the WhatsApp sender number must equal the phone on the order. */
async function findOwnedOrder(tenantId: string, waId: string, ref: string): Promise<OrderFull | null> {
  return prisma.order.findFirst({ where: { tenantId, publicRef: ref, contactPhone: waId }, include: { items: true } });
}

async function eligibleOrders(tenantId: string, waId: string): Promise<OrderFull[]> {
  return prisma.order.findMany({
    where: { tenantId, contactPhone: waId, status: "PENDING_CONFIRMATION", confirmationStatus: "AWAITING", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    include: { items: true },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
}

/* ------------------------------ Q&A ------------------------------ */

const STOP = new Set(["the", "is", "it", "this", "that", "are", "you", "have", "has", "what", "how", "much", "does", "do", "can", "available", "price", "cost", "size", "sizes", "color", "colour", "colors", "colours", "stock", "in", "for", "of", "and", "a", "an", "to", "me", "my", "i", "pls", "please", "hi", "hello", "hey", "your", "there", "any", "with", "on", "cod", "shirt?"]);
const SIZE_RE = /\b(xxl|xl|xs|m|l)\b|\bsize\s+(s)\b/i;

type Say = (body: string, opts?: { orderId?: string; buttons?: { id: string; title: string }[] }) => Promise<void>;

async function answerQuestion(tenant: Tenant, conv: WhatsAppConversation, text: string, ctx: Ctx, say: Say, saveCtx: (c: Ctx) => Promise<unknown>): Promise<void> {
  const t = text.toLowerCase();
  let topic: AiIntent["intent"] | null = null;
  if (/\b(where|track|tracking|status|parcel|package)\b/.test(t) && /\b(order|parcel|package|delivery|shipment)\b/.test(t)) topic = "ORDER_STATUS";
  else if (/\b(cod|cash on delivery|pay (on|after) delivery)\b/.test(t)) topic = "COD";
  else if (/\b(return|refund|exchange)\b/.test(t)) topic = "RETURNS";
  else if (/\b(shipping|delivery time|how long|deliver)\b/.test(t)) topic = "SHIPPING";
  else if (/\b(price|cost|how much|rate|mrp)\b/.test(t)) topic = "PRICE";
  else if (SIZE_RE.test(text) || /\b(available|in stock|stock|have)\b/.test(t)) topic = "AVAILABILITY";
  else if (/\b(sizes?|colou?rs?)\b/.test(t)) topic = "SIZES_COLORS";

  let aiQuery: string | null | undefined;
  if (!topic) {
    const ai = await aiClassify(text);
    if (ai && ai.intent !== "OTHER") {
      topic = ai.intent;
      aiQuery = ai.productQuery;
    }
  }
  if (!topic) {
    return say(`Hi! I'm the THREAD & FORM assistant. I can help with prices, sizes, colours, stock, Cash on Delivery, shipping, returns and your order status. What would you like to know?${tenant.supportEmail ? `\n\nFor anything else: ${tenant.supportEmail}` : ""}`);
  }

  if (topic === "ORDER_STATUS") return orderStatusReply(tenant, conv.waId, text, say);
  if (topic === "COD") return say(`${POLICY.codAvailability} Orders above ${formatMoney(tenant.codMaxTotalPaise, tenant.currency)} need support approval. ${POLICY.codConfirmation}`);
  if (topic === "RETURNS") return say(`${POLICY.returnsSummary} ${POLICY.cancellation}`);
  if (topic === "SHIPPING") {
    return say(`Delivery takes ${POLICY.deliveryDaysMin}-${POLICY.deliveryDaysMax} business days. Shipping is ${formatMoney(tenant.shippingFeePaise, tenant.currency)}, free on orders of ${formatMoney(tenant.freeShippingThresholdPaise, tenant.currency)} or more.`);
  }

  // Product-specific topics
  const product = await resolveProduct(tenant.id, aiQuery ?? text, ctx.lastProductId);
  if (product.kind === "none") {
    const popular = await prisma.product.findMany({ where: { tenantId: tenant.id, status: "PUBLISHED" }, orderBy: [{ isFeatured: "desc" }, { createdAt: "desc" }], take: 3, select: { name: true } });
    return say(`Which product do you mean? ${popular.length ? `For example: ${popular.map((p) => p.name).join(", ")}.` : ""} Send the product name and I'll check.`);
  }
  if (product.kind === "many") {
    return say(`I found a few matches: ${product.names.join(", ")}. Which one do you mean?`);
  }
  const p = product.product;
  await saveCtx({ ...ctx, lastProductId: p.id });
  const cur = (n: number) => formatMoney(n, tenant.currency);
  const variants = p.variants.filter((v) => v.active);
  const price = `${p.name} is ${cur(p.pricePaise)}${p.comparePricePaise ? ` (was ${cur(p.comparePricePaise)})` : ""}.`;

  if (topic === "PRICE") return say(price);
  if (topic === "SIZES_COLORS") {
    const sizes = [...new Set(variants.map((v) => v.size))];
    const colors = [...new Set(variants.map((v) => v.color))];
    return say(`${p.name} comes in sizes ${sizes.join(", ")} and colours ${colors.join(", ")}.`);
  }
  // AVAILABILITY
  const sizeMatch = SIZE_RE.exec(text);
  const wantedSize = (sizeMatch?.[1] ?? sizeMatch?.[2])?.toUpperCase();
  const wantedColor = [...new Set(variants.map((v) => v.color))].find((c) => t.includes(c.toLowerCase()));
  const scoped = variants.filter((v) => (!wantedSize || v.size.toUpperCase() === wantedSize) && (!wantedColor || v.color === wantedColor));
  if (wantedSize && scoped.length === 0) return say(`${p.name} is not offered in size ${wantedSize}. Available sizes: ${[...new Set(variants.map((v) => v.size))].join(", ")}.`);
  const inStock = scoped.filter((v) => availableOf(v.inventory) > 0);
  if (inStock.length === 0) return say(`${p.name}${wantedSize ? ` in size ${wantedSize}` : ""}${wantedColor ? ` (${wantedColor})` : ""} is currently out of stock.`);
  const colorsIn = [...new Set(inStock.map((v) => v.color))];
  const low = inStock.some((v) => availableOf(v.inventory) <= 3);
  return say(`Yes, ${p.name}${wantedSize ? ` in size ${wantedSize}` : ""} is available in ${colorsIn.join(", ")}${low ? " (limited stock)" : ""}. ${price}`);
}

async function resolveProduct(tenantId: string, text: string, lastProductId?: string) {
  const tokens = text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  const include = { variants: { include: { inventory: true } } } as const;
  if (tokens.length) {
    const candidates = await prisma.product.findMany({
      where: { tenantId, status: "PUBLISHED", OR: tokens.map((w) => ({ searchText: { contains: w, mode: "insensitive" as const } })) },
      include, take: 20,
    });
    const scored = candidates
      .map((p) => ({ p, s: tokens.filter((w) => p.searchText.toLowerCase().includes(w)).length }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);
    const best = scored[0];
    if (best) {
      const ties = scored.filter((x) => x.s === best.s);
      if (ties.length === 1 || best.s >= 2 && ties.length <= 1) return { kind: "one" as const, product: best.p };
      if (!lastProductId || !ties.some((x) => x.p.id === lastProductId)) return { kind: "many" as const, names: ties.slice(0, 4).map((x) => x.p.name) };
    }
  }
  if (lastProductId) {
    const p = await prisma.product.findFirst({ where: { id: lastProductId, tenantId, status: "PUBLISHED" }, include });
    if (p) return { kind: "one" as const, product: p };
  }
  return { kind: "none" as const };
}

async function orderStatusReply(tenant: Tenant, waId: string, text: string, say: Say) {
  const ref = extractOrderRef(text);
  // Only orders whose phone equals the authenticated WhatsApp sender are ever shown.
  const orders = await prisma.order.findMany({
    where: { tenantId: tenant.id, contactPhone: waId, ...(ref ? { publicRef: ref } : {}) },
    include: { shipments: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { createdAt: "desc" },
    take: 3,
  });
  if (orders.length === 0) return say(ref ? `I could not find order ${ref} for this WhatsApp number.` : "I could not find any orders for this WhatsApp number. If you ordered with a different number, please message us from that number or contact support.");
  const lines = orders.map((o) => {
    const s = o.shipments[0];
    const track = s?.trackingNumber ? ` Tracking: ${s.provider} ${s.trackingNumber}.` : "";
    return `${o.publicRef}: ${STATUS_LABEL[o.status]} (${formatMoney(o.totalPaise, o.currency)}, COD).${track}`;
  });
  return say(lines.join("\n"));
}
