import type { Metadata } from "next";
import { getStorefrontTenant } from "@/lib/tenant";
import { facets, listProducts, parseFilters } from "@/lib/catalog";
import { ProductListing } from "@/components/ProductListing";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Search", robots: { index: false } };

export default async function Search({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const f = parseFilters(await searchParams);
  const t = await getStorefrontTenant();
  const [result, fc] = await Promise.all([f.q ? listProducts(t.id, f) : Promise.resolve({ total: 0, items: [], pages: 1 }), facets(t.id)]);
  return <ProductListing title={f.q ? `Results for “${f.q}”` : "Search"} intro={f.q ? undefined : "Search by product name, colour or fabric."} basePath="/search" filters={f} result={result} facets={fc} showQuery />;
}
