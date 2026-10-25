/* DEMO data only. Never run against production: refuses unless ALLOW_DEMO_SEED=true. */
import "dotenv/config";
import { randomBytes } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db";

interface CatalogProduct {
  slug: string; name: string; category: string; price: number; compare: number | null; sku: string; description: string;
  material: string; fit: string; isNew: boolean; isFeatured: boolean; colors: { name: string; hex: string }[]; sizes: string[]; stock: number;
}

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
    throw new Error("Refusing to seed demo data in production. Set ALLOW_DEMO_SEED=true only if you really mean it.");
  }
  const slug = process.env.STOREFRONT_TENANT_SLUG ?? "thread-and-form";
  const catalog = JSON.parse(readFileSync(path.resolve(__dirname, "catalog.json"), "utf8")) as { categories: { slug: string; name: string; blurb: string }[]; products: CatalogProduct[] };

  const tenant = await prisma.tenant.upsert({
    where: { slug },
    create: { slug, name: "THREAD & FORM", supportEmail: "support@example.com", supportPhone: "+910000000000" },
    update: {},
  });
  const cats = new Map<string, string>();
  for (const [i, c] of catalog.categories.entries()) {
    const row = await prisma.category.upsert({ where: { tenantId_slug: { tenantId: tenant.id, slug: c.slug } }, create: { tenantId: tenant.id, ...c, position: i }, update: {} });
    cats.set(c.slug, row.id);
  }
  for (const p of catalog.products) {
    const exists = await prisma.product.findUnique({ where: { tenantId_slug: { tenantId: tenant.id, slug: p.slug } } });
    if (exists) continue; // never overwrite edited catalogue data
    const product = await prisma.product.create({
      data: {
        tenantId: tenant.id, categoryId: cats.get(p.category)!, slug: p.slug, name: p.name, description: p.description, material: p.material, fit: p.fit,
        pricePaise: Math.round(p.price * 100), comparePricePaise: p.compare ? Math.round(p.compare * 100) : null, sku: p.sku, status: "PUBLISHED",
        isNew: p.isNew, isFeatured: p.isFeatured, searchText: `${p.name} ${p.category} ${p.colors.map((c) => c.name).join(" ")} ${p.material}`.toLowerCase(),
        images: { create: p.colors.map((c, i) => ({ url: `/products/${p.slug}-${c.name.toLowerCase()}.svg`, alt: c.name, position: i })) },
      },
    });
    for (const c of p.colors) {
      for (const size of p.sizes) {
        await prisma.productVariant.create({
          data: {
            tenantId: tenant.id, productId: product.id, size, color: c.name, colorHex: c.hex, sku: `${p.sku}-${size}-${c.name.slice(0, 3).toUpperCase()}`,
            inventory: { create: { tenantId: tenant.id, onHand: p.stock, lowStockThreshold: 3 } },
          },
        });
      }
    }
  }

  // Demo staff owner: credentials come from the environment or are generated and shown once. Never hardcoded.
  const email = (process.env.DEMO_OWNER_EMAIL ?? "owner@demo.threadandform.test").toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    const password = process.env.DEMO_OWNER_PASSWORD ?? randomBytes(9).toString("base64url");
    const user = await prisma.user.create({ data: { email, name: "Demo Owner", passwordHash: await bcrypt.hash(password, 12) } });
    await prisma.membership.create({ data: { userId: user.id, tenantId: tenant.id, role: "OWNER" } });
    console.log(`\nDemo owner created\n  email:    ${email}\n  password: ${password}\n(shown once, store it somewhere safe)\n`);
  }
  console.log(`Seeded demo catalogue for tenant "${slug}" (${catalog.products.length} products).`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
