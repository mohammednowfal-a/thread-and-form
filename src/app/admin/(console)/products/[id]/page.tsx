import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { availableOf } from "@/lib/inventory";
import { PageHead } from "@/components/admin";
import { ProductForm } from "@/components/AdminForms";
import { addImage, addVariant, deleteImage } from "../../../actions";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> };

export default async function EditProduct({ params, searchParams }: Props) {
  const s = await requireStaff("products.read");
  const { id } = await params;
  const { error } = await searchParams;
  const p = await prisma.product.findFirst({ where: { id, tenantId: s.tenantId }, include: { images: { orderBy: { position: "asc" } }, variants: { include: { inventory: true }, orderBy: [{ color: "asc" }, { size: "asc" }] } } });
  if (!p) notFound();
  const categories = await prisma.category.findMany({ where: { tenantId: s.tenantId }, orderBy: { position: "asc" } });
  const write = can(s.role, "products.write"), inv = can(s.role, "inventory.write");
  return (
    <>
      <PageHead title={p.name} />
      {error && <p role="alert" className="panel mb-4 border-madder text-madder">{error}</p>}
      {write ? <ProductForm categories={categories} d={{ id: p.id, name: p.name, slug: p.slug, sku: p.sku, categoryId: p.categoryId, description: p.description, material: p.material, fit: p.fit, price: (p.pricePaise / 100).toString(), compare: p.comparePricePaise ? (p.comparePricePaise / 100).toString() : "", status: p.status, isNew: p.isNew, isFeatured: p.isFeatured }} /> : <p className="panel">You have read-only access to products.</p>}

      <section className="mt-8"><h2 className="text-xl">Images</h2>
        <ul className="mt-3 flex flex-wrap gap-3">{p.images.map((i) => <li key={i.id} className="w-28 text-xs">{/* eslint-disable-next-line @next/next/no-img-element */}
<img src={i.url} alt={i.alt} className="aspect-[5/6] w-full border border-fog object-cover" /><span>{i.alt || "no label"}</span>{write && <form action={deleteImage}><input type="hidden" name="id" value={i.id} /><button className="text-madder underline">Remove</button></form>}</li>)}</ul>
        {write && <form action={addImage} className="panel mt-3 grid gap-3 sm:grid-cols-3"><input type="hidden" name="productId" value={p.id} /><div className="sm:col-span-2"><label className="label" htmlFor="url">Image URL (https://…)</label><input id="url" name="url" className="input" required /></div><div><label className="label" htmlFor="alt">Colour label</label><input id="alt" name="alt" className="input" placeholder="e.g. Black" /></div><div className="sm:col-span-3"><button className="btn-outline">Add image</button><p className="hint">Use images you have the right to publish. The demo catalogue uses generated illustrations.</p></div></form>}
      </section>

      <section className="mt-8"><h2 className="text-xl">Variants and stock</h2>
        <div className="table-wrap mt-3"><table className="tbl"><thead><tr><th>Colour</th><th>Size</th><th>SKU</th><th>On hand</th><th>Reserved</th><th>Available</th></tr></thead><tbody>{p.variants.map((v) => <tr key={v.id}><td>{v.color}</td><td>{v.size}</td><td className="font-mono text-xs">{v.sku}</td><td>{v.inventory?.onHand ?? 0}</td><td>{v.inventory?.reserved ?? 0}</td><td>{availableOf(v.inventory)}</td></tr>)}</tbody></table></div>
        {inv && <form action={addVariant} className="panel mt-3 grid gap-3 sm:grid-cols-6"><input type="hidden" name="productId" value={p.id} />
          <div><label className="label" htmlFor="v-size">Size</label><input id="v-size" name="size" className="input" required /></div><div><label className="label" htmlFor="v-color">Colour</label><input id="v-color" name="color" className="input" required /></div>
          <div><label className="label" htmlFor="v-hex">Hex</label><input id="v-hex" name="colorHex" className="input" placeholder="#23242A" /></div><div><label className="label" htmlFor="v-sku">SKU</label><input id="v-sku" name="sku" className="input" required /></div>
          <div><label className="label" htmlFor="v-stock">Stock</label><input id="v-stock" name="stock" type="number" min={0} defaultValue={0} className="input" /></div><div className="flex items-end"><button className="btn-outline w-full">Add variant</button></div></form>}
      </section>
    </>
  );
}
