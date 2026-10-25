import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { availableOf } from "@/lib/inventory";
import { PageHead, Pill } from "@/components/admin";

export default async function Products() {
  const s = await requireStaff("products.read");
  const products = await prisma.product.findMany({ where: { tenantId: s.tenantId }, orderBy: { createdAt: "desc" }, include: { category: true, variants: { include: { inventory: true } } } });
  return (
    <>
      <PageHead title="Products">{can(s.role, "products.write") && <Link href="/admin/products/new" className="btn-primary btn-sm">Add product</Link>}</PageHead>
      <div className="table-wrap"><table className="tbl"><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Variants</th><th>Available</th><th>Status</th></tr></thead>
        <tbody>{products.length === 0 && <tr><td colSpan={6} className="text-center text-graphite/70">No products yet. Add your first product.</td></tr>}
          {products.map((p) => <tr key={p.id}><td><Link href={`/admin/products/${p.id}`}>{p.name}</Link><br /><span className="font-mono text-xs text-graphite/65">{p.sku}</span></td><td>{p.category.name}</td><td>{formatMoney(p.pricePaise)}</td><td>{p.variants.length}</td><td>{p.variants.reduce((n, v) => n + availableOf(v.inventory), 0)}</td><td><Pill tone={p.status === "PUBLISHED" ? "bg-moss/15 text-moss" : "bg-graphite/10 text-graphite"}>{p.status.toLowerCase()}</Pill></td></tr>)}</tbody></table></div>
    </>
  );
}
