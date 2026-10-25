import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { confirmationMonitor, whatsappStage } from "@/lib/admin/queries";
import { waConfig } from "@/lib/whatsapp/config";
import { formatMoney } from "@/lib/money";
import { PageHead, Pill, StatusBadge, Stat, when } from "@/components/admin";
import { replayJobAction, replayWebhookAction } from "../../actions";

export default async function WhatsAppPage() {
  const s = await requireStaff("whatsapp.read");
  const cfg = waConfig();
  const [mon, convs, dead, failedEvents, failedMsgs] = await Promise.all([
    confirmationMonitor(s.tenantId),
    prisma.whatsAppConversation.findMany({ where: { tenantId: s.tenantId }, orderBy: { updatedAt: "desc" }, take: 20, include: { _count: { select: { messages: true } } } }),
    prisma.job.findMany({ where: { tenantId: s.tenantId, status: "DEAD" }, orderBy: { updatedAt: "desc" }, take: 20 }),
    prisma.webhookEvent.findMany({ where: { status: "FAILED" }, orderBy: { receivedAt: "desc" }, take: 20 }),
    prisma.whatsAppMessage.findMany({ where: { tenantId: s.tenantId, direction: "OUTBOUND", status: "FAILED" }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const manage = can(s.role, "jobs.manage");
  return (
    <>
      <PageHead title="WhatsApp confirmations" />
      <p className={`panel mb-4 ${cfg.configured ? "" : "border-madder"}`} role="status">{cfg.configured ? "WhatsApp credentials are set. Delivery is tracked from Meta's status events, not assumed." : "WhatsApp is NOT connected. New COD orders are flagged for manual review (call the customer). See Integrations to connect."}</p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Awaiting customer" value={mon.counts.AWAITING ?? 0} /><Stat label="Confirmed" value={mon.counts.CONFIRMED ?? 0} /><Stat label="Manual review" value={mon.counts.MANUAL_REVIEW ?? 0} /><Stat label="Cancelled" value={mon.counts.CANCELLED ?? 0} /><Stat label="Failed messages" value={failedMsgs.length} />
      </div>
      <section className="mt-6"><h2 className="mb-2 text-lg">Needs attention</h2>
        <div className="table-wrap"><table className="tbl"><thead><tr><th>Order</th><th>Order status</th><th>Confirmation stage</th><th>Message status</th><th>Total</th><th>Placed</th></tr></thead>
          <tbody>{mon.rows.length === 0 && <tr><td colSpan={6} className="text-center text-graphite/70">Nothing needs attention.</td></tr>}{mon.rows.map((o) => <tr key={o.id}><td><Link href={`/admin/orders/${o.id}`} className="font-mono">{o.publicRef}</Link></td><td><StatusBadge s={o.status} /></td><td><Pill>{whatsappStage(o.confirmationStatus, o.status, o.messages[0])}</Pill></td><td>{o.messages[0]?.status ?? "no message"}{o.messages[0]?.errorMessage ? <span className="block text-xs text-madder">{o.messages[0].errorMessage}</span> : null}</td><td>{formatMoney(o.totalPaise, o.currency)}</td><td className="text-xs">{when(o.createdAt)}</td></tr>)}</tbody></table></div></section>
      <section className="mt-6"><h2 className="mb-2 text-lg">Recent conversations</h2>
        <div className="table-wrap"><table className="tbl"><thead><tr><th>Customer</th><th>Messages</th><th>Last customer message</th><th>Consent</th></tr></thead><tbody>{convs.length === 0 && <tr><td colSpan={4} className="text-center text-graphite/70">No conversations yet.</td></tr>}{convs.map((c) => <tr key={c.id}><td><Link href={`/admin/whatsapp/${c.id}`}>{c.profileName ?? "Unknown"}</Link><br /><span className="text-xs text-graphite/65">+{c.waId.slice(0, 2)}…{c.waId.slice(-4)}</span></td><td>{c._count.messages}</td><td>{when(c.lastInboundAt)}</td><td>{c.optedOutAt ? "Opted out" : "OK"}</td></tr>)}</tbody></table></div></section>
      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <div><h2 className="mb-2 text-lg">Dead jobs (gave up after retries)</h2>{dead.length === 0 ? <p className="text-sm text-graphite/70">None.</p> : <ul className="space-y-2 text-sm">{dead.map((j) => <li key={j.id} className="panel"><p className="font-mono text-xs">{j.type} · {j.attempts} attempts</p><p className="text-madder">{j.lastError}</p>{manage && <form action={replayJobAction} className="mt-2"><input type="hidden" name="id" value={j.id} /><button className="btn-outline btn-sm">Replay</button></form>}</li>)}</ul>}</div>
        <div><h2 className="mb-2 text-lg">Failed webhook events</h2>{failedEvents.length === 0 ? <p className="text-sm text-graphite/70">None.</p> : <ul className="space-y-2 text-sm">{failedEvents.map((e) => <li key={e.id} className="panel"><p className="font-mono text-xs">{e.provider} · {when(e.receivedAt)}</p><p className="text-madder">{e.error}</p>{manage && <form action={replayWebhookAction} className="mt-2"><input type="hidden" name="id" value={e.id} /><button className="btn-outline btn-sm">Replay safely</button></form>}</li>)}</ul>}</div>
      </section>
    </>
  );
}
