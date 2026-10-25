import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getStorefrontTenant } from "@/lib/tenant";
import { facets, listProducts, parseFilters } from "@/lib/catalog";
import { ProductListing } from "@/components/ProductListing";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const t = await getStorefrontTenant();
  const c = await prisma.category.findUnique({ where: { tenantId_slug: { tenantId: t.id, slug } } });
  return c ? { title: c.name, description: c.blurb, alternates: { canonical: `/category/${slug}` } } : {};
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const t = await getStorefrontTenant();
  const cat = await prisma.category.findUnique({ where: { tenantId_slug: { tenantId: t.id, slug } } });
  if (!cat) notFound();
  const f = { ...parseFilters(await searchParams), category: slug };
  const [result, fc] = await Promise.all([listProducts(t.id, f), facets(t.id)]);
  return <ProductListing title={cat.name} intro={cat.blurb} basePath={`/category/${slug}`} filters={f} result={result} facets={fc} showCategory={false} />;
}
