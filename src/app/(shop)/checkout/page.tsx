import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { getCustomer } from "@/lib/auth";
import { getStorefrontTenant } from "@/lib/tenant";
import { getCartView } from "@/lib/cart";
import { formatMoney } from "@/lib/money";
import { env } from "@/lib/env";
import { CheckoutForm } from "@/components/CheckoutForm";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default async function Checkout() {
  const t = await getStorefrontTenant();
  const [cart, customer] = await Promise.all([getCartView(t), getCustomer()]);
  if (cart.lines.length === 0) redirect("/cart");
  if (cart.lines.some((l) => l.issue && !l.issue.startsWith("Only"))) redirect("/cart");
  if (!customer && env("ALLOW_GUEST_CHECKOUT", "true") === "false") redirect("/login");
  const addr = customer ? await prisma.customerAddress.findFirst({ where: { customerId: customer.id }, orderBy: [{ isDefault: "desc" }] }) : null;
  const defaults = { name: addr?.fullName ?? customer?.name ?? "", phone: addr?.phone ?? customer?.phone ?? "", email: customer?.email ?? "", line1: addr?.line1 ?? "", line2: addr?.line2 ?? "", city: addr?.city ?? "", state: addr?.state ?? "", pincode: addr?.pincode ?? "" };
  return (
    <div className="container-x grid gap-10 py-10 lg:grid-cols-[1fr_380px]">
      <div><h1 className="text-3xl">Checkout</h1>
        {!customer && <p className="mt-2 text-sm text-graphite/75">Checking out as a guest. <Link href="/login">Sign in</Link> to reuse saved addresses.</p>}
        <div className="mt-6"><CheckoutForm idempotencyKey={randomUUID()} defaults={defaults} /></div></div>
      <aside className="panel h-fit space-y-3" aria-label="Order summary">
        <h2 className="text-xl">Your order</h2>
        <ul className="space-y-2 text-sm">{cart.lines.map((l) => <li key={l.itemId} className="flex justify-between gap-3"><span>{l.name} ({l.color}, {l.size}) × {l.quantity}</span><span>{formatMoney(l.linePaise)}</span></li>)}</ul>
        <div className="stitch-b" />
        <p className="flex justify-between text-sm"><span>Subtotal</span><span>{formatMoney(cart.totals.subtotalPaise)}</span></p>
        <p className="flex justify-between text-sm"><span>Shipping</span><span>{cart.totals.shippingPaise === 0 ? "Free" : formatMoney(cart.totals.shippingPaise)}</span></p>
        <p className="flex justify-between text-lg font-semibold"><span>Pay on delivery</span><span>{formatMoney(cart.totals.totalPaise)}</span></p>
        <p className="hint">The final amount is re-checked by our server when you place the order.</p>
      </aside>
    </div>
  );
}
