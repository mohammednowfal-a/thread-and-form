import type { Metadata } from "next";
import { getStorefrontTenant } from "@/lib/tenant";
import { facets, listProducts, parseFilters } from "@/lib/catalog";
import { ProductListing } from "@/components/ProductListing";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shop all", description: "Every THREAD & FORM piece: tees, shirts, hoodies, trousers and outerwear.", alternates: { canonical: "/shop" } };

export default async function Shop({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const f = parseFilters(await searchParams);
  const t = await getStorefrontTenant();
  const [result, fc] = await Promise.all([listProducts(t.id, f), facets(t.id)]);
  return <ProductListing title="Shop all" basePath="/shop" filters={f} result={result} facets={fc} />;
}
