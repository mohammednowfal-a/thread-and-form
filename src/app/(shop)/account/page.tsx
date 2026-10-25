import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { getCustomer } from "@/lib/auth";
import { orderToken } from "@/lib/orderAccess";
import { formatMoney } from "@/lib/money";
import { STATUS_LABEL } from "@/lib/orderStatus";
import { AddressForm } from "@/components/AuthForms";
import { deleteAddressAction, logoutAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your account", robots: { index: false } };

export default async function Account() {
  const c = await getCustomer();
  if (!c) redirect("/login");
  const [orders, addresses] = await Promise.all([
    prisma.order.findMany({ where: { customerId: c.id, tenantId: c.tenantId }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.customerAddress.findMany({ where: { customerId: c.id } }),
  ]);
  return (
    <div className="container-x py-10">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-3xl">Hello, {c.name}</h1><p className="text-sm text-graphite/75">{c.email}</p></div>
        <form action={logoutAction}><button className="btn-outline">Sign out</button></form></div>
      <section className="mt-8" aria-labelledby="oh"><h2 id="oh" className="text-2xl">Order history</h2>
        {orders.length === 0 ? <p className="mt-2 text-graphite/75">No orders yet. <Link href="/shop">Start shopping</Link></p> : (
          <div className="table-wrap mt-3"><table className="tbl"><thead><tr><th>Order</th><th>Date</th><th>Status</th><th>Total</th></tr></thead>
            <tbody>{orders.map((o) => <tr key={o.id}><td><Link href={`/order/${o.publicRef}?t=${orderToken(o.id)}`} className="font-mono">{o.publicRef}</Link></td><td>{o.createdAt.toLocaleDateString("en-IN")}</td><td>{STATUS_LABEL[o.status]}</td><td>{formatMoney(o.totalPaise, o.currency)}</td></tr>)}</tbody></table></div>)}
      </section>
      <section className="mt-10" aria-labelledby="ad"><h2 id="ad" className="text-2xl">Saved addresses</h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">{addresses.map((a) => (
          <li key={a.id} className="panel text-sm"><p className="font-medium">{a.label}{a.isDefault ? " (default)" : ""}</p><p>{a.fullName}, {a.line1}{a.line2 ? `, ${a.line2}` : ""}, {a.city}, {a.state} {a.pincode}</p>
            <form action={deleteAddressAction} className="mt-2"><input type="hidden" name="id" value={a.id} /><button className="text-madder underline">Delete</button></form></li>))}</ul>
        <div className="mt-4"><AddressForm /></div></section>
    </div>
  );
}
