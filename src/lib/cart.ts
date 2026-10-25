import { cookies } from "next/headers";
import { prisma } from "./db";
import { hashToken, newToken } from "./auth";
import { isProd } from "./env";
import { computeTotals, type Totals } from "./money";
import { availableOf } from "./inventory";
import { MAX_QTY_PER_LINE } from "./orders";
import type { Tenant } from "@prisma/client";

const CART_COOKIE = "tf_cart";
const CART_TTL = 60 * 60 * 24 * 30;

export async function findCart(tenantId: string) {
  const token = (await cookies()).get(CART_COOKIE)?.value;
  if (!token) return null;
  return prisma.cart.findFirst({ where: { tokenHash: hashToken(token), tenantId } });
}

export async function ensureCart(tenantId: string, customerId?: string | null) {
  const existing = await findCart(tenantId);
  if (existing) return existing;
  const token = newToken();
  const cart = await prisma.cart.create({ data: { tenantId, tokenHash: hashToken(token), customerId: customerId ?? null } });
  (await cookies()).set(CART_COOKIE, token, { httpOnly: true, secure: isProd(), sameSite: "lax", path: "/", maxAge: CART_TTL });
  return cart;
}

export interface CartLineView {
  itemId: string;
  variantId: string;
  productId: string;
  slug: string;
  name: string;
  size: string;
  color: string;
  image: string | null;
  unitPricePaise: number;
  quantity: number;
  linePaise: number;
  available: number;
  issue: string | null;
  siblings: { id: string; size: string; color: string; available: number }[];
}

export interface CartView {
  lines: CartLineView[];
  totals: Totals;
  count: number;
  hasIssues: boolean;
}

export async function getCartView(tenant: Tenant): Promise<CartView> {
  const cart = await findCart(tenant.id);
  const empty: CartView = { lines: [], totals: computeTotals([], tenant), count: 0, hasIssues: false };
  if (!cart) return empty;
  const items = await prisma.cartItem.findMany({
    where: { cartId: cart.id },
    include: { variant: { include: { inventory: true, product: { include: { images: { orderBy: { position: "asc" }, take: 1 }, variants: { where: { active: true }, include: { inventory: true } } } } } } },
    orderBy: { id: "asc" },
  });
  const lines: CartLineView[] = items.map((it) => {
    const v = it.variant;
    const avail = availableOf(v.inventory);
    const unavailable = !v.active || v.product.status !== "PUBLISHED" || v.tenantId !== tenant.id;
    const issue = unavailable ? "No longer available" : avail === 0 ? "Out of stock" : it.quantity > avail ? `Only ${avail} left` : null;
    const unit = v.priceOverridePaise ?? v.product.pricePaise;
    return {
      itemId: it.id, variantId: v.id, productId: v.productId, slug: v.product.slug, name: v.product.name, size: v.size, color: v.color,
      image: v.product.images[0]?.url ?? null, unitPricePaise: unit, quantity: it.quantity, linePaise: unit * it.quantity, available: avail, issue,
      siblings: v.product.variants.map((s) => ({ id: s.id, size: s.size, color: s.color, available: availableOf(s.inventory) })),
    };
  });
  const payable = lines.filter((l) => !l.issue || l.issue.startsWith("Only"));
  return {
    lines,
    totals: computeTotals(payable.map((l) => ({ unitPricePaise: l.unitPricePaise, quantity: l.quantity })), tenant),
    count: lines.reduce((n, l) => n + l.quantity, 0),
    hasIssues: lines.some((l) => l.issue),
  };
}

export async function cartCount(tenantId: string): Promise<number> {
  const cart = await findCart(tenantId);
  if (!cart) return 0;
  const agg = await prisma.cartItem.aggregate({ where: { cartId: cart.id }, _sum: { quantity: true } });
  return agg._sum.quantity ?? 0;
}

export function clampQty(q: number): number {
  if (!Number.isFinite(q)) return 1;
  return Math.min(Math.max(Math.trunc(q), 1), MAX_QTY_PER_LINE);
}

/** Attach the anonymous cart to a customer at login and merge any older cart of theirs into it. */
export async function mergeCartOnLogin(tenantId: string, customerId: string) {
  const anon = await findCart(tenantId);
  const previous = await prisma.cart.findFirst({ where: { tenantId, customerId, ...(anon ? { id: { not: anon.id } } : {}) }, orderBy: { updatedAt: "desc" }, include: { items: true } });
  if (!anon) {
    if (previous) {
      // Re-point the cookie at the customer's saved cart is not possible (token is hashed); keep it until next cart action.
    }
    return;
  }
  await prisma.$transaction(async (tx) => {
    await tx.cart.update({ where: { id: anon.id }, data: { customerId } });
    if (previous) {
      for (const it of previous.items) {
        const cur = await tx.cartItem.findUnique({ where: { cartId_variantId: { cartId: anon.id, variantId: it.variantId } } });
        const qty = clampQty((cur?.quantity ?? 0) + it.quantity);
        await tx.cartItem.upsert({ where: { cartId_variantId: { cartId: anon.id, variantId: it.variantId } }, create: { cartId: anon.id, variantId: it.variantId, quantity: qty }, update: { quantity: qty } });
      }
      await tx.cart.delete({ where: { id: previous.id } });
    }
  });
}
