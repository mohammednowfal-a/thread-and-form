import { prisma } from "../db";
import { env } from "../env";

export const shopifyConfigured = () => Boolean(env("SHOPIFY_STORE_DOMAIN") && env("SHOPIFY_ADMIN_TOKEN"));

interface ShopifyVariant { sku?: string; option1?: string; option2?: string; option3?: string; price: string; inventory_quantity?: number }
interface ShopifyProduct { title: string; handle: string; body_html?: string; status: string; options: { name: string }[]; variants: ShopifyVariant[] }

/** "1299.50" -> 129950 without floating point. */
export function priceToPaise(price: string): number {
  const [whole = "0", frac = ""] = price.trim().split(".");
  return parseInt(whole, 10) * 100 + parseInt((frac + "00").slice(0, 2), 10);
}

const strip = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

/**
 * One-way import of the first 50 Shopify products. Existing slugs/SKUs are skipped, never overwritten.
 * Implemented against Shopify's public Admin REST docs; NOT verified against a live store.
 */
export async function importShopifyProducts(tenantId: string): Promise<{ created: number; skipped: number }> {
  if (!shopifyConfigured()) throw new Error("Shopify is not connected. Set SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_TOKEN.");
  const domain = env("SHOPIFY_STORE_DOMAIN").replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!/^[a-z0-9-]+\.myshopify\.com$/i.test(domain)) throw new Error("SHOPIFY_STORE_DOMAIN must look like your-store.myshopify.com");
  const res = await fetch(`https://${domain}/admin/api/2024-10/products.json?limit=50`, { headers: { "X-Shopify-Access-Token": env("SHOPIFY_ADMIN_TOKEN") }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Shopify responded with ${res.status}`);
  const { products } = (await res.json()) as { products: ShopifyProduct[] };
  const cat = await prisma.category.upsert({ where: { tenantId_slug: { tenantId, slug: "imported" } }, create: { tenantId, slug: "imported", name: "Imported" }, update: {} });
  let created = 0, skipped = 0;
  for (const p of products) {
    const slug = p.handle.toLowerCase();
    if (await prisma.product.findUnique({ where: { tenantId_slug: { tenantId, slug } } })) { skipped++; continue; }
    const names = p.options.map((o) => o.name.toLowerCase());
    const sizeIdx = names.indexOf("size"), colorIdx = names.indexOf("color") >= 0 ? names.indexOf("color") : names.indexOf("colour");
    const pick = (v: ShopifyVariant, i: number) => (i < 0 ? undefined : [v.option1, v.option2, v.option3][i]);
    const base = p.variants[0];
    if (!base) { skipped++; continue; }
    const sku = (base.sku || `SHOP-${slug}`).slice(0, 40);
    if (await prisma.product.findUnique({ where: { tenantId_sku: { tenantId, sku } } })) { skipped++; continue; }
    const prod = await prisma.product.create({ data: { tenantId, categoryId: cat.id, slug, name: p.title, description: strip(p.body_html ?? "") || p.title, pricePaise: priceToPaise(base.price), sku, status: p.status === "active" ? "PUBLISHED" : "DRAFT", searchText: `${p.title}`.toLowerCase() } });
    for (const [i, v] of p.variants.entries()) {
      const size = pick(v, sizeIdx) ?? "One size", color = pick(v, colorIdx) ?? "Default";
      await prisma.productVariant.create({ data: { tenantId, productId: prod.id, size, color, sku: (v.sku || `${sku}-${i}`).slice(0, 40), priceOverridePaise: priceToPaise(v.price) !== priceToPaise(base.price) ? priceToPaise(v.price) : null, inventory: { create: { tenantId, onHand: Math.max(v.inventory_quantity ?? 0, 0) } } } }).catch(() => undefined);
    }
    created++;
  }
  return { created, skipped };
}
