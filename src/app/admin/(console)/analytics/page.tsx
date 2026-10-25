import { requireStaff } from "@/lib/auth";
import { analytics, overview } from "@/lib/admin/queries";
import { formatMoney } from "@/lib/money";
import { PageHead, Stat } from "@/components/admin";

export default async function Analytics() {
  const s = await requireStaff("analytics.view");
  const [days, o] = await Promise.all([analytics(s.tenantId, 14), overview(s.tenantId)]);
  const max = Math.max(1, ...days.map((d) => d.orders));
  return (
    <>
      <PageHead title="Analytics" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Total orders" value={o.total} /><Stat label="Cancellation rate" value={`${(o.cancellationRate * 100).toFixed(1)}%`} />
        <Stat label="Cash collected" value={formatMoney(o.collectedPaise)} hint="Revenue = COD orders marked delivered (cash collected)" /><Stat label="Expected COD" value={formatMoney(o.pipelinePaise)} hint="Confirmed, processing, packed or shipped" />
      </div>
      <section className="panel mt-6"><h2 className="text-lg">Orders per day (last 14 days, excluding cancelled)</h2>
        {days.length === 0 ? <p className="mt-3 text-sm text-graphite/70">No orders in this period.</p> : (
          <ul className="mt-4 space-y-2">{days.map((d) => <li key={d.day.toISOString()} className="grid grid-cols-[84px_1fr_auto] items-center gap-3 text-sm"><span>{d.day.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span><span className="h-5 bg-indigo-soft"><span className="block h-5 bg-indigo" style={{ width: `${(d.orders / max) * 100}%` }} /></span><span>{d.orders} · {formatMoney(d.valuePaise)}</span></li>)}</ul>)}
      </section>
      <section className="panel mt-6"><h2 className="text-lg">Best-selling products</h2>{o.top.length === 0 ? <p className="mt-3 text-sm text-graphite/70">No sales yet.</p> : <ul className="mt-3 space-y-1 text-sm">{o.top.map((t) => <li key={t.name} className="flex justify-between"><span>{t.name}</span><span>{t.units} units · {formatMoney(t.revenuePaise)}</span></li>)}</ul>}</section>
    </>
  );
}
