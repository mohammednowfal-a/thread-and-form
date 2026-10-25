import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { overview } from "@/lib/admin/queries";
import { formatMoney } from "@/lib/money";
import { STATUS_LABEL } from "@/lib/orderStatus";
import { PageHead, StatusBadge, Stat, when } from "@/components/admin";
import type { OrderStatus } from "@prisma/client";

export default async function Overview() {
  const s = await requireStaff("dashboard.view");
  const o = await overview(s.tenantId);
  const statuses = Object.keys(STATUS_LABEL) as OrderStatus[];
  return (
    <>
      <PageHead title="Overview" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Awaiting WhatsApp confirmation" value={o.awaiting} href="/admin/whatsapp" />
        <Stat label="Needs manual review" value={o.manual} hint="Call these customers" href="/admin/whatsapp" />
        <Stat label="Confirmed by customer" value={o.confirmed} />
        <Stat label="Cancellation rate" value={`${(o.cancellationRate * 100).toFixed(1)}%`} hint={`${o.cancelled} of ${o.total} orders`} />
        <Stat label="Cash collected" value={formatMoney(o.collectedPaise)} hint="COD orders marked delivered" />
        <Stat label="Expected COD in pipeline" value={formatMoney(o.pipelinePaise)} hint="Confirmed, not yet delivered" />
        <Stat label="Failed WhatsApp messages (7 days)" value={o.failedMsgs} href="/admin/whatsapp" />
        <Stat label="Dead jobs / failed webhooks" value={`${o.deadJobs} / ${o.failedEvents}`} href="/admin/whatsapp" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="panel"><h2 className="text-lg">Orders by status</h2>
          <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">{statuses.map((st) => <li key={st} className="flex justify-between"><Link href={`/admin/orders?status=${st}`}>{STATUS_LABEL[st]}</Link><span>{o.byStatus[st] ?? 0}</span></li>)}</ul></section>
        <section className="panel"><h2 className="text-lg">Inventory alerts</h2>
          {o.lowStock.length === 0 ? <p className="mt-3 text-sm text-graphite/70">Nothing is running low.</p> : <ul className="mt-3 space-y-1 text-sm">{o.lowStock.map((r) => <li key={r.id} className="flex justify-between gap-3"><span>{r.variant.product.name} ({r.variant.color}, {r.variant.size})</span><span className={r.onHand - r.reserved === 0 ? "font-semibold text-madder" : ""}>{r.onHand - r.reserved} left</span></li>)}</ul>}
          <Link href="/admin/inventory" className="mt-3 inline-block text-sm">Manage inventory</Link></section>
        <section className="panel"><h2 className="text-lg">Best-selling products</h2>
          {o.top.length === 0 ? <p className="mt-3 text-sm text-graphite/70">No sales yet.</p> : <ul className="mt-3 space-y-1 text-sm">{o.top.map((t) => <li key={t.name} className="flex justify-between gap-3"><span>{t.name}</span><span>{t.units} units · {formatMoney(t.revenuePaise)}</span></li>)}</ul>}</section>
        <section className="panel"><h2 className="text-lg">Recent orders</h2>
          {o.recent.length === 0 ? <p className="mt-3 text-sm text-graphite/70">No orders yet.</p> : <ul className="mt-3 divide-y divide-fog text-sm">{o.recent.map((r) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><Link href={`/admin/orders/${r.id}`} className="font-mono">{r.publicRef}</Link><StatusBadge s={r.status} /><span>{formatMoney(r.totalPaise, r.currency)}</span><span className="text-xs text-graphite/65">{when(r.createdAt)}</span></li>)}</ul>}</section>
      </div>
    </>
  );
}
