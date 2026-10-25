import Link from "next/link";
import type { Filters, CardProduct } from "@/lib/catalog";
import { ProductCard } from "./ProductCard";

interface Props {
  title: string;
  intro?: string;
  basePath: string;
  filters: Filters;
  result: { total: number; items: CardProduct[]; pages: number };
  facets: { categories: { slug: string; name: string }[]; sizes: string[]; colors: string[] };
  showCategory?: boolean;
  showQuery?: boolean;
}

export function ProductListing({ title, intro, basePath, filters: f, result, facets, showCategory = true, showQuery = false }: Props) {
  const page = f.page ?? 1;
  const href = (p: number) => {
    const q = new URLSearchParams();
    if (f.q) q.set("q", f.q);
    if (f.category && showCategory) q.set("category", f.category);
    if (f.minPrice !== undefined) q.set("min", String(f.minPrice));
    if (f.maxPrice !== undefined) q.set("max", String(f.maxPrice));
    if (f.size) q.set("size", f.size);
    if (f.color) q.set("color", f.color);
    if (f.sort && f.sort !== "newest") q.set("sort", f.sort);
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  return (
    <div className="container-x py-10">
      <h1 className="text-3xl sm:text-4xl">{title}</h1>
      {intro && <p className="mt-2 max-w-prose text-graphite/80">{intro}</p>}
      <form method="get" action={basePath} className="stitch mt-6 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6" aria-label="Filter products">
        {showQuery && <div className="lg:col-span-2"><label className="label" htmlFor="f-q">Search</label><input id="f-q" name="q" defaultValue={f.q} className="input" type="search" /></div>}
        {showCategory && (
          <div><label className="label" htmlFor="f-cat">Category</label>
            <select id="f-cat" name="category" defaultValue={f.category ?? ""} className="input"><option value="">All</option>{facets.categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</select></div>
        )}
        <div><label className="label" htmlFor="f-size">Size</label>
          <select id="f-size" name="size" defaultValue={f.size ?? ""} className="input"><option value="">Any</option>{facets.sizes.map((s) => <option key={s}>{s}</option>)}</select></div>
        <div><label className="label" htmlFor="f-color">Colour</label>
          <select id="f-color" name="color" defaultValue={f.color ?? ""} className="input"><option value="">Any</option>{facets.colors.map((s) => <option key={s}>{s}</option>)}</select></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label" htmlFor="f-min">Min ₹</label><input id="f-min" name="min" inputMode="numeric" defaultValue={f.minPrice} className="input" /></div>
          <div><label className="label" htmlFor="f-max">Max ₹</label><input id="f-max" name="max" inputMode="numeric" defaultValue={f.maxPrice} className="input" /></div>
        </div>
        <div><label className="label" htmlFor="f-sort">Sort by</label>
          <select id="f-sort" name="sort" defaultValue={f.sort} className="input">
            <option value="newest">Newest</option><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option><option value="name">Name</option>
          </select></div>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-6">
          <button className="btn-primary" type="submit">Apply filters</button>
          <Link href={basePath} className="btn-outline">Clear</Link>
          <p className="ml-auto text-sm text-graphite/70" role="status">{result.total} product{result.total === 1 ? "" : "s"}</p>
        </div>
      </form>

      {result.items.length === 0 ? (
        <div className="panel mt-8 text-center"><p className="font-display text-xl">No products match those filters</p><p className="mt-1 text-sm text-graphite/70">Try removing a filter or widening the price range.</p><Link href={basePath} className="btn-primary mt-4">Clear filters</Link></div>
      ) : (
        <ul className="mt-8 grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
          {result.items.map((p) => <li key={p.id}><ProductCard p={p} /></li>)}
        </ul>
      )}

      {result.pages > 1 && (
        <nav aria-label="Pagination" className="mt-10 flex items-center justify-center gap-3 text-sm">
          {page > 1 ? <Link href={href(page - 1)} className="btn-outline btn-sm" rel="prev">Previous</Link> : <span />}
          <span>Page {page} of {result.pages}</span>
          {page < result.pages ? <Link href={href(page + 1)} className="btn-outline btn-sm" rel="next">Next</Link> : <span />}
        </nav>
      )}
    </div>
  );
}
