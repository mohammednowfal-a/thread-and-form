import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { availableOf } from "./inventory";

export const PAGE_SIZE = 12;

export interface Filters {
  q?: string;
  category?: string;
  minPrice?: number; // rupees from the URL
  maxPrice?: number;
  size?: string;
  color?: string;
  sort?: "newest" | "price-asc" | "price-desc" | "name";
  page?: number;
  onlyNew?: boolean;
}

const cardInclude = {
  images: { orderBy: { position: "asc" as const } },
  category: true,
  variants: { where: { active: true }, include: { inventory: true } },
} satisfies Prisma.ProductInclude;

export type CardProduct = Prisma.ProductGetPayload<{ include: typeof cardInclude }>;

export function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : (sp[k] as string | undefined))?.trim() || undefined;
  const num = (k: string) => { const v = Number(one(k)); return Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined; };
  const sort = one("sort");
  return {
    q: one("q")?.slice(0, 80), category: one("category"), minPrice: num("min"), maxPrice: num("max"),
    size: one("size")?.slice(0, 10), color: one("color")?.slice(0, 30),
    sort: sort === "price-asc" || sort === "price-desc" || sort === "name" ? sort : "newest",
    page: Math.max(1, num("page") ?? 1),
  };
}

export async function listProducts(tenantId: string, f: Filters) {
  const where: Prisma.ProductWhereInput = {
    tenantId, status: "PUBLISHED",
    ...(f.onlyNew ? { isNew: true } : {}),
    ...(f.category ? { category: { slug: f.category } } : {}),
    ...(f.q ? { OR: [{ name: { contains: f.q, mode: "insensitive" } }, { searchText: { contains: f.q.toLowerCase(), mode: "insensitive" } }, { description: { contains: f.q, mode: "insensitive" } }] } : {}),
    ...(f.minPrice !== undefined || f.maxPrice !== undefined ? { pricePaise: { ...(f.minPrice !== undefined ? { gte: f.minPrice * 100 } : {}), ...(f.maxPrice !== undefined ? { lte: f.maxPrice * 100 } : {}) } } : {}),
    ...(f.size || f.color ? { variants: { some: { active: true, ...(f.size ? { size: f.size } : {}), ...(f.color ? { color: f.color } : {}) } } } : {}),
  };
  const orderBy: Prisma.ProductOrderByWithRelationInput =
    f.sort === "price-asc" ? { pricePaise: "asc" } : f.sort === "price-desc" ? { pricePaise: "desc" } : f.sort === "name" ? { name: "asc" } : { createdAt: "desc" };
  const [total, items] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({ where, orderBy, include: cardInclude, skip: ((f.page ?? 1) - 1) * PAGE_SIZE, take: PAGE_SIZE }),
  ]);
  return { total, items, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function facets(tenantId: string) {
  const [categories, variants] = await Promise.all([
    prisma.category.findMany({ where: { tenantId }, orderBy: { position: "asc" } }),
    prisma.productVariant.findMany({ where: { tenantId, active: true, product: { status: "PUBLISHED" } }, select: { size: true, color: true } }),
  ]);
  const order = ["XS", "S", "M", "L", "XL", "XXL"];
  const sizes = [...new Set(variants.map((v) => v.size))].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b, undefined, { numeric: true }));
  const colors = [...new Set(variants.map((v) => v.color))].sort();
  return { categories, sizes, colors };
}

export async function getProduct(tenantId: string, slug: string) {
  return prisma.product.findFirst({
    where: { tenantId, slug, status: "PUBLISHED" },
    include: { images: { orderBy: { position: "asc" } }, category: true, variants: { where: { active: true }, include: { inventory: true }, orderBy: [{ color: "asc" }, { size: "asc" }] } },
  });
}

export async function relatedProducts(tenantId: string, categoryId: string, excludeId: string) {
  return prisma.product.findMany({ where: { tenantId, status: "PUBLISHED", categoryId, id: { not: excludeId } }, include: cardInclude, take: 4, orderBy: { createdAt: "desc" } });
}

export async function bestSellers(tenantId: string, take = 8) {
  const top = await prisma.orderItem.groupBy({
    by: ["productId"],
    where: { productId: { not: null }, order: { tenantId, status: { notIn: ["CANCELLED", "RETURNED"] } } },
    _sum: { quantity: true }, orderBy: { _sum: { quantity: "desc" } }, take,
  });
  const ids = top.map((t) => t.productId).filter((x): x is string => !!x);
  const sold = ids.length ? await prisma.product.findMany({ where: { id: { in: ids }, tenantId, status: "PUBLISHED" }, include: cardInclude }) : [];
  sold.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  if (sold.length >= take) return { items: sold, fromSales: true };
  // Not enough sales history yet: fill with featured products (and say so on the page).
  const fill = await prisma.product.findMany({ where: { tenantId, status: "PUBLISHED", isFeatured: true, id: { notIn: sold.map((s) => s.id) } }, include: cardInclude, take: take - sold.length });
  return { items: [...sold, ...fill], fromSales: sold.length > 0 };
}

export const isSoldOut = (p: CardProduct) => p.variants.every((v) => availableOf(v.inventory) === 0);
