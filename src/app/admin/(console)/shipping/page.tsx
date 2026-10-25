import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { PageHead, StatusBadge, when } from "@/components/admin";
import { PROVIDERS } from "@/lib/integrations/shipping";

export default async function Shipping() {
  const s = await requireStaff("orders.read");
  const [ready, shipments] = await Promise.all([
    prisma.order.findMany({ where: { tenantId: s.tenantId, status: { in: ["CONFIRMED", "PROCESSING", "PACKED"] } }, orderBy: { createdAt: "asc" }, take: 50, include: { shipments: true } }),
    prisma.shipment.findMany({ where: { tenantId: s.tenantId }, orderBy: { createdAt: "desc" }, take: 30, include: { order: { select: { id: true, publicRef: true, status: true } } } }),
  ]);
  return (
    <>
      <PageHead title="Shipping and fulfilment" />
      <ul className="mb-6 flex flex-wrap gap-2 text-sm">{PROVIDERS.map((p) => <li key={p.id} className="panel !p-3"><strong>{p.name}</strong>: {p.id === "manual" ? "available" : p.configured() ? "credentials set (not verified live)" : "Not connected"}</li>)}</ul>
      <h2 className="mb-2 text-lg">Ready to fulfil ({ready.length})</h2>
      <div className="table-wrap"><table className="tbl"><thead><tr><th>Order</th><th>Status</th><th>Shipment</th><th>Placed</th></tr></thead><tbody>{ready.length === 0 && <tr><td colSpan={4} className="text-center text-graphite/70">No confirmed orders waiting.</td></tr>}{ready.map((o) => <tr key={o.id}><td><Link className="font-mono" href={`/admin/orders/${o.id}`}>{o.publicRef}</Link></td><td><StatusBadge s={o.status} /></td><td>{o.shipments[0]?.trackingNumber ?? "none yet"}</td><td className="text-xs">{when(o.createdAt)}</td></tr>)}</tbody></table></div>
      <h2 className="mb-2 mt-8 text-lg">Shipments</h2>
      <div className="table-wrap"><table className="tbl"><thead><tr><th>Order</th><th>Courier</th><th>Tracking</th><th>Courier status</th><th>Order status</th></tr></thead><tbody>{shipments.length === 0 && <tr><td colSpan={5} className="text-center text-graphite/70">No shipments yet.</td></tr>}{shipments.map((x) => <tr key={x.id}><td><Link className="font-mono" href={`/admin/orders/${x.order.id}`}>{x.order.publicRef}</Link></td><td>{x.provider}</td><td className="font-mono text-xs">{x.trackingNumber}</td><td>{x.status}</td><td><StatusBadge s={x.order.status} /></td></tr>)}</tbody></table></div>
    </>
  );
}
