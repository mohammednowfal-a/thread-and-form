import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PageHead, Pill } from "@/components/admin";
import { adjustStock } from "../../actions";

export default async function Inventory({ searchParams }: { searchParams: Promise<{ error?: string; low?: string }> }) {
  const s = await requireStaff("products.read");
  const { error, low } = await searchParams;
  const rows = await prisma.inventoryRecord.findMany({ where: { tenantId: s.tenantId }, include: { variant: { include: { product: { select: { name: true } } } } }, orderBy: [{ variant: { product: { name: "asc" } } }, { variant: { color: "asc" } }] });
  const shown = low ? rows.filter((r) => r.onHand - r.reserved <= r.lowStockThreshold) : rows;
  const edit = can(s.role, "inventory.write");
  return (
    <>
      <PageHead title="Inventory"><a className="btn-outline btn-sm" href={low ? "/admin/inventory" : "/admin/inventory?low=1"}>{low ? "Show all" : "Low stock only"}</a></PageHead>
      <p className="mb-3 max-w-prose text-sm text-graphite/80">Stock is <strong>reserved</strong> when a COD order is placed, <strong>released</strong> if it is cancelled or expires, and <strong>deducted</strong> when the order ships. You cannot set on-hand below the reserved amount.</p>
      {error && <p role="alert" className="panel mb-3 border-madder text-madder">{error}</p>}
      <div className="table-wrap"><table className="tbl"><thead><tr><th>Product</th><th>Variant</th><th>SKU</th><th>On hand</th><th>Reserved</th><th>Available</th>{edit && <th>Set on hand</th>}</tr></thead>
        <tbody>{shown.map((r) => { const av = r.onHand - r.reserved; return <tr key={r.id}><td>{r.variant.product.name}</td><td>{r.variant.color} / {r.variant.size}</td><td className="font-mono text-xs">{r.variant.sku}</td><td>{r.onHand}</td><td>{r.reserved}</td><td>{av} {av <= r.lowStockThreshold && <Pill tone={av === 0 ? "bg-madder/15 text-madder" : "bg-stitch/30 text-graphite"}>{av === 0 ? "out" : "low"}</Pill>}</td>
          {edit && <td><form action={adjustStock} className="flex gap-2"><input type="hidden" name="variantId" value={r.variantId} /><label className="sr-only" htmlFor={`oh-${r.id}`}>On hand</label><input id={`oh-${r.id}`} name="onHand" type="number" min={r.reserved} defaultValue={r.onHand} className="input !min-h-[36px] w-20" /><label className="sr-only" htmlFor={`re-${r.id}`}>Reason</label><input id={`re-${r.id}`} name="reason" placeholder="Reason" className="input !min-h-[36px] w-32" /><button className="btn-outline btn-sm">Save</button></form></td>}</tr>; })}</tbody></table></div>
    </>
  );
}
