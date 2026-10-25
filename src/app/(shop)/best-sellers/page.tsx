import type { Metadata } from "next";
import { getStorefrontTenant } from "@/lib/tenant";
import { bestSellers } from "@/lib/catalog";
import { ProductCard } from "@/components/ProductCard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Best sellers", alternates: { canonical: "/best-sellers" } };

export default async function BestSellers() {
  const t = await getStorefrontTenant();
  const { items, fromSales } = await bestSellers(t.id, 12);
  return (
    <div className="container-x py-10">
      <h1 className="text-3xl sm:text-4xl">Best sellers</h1>
      <p className="mt-2 max-w-prose text-graphite/80">{fromSales ? "Ranked by units sold, excluding cancelled and returned orders." : "We're still building our sales history, so this is our featured selection for now."}</p>
      <ul className="mt-8 grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 lg:grid-cols-4">{items.map((p) => <li key={p.id}><ProductCard p={p} /></li>)}</ul>
    </div>
  );
}
