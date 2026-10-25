import Link from "next/link";
import type { OrderStatus } from "@prisma/client";
import { requireStaff } from "@/lib/auth";
import { listOrders, whatsappStage } from "@/lib/admin/queries";
import { STATUS_LABEL } from "@/lib/orderStatus";
import { formatMoney } from "@/lib/money";
import { PageHead, Pager, Pill, StatusBadge, when } from "@/components/admin";

type SP = Promise<{ status?: string; confirmation?: string; q?: string; page?: string }>;

export default async function Orders({ searchParams }: { searchParams: SP }) {
  const s = await requireStaff("orders.read");
  const sp = await searchParams;
  const status = sp.status && sp.status in STATUS_LABEL ? (sp.status as OrderStatus) : undefined;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const r = await listOrders(s.tenantId, { status, confirmation: sp.confirmation, q: sp.q?.slice(0, 40), page });
  return (
    <>
      <PageHead title="Orders" />
      <form className="panel mb-4 grid gap-3 sm:grid-cols-4" role="search">
        <div><label className="label" htmlFor="q">Search</label><input id="q" name="q" defaultValue={sp.q} placeholder="Ref, name or phone" className="input" /></div>
        <div><label className="label" htmlFor="status">Order status</label><select id="status" name="status" defaultValue={status ?? ""} className="input"><option value="">All</option>{(Object.keys(STATUS_LABEL) as OrderStatus[]).map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}</select></div>
        <div><label className="label" htmlFor="conf">Confirmation</label><select id="conf" name="confirmation" defaultValue={sp.confirmation ?? ""} className="input"><option value="">All</option><option value="AWAITING">Awaiting</option><option value="CONFIRMED">Confirmed</option><option value="MANUAL_REVIEW">Manual review</option><option value="CANCELLED">Cancelled</option></select></div>
        <div className="flex items-end gap-2"><button className="btn-primary">Filter</button><Link href="/admin/orders" className="btn-outline">Clear</Link></div>
      </form>
      <div className="table-wrap"><table className="tbl"><thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>WhatsApp confirmation</th><th>Total</th><th>Placed</th></tr></thead>
        <tbody>{r.items.length === 0 && <tr><td colSpan={6} className="text-center text-graphite/70">No orders match.</td></tr>}
          {r.items.map((o) => <tr key={o.id}><td><Link href={`/admin/orders/${o.id}`} className="font-mono">{o.publicRef}</Link></td><td>{o.contactName}<br /><span className="text-xs text-graphite/65">{o.contactPhone}</span></td><td><StatusBadge s={o.status} /></td>
            <td><Pill>{whatsappStage(o.confirmationStatus, o.status, o.messages[0])}</Pill></td><td>{formatMoney(o.totalPaise, o.currency)}</td><td className="text-xs">{when(o.createdAt)}</td></tr>)}</tbody></table></div>
      <Pager base="/admin/orders" page={page} pages={r.pages} params={{ q: sp.q, status: sp.status, confirmation: sp.confirmation }} />
      <p className="mt-2 text-xs text-graphite/65">{r.total} order(s)</p>
    </>
  );
}
