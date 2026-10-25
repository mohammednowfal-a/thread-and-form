import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { getStorefrontTenant } from "@/lib/tenant";
import { bestSellers, listProducts } from "@/lib/catalog";
import { ProductCard } from "@/components/ProductCard";
import { SafeImg } from "@/components/SafeImg";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { alternates: { canonical: "/" } };

export default async function Home() {
  const tenant = await getStorefrontTenant();
  const [fresh, best, categories, hero] = await Promise.all([
    listProducts(tenant.id, { onlyNew: true, sort: "newest", page: 1 }),
    bestSellers(tenant.id, 4),
    prisma.category.findMany({ where: { tenantId: tenant.id }, orderBy: { position: "asc" } }),
    prisma.product.findFirst({ where: { tenantId: tenant.id, status: "PUBLISHED", isFeatured: true }, include: { images: { orderBy: { position: "asc" }, take: 1 } }, orderBy: { createdAt: "asc" } }),
  ]);
  return (
    <>
      <section className="container-x grid items-center gap-10 py-12 lg:grid-cols-[1.15fr_1fr] lg:py-20">
        <div>
          <h1 className="text-5xl leading-[1.02] sm:text-6xl lg:text-7xl">Clothing that earns its place in the wardrobe.</h1>
          <p className="mt-6 max-w-lg text-lg text-graphite/85">Heavyweight cotton, European linen and outerwear built to be worn for years. Order now, confirm on WhatsApp, and pay when it arrives.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/new-arrivals" className="btn-primary">Shop new arrivals</Link>
            <Link href="/shop" className="btn-outline">Browse everything</Link>
          </div>
        </div>
        <div className="relative">
          <svg className="hero-stitch pointer-events-none absolute -inset-3 h-[calc(100%+1.5rem)] w-[calc(100%+1.5rem)]" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <path d="M2 2 H98 V98 H2 Z" fill="none" stroke="#E8B931" strokeWidth="0.8" vectorEffect="non-scaling-stroke" style={{ strokeWidth: 3 }} />
          </svg>
          <Link href={hero ? `/product/${hero.slug}` : "/shop"} className="relative block aspect-[5/6] overflow-hidden bg-[#E9E9E4] no-underline">
            <SafeImg priority src={hero?.images[0]?.url ?? null} alt={hero?.name ?? "THREAD & FORM"} className="h-full w-full object-cover" />
            {hero && <span className="absolute bottom-0 left-0 bg-chalk px-4 py-2 font-display text-lg">{hero.name}</span>}
          </Link>
        </div>
      </section>

      <section className="stitch-b border-y-2 border-dashed border-indigo/25 bg-white py-10" aria-labelledby="how">
        <div className="container-x">
          <h2 id="how" className="text-2xl">How ordering works</h2>
          <ol className="mt-5 grid gap-6 sm:grid-cols-3">
            <li><p className="font-display text-lg">1. Choose and order</p><p className="mt-1 text-sm text-graphite/80">Pick your size and colour, add your address, and select Cash on Delivery. No card needed.</p></li>
            <li><p className="font-display text-lg">2. Confirm on WhatsApp</p><p className="mt-1 text-sm text-graphite/80">We message you the order details. Tap Confirm or Cancel. Nothing is packed until you confirm.</p></li>
            <li><p className="font-display text-lg">3. Pay when it arrives</p><p className="mt-1 text-sm text-graphite/80">Pay the courier the amount shown in your message. Returns are accepted for 7 days.</p></li>
          </ol>
        </div>
      </section>

      <section className="container-x mt-16" aria-labelledby="cats">
        <h2 id="cats" className="text-3xl">Shop by category</h2>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {categories.map((c) => (
            <li key={c.id}><Link href={`/category/${c.slug}`} className="stitch block h-full p-4 no-underline hover:bg-indigo-soft"><span className="font-display text-xl">{c.name}</span><span className="mt-1 block text-sm text-graphite/75">{c.blurb}</span></Link></li>
          ))}
        </ul>
      </section>

      {fresh.items.length > 0 && (
        <section className="container-x mt-16" aria-labelledby="new">
          <div className="flex items-end justify-between"><h2 id="new" className="text-3xl">New arrivals</h2><Link href="/new-arrivals" className="text-sm">View all</Link></div>
          <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-10 lg:grid-cols-4">{fresh.items.slice(0, 4).map((p) => <li key={p.id}><ProductCard p={p} /></li>)}</ul>
        </section>
      )}
      {best.items.length > 0 && (
        <section className="container-x mt-16" aria-labelledby="best">
          <div className="flex items-end justify-between"><h2 id="best" className="text-3xl">Best sellers</h2><Link href="/best-sellers" className="text-sm">View all</Link></div>
          <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-10 lg:grid-cols-4">{best.items.map((p) => <li key={p.id}><ProductCard p={p} /></li>)}</ul>
        </section>
      )}
    </>
  );
}
