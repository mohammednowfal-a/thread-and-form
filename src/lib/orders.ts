import { randomInt } from "crypto";
import type { OrderStatus, Order, OrderItem, Prisma } from "@prisma/client";
import { prisma, isUniqueViolation, type Tx } from "./db";
import { computeTotals } from "./money";
import { enqueue } from "./jobs";
import { releaseStock, reserveStock, consumeStock } from "./inventory";
import { assertTransition, canTransition, CUSTOMER_CANCELLABLE, InvalidTransitionError } from "./orderStatus";

export const MAX_QTY_PER_LINE = 10;

export class CheckoutError extends Error {
  constructor(public code: "EMPTY" | "UNAVAILABLE" | "OUT_OF_STOCK" | "INVALID_QTY" | "COD_LIMIT" | "TENANT", message: string) {
    super(message);
  }
}

const REF_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function generatePublicRef(): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
  return `TF-${s}`;
}

export interface ShippingAddress {
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
}

export interface CreateOrderInput {
  tenantId: string;
  lines: { variantId: string; quantity: number }[];
  contact: { name: string; phone: string; email?: string | null };
  address: ShippingAddress;
  whatsappConsent: boolean;
  idempotencyKey: string;
  customerId?: string | null;
  cartId?: string | null;
}

export type OrderWithItems = Order & { items: OrderItem[] };

export async function createCodOrder(input: CreateOrderInput): Promise<{ order: OrderWithItems; reused: boolean }> {
  const existing = await prisma.order.findUnique({
    where: { tenantId_idempotencyKey: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey } },
    include: { items: true },
  });
  if (existing) return { order: existing, reused: true };

  try {
    const order = await prisma.$transaction(
      async (tx) => buildOrder(tx, input),
      { timeout: 20000, maxWait: 10000 },
    );
    return { order, reused: false };
  } catch (e) {
    if (isUniqueViolation(e, "idempotencyKey")) {
      const again = await prisma.order.findUnique({
        where: { tenantId_idempotencyKey: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey } },
        include: { items: true },
      });
      if (again) return { order: again, reused: true };
    }
    throw e;
  }
}

async function buildOrder(tx: Tx, input: CreateOrderInput): Promise<OrderWithItems> {
  const tenant = await tx.tenant.findUnique({ where: { id: input.tenantId } });
  if (!tenant) throw new CheckoutError("TENANT", "Store not found");

  // Merge duplicate lines and validate quantities (never trust the browser).
  const merged = new Map<string, number>();
  for (const l of input.lines) {
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > MAX_QTY_PER_LINE)
      throw new CheckoutError("INVALID_QTY", `Quantity must be between 1 and ${MAX_QTY_PER_LINE}`);
    merged.set(l.variantId, (merged.get(l.variantId) ?? 0) + l.quantity);
  }
  if (merged.size === 0) throw new CheckoutError("EMPTY", "Your cart is empty");

  const ids = [...merged.keys()].sort(); // consistent lock order avoids deadlocks
  const variants = await tx.productVariant.findMany({
    where: { id: { in: ids }, tenantId: input.tenantId },
    include: { product: true },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));

  const priced: { variantId: string; productId: string; name: string; size: string; color: string; sku: string; unitPricePaise: number; quantity: number }[] = [];
  for (const id of ids) {
    const v = byId.get(id);
    const qty = merged.get(id) ?? 0;
    if (!v || !v.active || v.product.status !== "PUBLISHED" || v.product.tenantId !== input.tenantId)
      throw new CheckoutError("UNAVAILABLE", "An item in your cart is no longer available");
    if (qty > MAX_QTY_PER_LINE) throw new CheckoutError("INVALID_QTY", "Quantity too large");
    priced.push({
      variantId: v.id, productId: v.productId, name: v.product.name, size: v.size, color: v.color, sku: v.sku,
      unitPricePaise: v.priceOverridePaise ?? v.product.pricePaise, quantity: qty,
    });
  }

  const totals = computeTotals(priced, tenant);
  if (totals.totalPaise > tenant.codMaxTotalPaise)
    throw new CheckoutError("COD_LIMIT", "This order is above the Cash on Delivery limit. Please contact support.");

  for (const p of priced) {
    const ok = await reserveStock(tx, input.tenantId, p.variantId, p.quantity);
    if (!ok) throw new CheckoutError("OUT_OF_STOCK", `${p.name} (${p.size}, ${p.color}) is no longer available in the quantity you chose`);
  }

  let publicRef = generatePublicRef();
  for (let i = 0; i < 5; i++) {
    const clash = await tx.order.findUnique({ where: { tenantId_publicRef: { tenantId: input.tenantId, publicRef } }, select: { id: true } });
    if (!clash) break;
    publicRef = generatePublicRef();
  }

  const wantsWa = tenant.whatsappConfirmEnabled && input.whatsappConsent;
  const order = await tx.order.create({
    data: {
      tenantId: input.tenantId,
      publicRef,
      customerId: input.customerId ?? null,
      contactName: input.contact.name,
      contactPhone: input.contact.phone,
      contactEmail: input.contact.email ?? null,
      shippingAddress: input.address as unknown as Prisma.InputJsonValue,
      currency: tenant.currency,
      ...totals,
      paymentMethod: "COD",
      paymentStatus: "PENDING",
      status: "PENDING_CONFIRMATION",
      confirmationStatus: wantsWa ? "AWAITING" : "MANUAL_REVIEW",
      whatsappConsent: input.whatsappConsent,
      idempotencyKey: input.idempotencyKey,
      expiresAt: new Date(Date.now() + tenant.confirmationExpiryHours * 3600_000),
      items: {
        create: priced.map((p) => ({
          variantId: p.variantId, productId: p.productId, nameSnapshot: p.name, sizeSnapshot: p.size,
          colorSnapshot: p.color, skuSnapshot: p.sku, unitPricePaise: p.unitPricePaise, quantity: p.quantity,
          lineTotalPaise: p.unitPricePaise * p.quantity,
        })),
      },
      history: { create: { toStatus: "PENDING_CONFIRMATION", source: "checkout", note: "COD order placed" } },
      cod: { create: { tenantId: input.tenantId } },
    },
    include: { items: true },
  });

  if (wantsWa) {
    // Same transaction as the order => an order can never exist without its durable notification job.
    await enqueue(tx, { tenantId: input.tenantId, type: "WA_COD_CONFIRM", payload: { orderId: order.id }, dedupeKey: `cod-confirm:${order.id}` });
  }
  if (order.contactEmail) {
    await enqueue(tx, { tenantId: input.tenantId, type: "EMAIL_ORDER_PLACED", payload: { orderId: order.id }, dedupeKey: `email-placed:${order.id}` });
  }
  if (input.cartId) await tx.cartItem.deleteMany({ where: { cartId: input.cartId } });
  return order;
}

