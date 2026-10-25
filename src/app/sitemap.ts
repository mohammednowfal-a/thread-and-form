import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { getStorefrontTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = appUrl();
  const t = await getStorefrontTenant();
  const [products, cats] = await Promise.all([
    prisma.product.findMany({ where: { tenantId: t.id, status: "PUBLISHED" }, select: { slug: true, updatedAt: true } }),
    prisma.category.findMany({ where: { tenantId: t.id }, select: { slug: true } }),
  ]);
  const fixed = ["", "/shop", "/new-arrivals", "/best-sellers", "/contact", "/privacy", "/terms", "/shipping-policy", "/returns-policy"].map((p) => ({ url: `${base}${p}` }));
  return [...fixed, ...cats.map((c) => ({ url: `${base}/category/${c.slug}` })), ...products.map((p) => ({ url: `${base}/product/${p.slug}`, lastModified: p.updatedAt }))];
}
