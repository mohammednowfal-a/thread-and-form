import type { Metadata } from "next";
import { getStorefrontTenant } from "@/lib/tenant";
import { facets, listProducts, parseFilters } from "@/lib/catalog";
import { ProductListing } from "@/components/ProductListing";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New arrivals", alternates: { canonical: "/new-arrivals" } };

export default async function NewArrivals({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const f = { ...parseFilters(await searchParams), onlyNew: true };
  const t = await getStorefrontTenant();
  const [result, fc] = await Promise.all([listProducts(t.id, f), facets(t.id)]);
  return <ProductListing title="New arrivals" intro="The latest additions to the range." basePath="/new-arrivals" filters={f} result={result} facets={fc} />;
}
