import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStorefrontTenant } from "@/lib/tenant";
import { getProduct, relatedProducts } from "@/lib/catalog";
import { availableOf } from "@/lib/inventory";
import { formatMoney } from "@/lib/money";
import { appUrl } from "@/lib/env";
import { PurchasePanel } from "@/components/PurchasePanel";
import { ProductCard } from "@/components/ProductCard";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const t = await getStorefrontTenant();
  const p = await getProduct(t.id, slug);
  if (!p) return {};
  const desc = p.description.slice(0, 160);
  const img = p.images[0]?.url;
  return {
    title: p.name, description: desc, alternates: { canonical: `/product/${p.slug}` },
    openGraph: { title: p.name, description: desc, type: "website", images: img ? [{ url: img }] : undefined },
    twitter: { card: "summary_large_image", title: p.name, description: desc },
  };
}

export default async function ProductPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { error } = await searchParams;
  const t = await getStorefrontTenant();
  const p = await getProduct(t.id, slug);
  if (!p) notFound();
  const related = await relatedProducts(t.id, p.categoryId, p.id);
  const variants = p.variants.map((v) => ({ id: v.id, size: v.size, color: v.color, colorHex: v.colorHex, available: availableOf(v.inventory) }));
  const inStock = variants.some((v) => v.available > 0);
  const jsonLd = {
    "@context": "https://schema.org", "@type": "Product", name: p.name, description: p.description, sku: p.sku, brand: { "@type": "Brand", name: t.name },
    image: p.images.map((i) => `${appUrl()}${i.url}`),
    offers: { "@type": "Offer", url: `${appUrl()}/product/${p.slug}`, priceCurrency: t.currency, price: (p.pricePaise / 100).toFixed(2), availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock" },
  };
  return (
    <div className="container-x py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-graphite/70"><a href="/shop">Shop</a> / <a href={`/category/${p.category.slug}`}>{p.category.name}</a></nav>
      <h1 className="mb-6 text-3xl sm:text-4xl">{p.name}</h1>
      <PurchasePanel name={p.name} pricePaise={p.pricePaise} comparePaise={p.comparePricePaise} variants={variants} images={p.images.map((i) => ({ url: i.url, alt: i.alt }))} soldOutError={error === "soldout"} />
      <section className="mt-12 grid gap-8 border-t border-fog pt-8 md:grid-cols-2" aria-label="Product details">
        <div><h2 className="text-xl">About this piece</h2><p className="mt-2 max-w-prose leading-relaxed">{p.description}</p></div>
        <dl className="space-y-3 text-sm">
          {p.material && <div><dt className="font-semibold">Fabric</dt><dd>{p.material}</dd></div>}
          {p.fit && <div><dt className="font-semibold">Fit</dt><dd>{p.fit}</dd></div>}
          <div><dt className="font-semibold">Delivery and returns</dt><dd>Delivered in 3-7 business days. Pay on delivery. Returns accepted within 7 days.</dd></div>
          <div><dt className="font-semibold">Price</dt><dd>{formatMoney(p.pricePaise)} including taxes. Shipping calculated at checkout.</dd></div>
        </dl>
      </section>
      {related.length > 0 && (
        <section className="mt-16" aria-labelledby="rel"><h2 id="rel" className="text-2xl">You may also like</h2>
          <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-10 lg:grid-cols-4">{related.map((r) => <li key={r.id}><ProductCard p={r} /></li>)}</ul></section>
      )}
    </div>
  );
}