async function lockOrder(tx: Tx, tenantId: string, orderId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} AND "tenantId" = ${tenantId} FOR UPDATE`;
  return tx.order.findFirst({ where: { id: orderId, tenantId }, include: { items: true, cod: true } });
}

export type ConfirmResult =
  | { result: "CONFIRMED" }
  | { result: "ALREADY_CONFIRMED" }
  | { result: "NOT_ELIGIBLE"; reason: string };

/** Marks an order confirmed. Idempotent. Only a PENDING_CONFIRMATION order whose stock is still held is eligible. */
export async function confirmOrder(args: { tenantId: string; orderId: string; source: string; messageId?: string | null; actorUserId?: string | null }): Promise<ConfirmResult> {
  return prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, args.tenantId, args.orderId);
    if (!order) return { result: "NOT_ELIGIBLE", reason: "Order not found" } as const;
    if (order.status === "CONFIRMED" && order.confirmationStatus === "CONFIRMED") return { result: "ALREADY_CONFIRMED" } as const;
    if (order.status !== "PENDING_CONFIRMATION") return { result: "NOT_ELIGIBLE", reason: `Order is ${order.status}` } as const;
    if (!order.stockHeld) return { result: "NOT_ELIGIBLE", reason: "Stock is no longer reserved for this order" } as const;
    await tx.order.update({
      where: { id: order.id },
      data: { status: "CONFIRMED", confirmationStatus: "CONFIRMED", confirmedAt: new Date(), confirmationSource: args.source },
    });
    await tx.codConfirmation.updateMany({
      where: { orderId: order.id },
      data: { status: "CONFIRMED", resolvedAt: new Date(), resolvedMessageId: args.messageId ?? null },
    });
    await tx.orderStatusHistory.create({
      data: { orderId: order.id, fromStatus: order.status, toStatus: "CONFIRMED", source: args.source, actorUserId: args.actorUserId ?? null, note: "Customer confirmed COD" },
    });
    if (order.whatsappConsent) {
      await enqueue(tx, { tenantId: args.tenantId, type: "WA_ORDER_CONFIRMED_ACK", payload: { orderId: order.id }, dedupeKey: `confirm-ack:${order.id}` });
    }
    return { result: "CONFIRMED" } as const;
  });
}

export type CancelResult =
  | { result: "CANCELLED" }
  | { result: "ALREADY_CANCELLED" }
  | { result: "NOT_ALLOWED"; reason: string };

export async function cancelOrder(args: {
  tenantId: string; orderId: string; source: string; reason?: string; actorUserId?: string | null; customerInitiated?: boolean;
}): Promise<CancelResult> {
  return prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, args.tenantId, args.orderId);
    if (!order) return { result: "NOT_ALLOWED", reason: "Order not found" } as const;
    if (order.status === "CANCELLED") return { result: "ALREADY_CANCELLED" } as const;
    if (args.customerInitiated && !CUSTOMER_CANCELLABLE.includes(order.status))
      return { result: "NOT_ALLOWED", reason: `Order is already ${order.status.toLowerCase().replace(/_/g, " ")}` } as const;
    if (!canTransition(order.status, "CANCELLED"))
      return { result: "NOT_ALLOWED", reason: `Order is already ${order.status.toLowerCase().replace(/_/g, " ")}` } as const;

    if (order.stockHeld) {
      for (const it of [...order.items].sort((a, b) => (a.variantId ?? "").localeCompare(b.variantId ?? ""))) {
        if (it.variantId) await releaseStock(tx, args.tenantId, it.variantId, it.quantity);
      }
    }
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: "CANCELLED", paymentStatus: "VOID", confirmationStatus: "CANCELLED", stockHeld: false,
        cancelledAt: new Date(), cancelSource: args.source, cancelReason: args.reason ?? null,
      },
    });
    await tx.codConfirmation.updateMany({ where: { orderId: order.id }, data: { status: "CANCELLED", resolvedAt: new Date() } });
    await tx.orderStatusHistory.create({
      data: { orderId: order.id, fromStatus: order.status, toStatus: "CANCELLED", source: args.source, actorUserId: args.actorUserId ?? null, note: args.reason ?? null },
    });
    if (order.whatsappConsent) {
      await enqueue(tx, { tenantId: args.tenantId, type: "WA_ORDER_CANCELLED_ACK", payload: { orderId: order.id }, dedupeKey: `cancel-ack:${order.id}` });
    }
    return { result: "CANCELLED" } as const;
  });
}

/** Staff-driven status change through the documented state machine. */
export async function transitionOrder(args: {
  tenantId: string; orderId: string; to: OrderStatus; source: string; actorUserId?: string | null; note?: string;
}): Promise<void> {
  if (args.to === "CANCELLED") {
    const r = await cancelOrder({ tenantId: args.tenantId, orderId: args.orderId, source: args.source, reason: args.note, actorUserId: args.actorUserId });
    if (r.result === "NOT_ALLOWED") throw new Error(r.reason);
    return;
  }
  if (args.to === "CONFIRMED") {
    const r = await confirmOrder({ tenantId: args.tenantId, orderId: args.orderId, source: args.source, actorUserId: args.actorUserId });
    if (r.result === "NOT_ELIGIBLE") throw new Error(r.reason);
    return;
  }
  await prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, args.tenantId, args.orderId);
    if (!order) throw new Error("Order not found");
    assertTransition(order.status, args.to);

    const data: Prisma.OrderUpdateInput = { status: args.to };
    if (args.to === "SHIPPED" && order.stockHeld) {
      for (const it of [...order.items].sort((a, b) => (a.variantId ?? "").localeCompare(b.variantId ?? ""))) {
        if (!it.variantId) continue;
        const ok = await consumeStock(tx, args.tenantId, it.variantId, it.quantity);
        if (!ok) throw new Error(`Cannot ship: stock for ${it.nameSnapshot} (${it.sizeSnapshot}) is not available`);
      }
      data.stockHeld = false;
    }
    if (args.to === "DELIVERED") data.paymentStatus = "COLLECTED";
    await tx.order.update({ where: { id: order.id }, data });
    await tx.orderStatusHistory.create({
      data: { orderId: order.id, fromStatus: order.status, toStatus: args.to, source: args.source, actorUserId: args.actorUserId ?? null, note: args.note ?? null },
    });
    if (order.whatsappConsent && (args.to === "SHIPPED" || args.to === "DELIVERED")) {
      await enqueue(tx, { tenantId: args.tenantId, type: "WA_ORDER_STATUS", payload: { orderId: order.id, status: args.to }, dedupeKey: `status:${order.id}:${args.to}` });
    }
  });
}

/** Cancels COD orders that were never confirmed in time and releases their stock. */
export async function expireStaleOrders(limit = 50): Promise<number> {
  const stale = await prisma.order.findMany({
    where: { status: "PENDING_CONFIRMATION", expiresAt: { lt: new Date() }, stockHeld: true },
    select: { id: true, tenantId: true },
    take: limit,
  });
  let n = 0;
  for (const o of stale) {
    const r = await cancelOrder({ tenantId: o.tenantId, orderId: o.id, source: "system:expiry", reason: "Not confirmed in time" });
    if (r.result === "CANCELLED") n++;
  }
  return n;
}

export { InvalidTransitionError };
