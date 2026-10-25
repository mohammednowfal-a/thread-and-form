import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { getCustomer } from "@/lib/auth";
import { getStorefrontTenant } from "@/lib/tenant";
import { verifyOrderToken } from "@/lib/orderAccess";
import { formatMoney } from "@/lib/money";
import { CUSTOMER_CANCELLABLE, STATUS_LABEL } from "@/lib/orderStatus";
import { customerCancelOrder } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your order", robots: { index: false, follow: false } };

type Props = { params: Promise<{ ref: string }>; searchParams: Promise<{ t?: string }> };

export default async function OrderPage({ params, searchParams }: Props) {
  const { ref } = await params;
  const { t } = await searchParams;
  const tenant = await getStorefrontTenant();
  const order = await prisma.order.findUnique({
    where: { tenantId_publicRef: { tenantId: tenant.id, publicRef: ref.toUpperCase() } },
    include: { items: true, history: { orderBy: { createdAt: "asc" } }, shipments: { orderBy: { createdAt: "desc" }, take: 1 }, messages: { where: { direction: "OUTBOUND", templateName: { not: null } }, orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!order) notFound();
  const customer = await getCustomer();
  // 404 (not 403) when access is not proven, so references can't be probed.
  if (!verifyOrderToken(order.id, t) && !(customer && order.customerId === customer.id)) notFound();

  const addr = order.shippingAddress as { fullName: string; line1: string; line2?: string; city: string; state: string; pincode: string };
  const msg = order.messages[0];
  const wa = whatsappLine(order.status, order.confirmationStatus, msg?.status, order.whatsappConsent);
  const shipment = order.shipments[0];
  return (
    <div className="container-x max-w-3xl py-10">
      <p className="badge bg-indigo-soft text-indigo">{STATUS_LABEL[order.status]}</p>
      <h1 className="mt-3 text-3xl">{order.status === "PENDING_CONFIRMATION" ? "Thank you. Your order is placed." : `Order ${order.publicRef}`}</h1>
      <p className="mt-2">Order reference: <strong className="font-mono">{order.publicRef}</strong> <span className="text-graphite/70">(keep this to track your order)</span></p>

      <section className="stitch mt-6 p-4" aria-live="polite"><h2 className="text-lg">Confirmation</h2><p className="mt-1 text-sm">{wa}</p></section>

      <section className="panel mt-6"><h2 className="text-lg">Items</h2>
        <ul className="mt-3 divide-y divide-fog">{order.items.map((i) => <li key={i.id} className="flex justify-between gap-4 py-2 text-sm"><span>{i.nameSnapshot} ({i.colorSnapshot}, {i.sizeSnapshot}) × {i.quantity}</span><span>{formatMoney(i.lineTotalPaise, order.currency)}</span></li>)}</ul>
        <dl className="mt-3 space-y-1 border-t border-fog pt-3 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatMoney(order.subtotalPaise, order.currency)}</dd></div>
          <div className="flex justify-between"><dt>Shipping</dt><dd>{order.shippingPaise ? formatMoney(order.shippingPaise, order.currency) : "Free"}</dd></div>
          <div className="flex justify-between text-base font-semibold"><dt>{order.paymentStatus === "COLLECTED" ? "Paid on delivery" : "To pay on delivery"}</dt><dd>{formatMoney(order.totalPaise, order.currency)}</dd></div>
        </dl>
      </section>

      <section className="panel mt-6 text-sm"><h2 className="text-lg">Delivering to</h2><p className="mt-2">{addr.fullName}<br />{addr.line1}{addr.line2 ? `, ${addr.line2}` : ""}<br />{addr.city}, {addr.state} {addr.pincode}</p></section>

      {shipment?.trackingNumber && <section className="panel mt-6 text-sm"><h2 className="text-lg">Shipment</h2><p className="mt-2">Courier: {shipment.provider}. Tracking number: <span className="font-mono">{shipment.trackingNumber}</span></p></section>}

      <section className="mt-6"><h2 className="text-lg">Progress</h2>
        <ol className="mt-3 space-y-2 border-l-2 border-dashed border-indigo/40 pl-4 text-sm">
          {order.history.map((h) => <li key={h.id}><span className="font-medium">{STATUS_LABEL[h.toStatus]}</span> <span className="text-graphite/70">· {h.createdAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span></li>)}
        </ol></section>

      {CUSTOMER_CANCELLABLE.includes(order.status) && (
        <form action={customerCancelOrder} className="mt-8">
          <input type="hidden" name="ref" value={order.publicRef} /><input type="hidden" name="t" value={t ?? ""} />
          <button className="btn-outline" type="submit">Cancel this order</button>
          <p className="hint">You can cancel until your order is packed. No payment is taken.</p>
        </form>
      )}
    </div>
  );
}

function whatsappLine(status: string, conf: string, msg: string | undefined, consent: boolean): string {
  if (status === "CANCELLED") return "This order is cancelled. No payment is needed.";
  if (conf === "CONFIRMED" || (status !== "PENDING_CONFIRMATION" && status !== "CANCELLED")) return "Confirmed. We're getting your order ready.";
  if (!consent) return "We'll call you on your mobile number to confirm this order before packing it.";
  if (conf === "MANUAL_REVIEW" || msg === "FAILED") return "We couldn't reach you on WhatsApp, so our team will call you to confirm this order.";
  if (msg === "DELIVERED" || msg === "READ") return "We've sent a WhatsApp message to your number. Tap Confirm Order there to confirm. Your order is only packed after you confirm.";
  if (msg === "SENT") return "We've sent a WhatsApp message to your number. Tap Confirm Order there to confirm. (It may take a moment to arrive.)";
  return "We're sending a WhatsApp message to your number. Tap Confirm Order in it to confirm. Your order is only packed after you confirm.";
}
