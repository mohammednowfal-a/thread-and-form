import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getOrder, whatsappStage } from "@/lib/admin/queries";
import { STATUS_LABEL, TRANSITIONS } from "@/lib/orderStatus";
import { formatMoney } from "@/lib/money";
import { PROVIDERS } from "@/lib/integrations/shipping";
import { PageHead, Pill, StatusBadge, when } from "@/components/admin";
import { addShipment, createReturn, resendConfirmation, updateOrderStatus } from "../../../actions";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> };

export default async function OrderDetail({ params, searchParams }: Props) {
  const s = await requireStaff("orders.read");
  const { id } = await params;
  const { error } = await searchParams;
  const o = await getOrder(s.tenantId, id); // tenant-scoped: another tenant's id simply returns null
  if (!o) notFound();
  const addr = o.shippingAddress as { fullName: string; line1: string; line2?: string; city: string; state: string; pincode: string };
  const next = TRANSITIONS[o.status].filter((t) => (t === "CANCELLED" ? can(s.role, "orders.cancel") : t === "CONFIRMED" ? can(s.role, "orders.update") : can(s.role, "orders.fulfil")));
  const codMsg = o.messages.filter((m) => m.direction === "OUTBOUND" && m.templateName).at(-1);
  const canShip = ["CONFIRMED", "PROCESSING", "PACKED"].includes(o.status) && can(s.role, "orders.fulfil");
  return (
    <>
      <PageHead title={`Order ${o.publicRef}`}><Link href="/admin/orders" className="btn-outline btn-sm">All orders</Link></PageHead>
      {error && <p role="alert" className="panel mb-4 border-madder text-madder">{error}</p>}
      <div className="mb-4 flex flex-wrap items-center gap-2"><StatusBadge s={o.status} /><Pill>{whatsappStage(o.confirmationStatus, o.status, codMsg)}</Pill><Pill tone="bg-graphite/10 text-graphite">Payment: COD · {o.paymentStatus.toLowerCase()}</Pill></div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="panel"><h2 className="text-lg">Items</h2>
            <div className="table-wrap mt-3"><table className="tbl"><thead><tr><th>Item</th><th>SKU</th><th>Unit</th><th>Qty</th><th>Total</th></tr></thead><tbody>{o.items.map((i) => <tr key={i.id}><td>{i.nameSnapshot}<br /><span className="text-xs text-graphite/65">{i.colorSnapshot} / {i.sizeSnapshot}</span></td><td className="font-mono text-xs">{i.skuSnapshot}</td><td>{formatMoney(i.unitPricePaise, o.currency)}</td><td>{i.quantity}</td><td>{formatMoney(i.lineTotalPaise, o.currency)}</td></tr>)}</tbody></table></div>
            <dl className="ml-auto mt-3 max-w-xs space-y-1 text-sm"><div className="flex justify-between"><dt>Subtotal</dt><dd>{formatMoney(o.subtotalPaise, o.currency)}</dd></div><div className="flex justify-between"><dt>Shipping</dt><dd>{formatMoney(o.shippingPaise, o.currency)}</dd></div>{o.codFeePaise > 0 && <div className="flex justify-between"><dt>COD fee</dt><dd>{formatMoney(o.codFeePaise, o.currency)}</dd></div>}<div className="flex justify-between text-base font-semibold"><dt>COD total</dt><dd>{formatMoney(o.totalPaise, o.currency)}</dd></div></dl></section>

          <section className="panel"><h2 className="text-lg">WhatsApp confirmation</h2>
            <p className="mt-2 text-sm">Confirmation: <strong>{o.confirmationStatus.replace(/_/g, " ").toLowerCase()}</strong>{o.confirmedAt && <> · confirmed {when(o.confirmedAt)} via {o.confirmationSource}</>}{!o.whatsappConsent && <> · customer did <strong>not</strong> consent to WhatsApp, confirm by phone</>}</p>
            {o.messages.length === 0 ? <p className="mt-2 text-sm text-graphite/70">No WhatsApp messages for this order yet.</p> : (
              <ul className="mt-3 space-y-2 text-sm">{o.messages.map((m) => <li key={m.id} className={`rounded-sm border p-2 ${m.direction === "OUTBOUND" ? "border-indigo/30 bg-indigo-soft/50" : "border-fog bg-white"}`}>
                <p className="flex flex-wrap justify-between gap-2 text-xs text-graphite/70"><span>{m.direction === "OUTBOUND" ? "Sent by us" : "From customer"} · {m.kind}</span><span>Message status: <strong>{m.status}</strong>{m.errorCode ? ` (${m.errorCode}: ${m.errorMessage ?? ""})` : ""}</span></p>
                <p className="mt-1 whitespace-pre-wrap">{m.body}</p><p className="mt-1 text-xs text-graphite/60">{when(m.createdAt)}{m.deliveredAt ? ` · delivered ${when(m.deliveredAt)}` : ""}{m.readAt ? ` · read ${when(m.readAt)}` : ""}</p></li>)}</ul>)}
            {o.status === "PENDING_CONFIRMATION" && can(s.role, "whatsapp.manage") && <form action={resendConfirmation} className="mt-3"><input type="hidden" name="orderId" value={o.id} /><button className="btn-outline btn-sm">Re-send confirmation request</button></form>}
          </section>

          <section className="panel"><h2 className="text-lg">History</h2><ol className="mt-3 space-y-2 border-l-2 border-dashed border-indigo/40 pl-4 text-sm">{o.history.map((h) => <li key={h.id}><strong>{STATUS_LABEL[h.toStatus]}</strong> <span className="text-graphite/70">· {h.source} · {when(h.createdAt)}</span>{h.note && <span className="block text-graphite/80">{h.note}</span>}</li>)}</ol></section>
        </div>

        <div className="space-y-6">
          <section className="panel"><h2 className="text-lg">Actions</h2>
            {next.length === 0 ? <p className="mt-2 text-sm text-graphite/70">No further status changes are possible.</p> : (
              <div className="mt-3 flex flex-col gap-2">{next.filter((t) => t !== "CANCELLED").map((t) => <form key={t} action={updateOrderStatus}><input type="hidden" name="orderId" value={o.id} /><input type="hidden" name="to" value={t} /><button className="btn-primary w-full">{t === "CONFIRMED" ? "Mark confirmed (by phone)" : `Mark ${STATUS_LABEL[t].toLowerCase()}`}</button></form>)}
                {next.includes("CANCELLED") && <details><summary className="btn-outline w-full cursor-pointer">Cancel order…</summary><form action={updateOrderStatus} className="mt-2 space-y-2"><input type="hidden" name="orderId" value={o.id} /><input type="hidden" name="to" value="CANCELLED" /><label className="label" htmlFor="note">Reason</label><input id="note" name="note" className="input" required /><button className="btn-danger w-full">Cancel and release stock</button></form></details>}</div>)}
          </section>

          <section className="panel text-sm"><h2 className="text-lg">Customer</h2><p className="mt-2">{o.contactName}<br />+{o.contactPhone}{o.contactEmail && <><br />{o.contactEmail}</>}</p><p className="mt-2">{addr.line1}{addr.line2 ? `, ${addr.line2}` : ""}<br />{addr.city}, {addr.state} {addr.pincode}</p></section>

          <section className="panel text-sm"><h2 className="text-lg">Shipment</h2>
            {o.shipments.length === 0 && <p className="mt-2 text-graphite/70">No shipment yet. Nothing is shown as shipped until a real tracking number exists.</p>}
            {o.shipments.map((sh) => <p key={sh.id} className="mt-2">{sh.provider}: <span className="font-mono">{sh.trackingNumber}</span> · {sh.status}</p>)}
            {canShip && <form action={addShipment} className="mt-3 space-y-2"><input type="hidden" name="orderId" value={o.id} />
              <label className="label" htmlFor="prov">Courier</label><select id="prov" name="provider" className="input">{PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}{p.configured() ? "" : " (not connected)"}</option>)}</select>
              <label className="label" htmlFor="trk">Tracking number (manual only)</label><input id="trk" name="trackingNumber" className="input" placeholder="From the courier" />
              <button className="btn-outline w-full">Add shipment</button></form>}
          </section>

          {o.status === "DELIVERED" && can(s.role, "returns.manage") && <section className="panel"><h2 className="text-lg">Return</h2><form action={createReturn} className="mt-2 space-y-2"><input type="hidden" name="orderId" value={o.id} /><label className="label" htmlFor="reason">Reason</label><input id="reason" name="reason" className="input" required /><button className="btn-outline w-full">Log return request</button></form></section>}
        </div>
      </div>
    </>
  );
}
