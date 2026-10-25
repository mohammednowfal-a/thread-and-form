import Link from "next/link";
import type { Metadata } from "next";
import { getStorefrontTenant } from "@/lib/tenant";
import { getCartView } from "@/lib/cart";
import { formatMoney } from "@/lib/money";
import { changeCartVariant, removeFromCart, updateCartQty } from "../actions";
import { SafeImg } from "@/components/SafeImg";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your cart", robots: { index: false } };

export default async function CartPage() {
  const t = await getStorefrontTenant();
  const cart = await getCartView(t);
  if (cart.lines.length === 0) {
    return <div className="container-x py-16 text-center"><h1 className="text-3xl">Your cart is empty</h1><p className="mt-2 text-graphite/75">Add something you like and it will wait for you here.</p><Link href="/shop" className="btn-primary mt-6">Start shopping</Link></div>;
  }
  const blocked = cart.lines.some((l) => l.issue && !l.issue.startsWith("Only"));
  return (
    <div className="container-x grid gap-10 py-10 lg:grid-cols-[1fr_360px]">
      <div>
        <h1 className="text-3xl">Your cart</h1>
        <ul className="mt-6 divide-y divide-fog border-y border-fog">
          {cart.lines.map((l) => (
            <li key={l.itemId} className="grid grid-cols-[88px_1fr] gap-4 py-5 sm:grid-cols-[110px_1fr_auto]">
              <div className="aspect-[5/6] overflow-hidden bg-[#E9E9E4]"><SafeImg src={l.image} alt="" className="h-full w-full object-cover" /></div>
              <div className="space-y-2">
                <Link href={`/product/${l.slug}`} className="font-display text-lg">{l.name}</Link>
                <p className="text-sm text-graphite/75">{l.color} / {l.size} · {formatMoney(l.unitPricePaise)} each</p>
                {l.issue && <p role="alert" className="badge bg-madder/10 text-madder">{l.issue}</p>}
                <div className="flex flex-wrap items-end gap-3">
                  <form action={changeCartVariant} className="flex items-end gap-2">
                    <input type="hidden" name="itemId" value={l.itemId} />
                    <div><label className="label" htmlFor={`v-${l.itemId}`}>Option</label>
                      <select id={`v-${l.itemId}`} name="variantId" defaultValue={l.variantId} className="input !min-h-[40px]">
                        {l.siblings.map((s) => <option key={s.id} value={s.id} disabled={s.available === 0 && s.id !== l.variantId}>{s.color} / {s.size}{s.available === 0 ? " (sold out)" : ""}</option>)}
                      </select></div>
                    <button className="btn-outline btn-sm" type="submit">Change</button>
                  </form>
                  <form action={updateCartQty} className="flex items-end gap-2">
                    <input type="hidden" name="itemId" value={l.itemId} />
                    <div><label className="label" htmlFor={`q-${l.itemId}`}>Qty</label>
                      <select id={`q-${l.itemId}`} name="quantity" defaultValue={l.quantity} className="input !min-h-[40px] w-20">
                        {Array.from({ length: Math.max(Math.min(Math.max(l.available, l.quantity), 10), 1) }, (_, i) => i + 1).map((n) => <option key={n}>{n}</option>)}
                      </select></div>
                    <button className="btn-outline btn-sm" type="submit">Update</button>
                  </form>
                  <form action={removeFromCart}><input type="hidden" name="itemId" value={l.itemId} /><button className="btn-sm min-h-[36px] text-sm text-madder underline" type="submit">Remove</button></form>
                </div>
              </div>
              <p className="col-span-2 text-right font-medium sm:col-span-1">{formatMoney(l.linePaise)}</p>
            </li>
          ))}
        </ul>
      </div>
      <aside className="panel h-fit space-y-3" aria-label="Order summary">
        <h2 className="text-xl">Summary</h2>
        <Row k="Subtotal" v={formatMoney(cart.totals.subtotalPaise)} />
        <Row k="Shipping" v={cart.totals.shippingPaise === 0 ? "Free" : formatMoney(cart.totals.shippingPaise)} />
        {cart.totals.codFeePaise > 0 && <Row k="COD fee" v={formatMoney(cart.totals.codFeePaise)} />}
        <div className="stitch-b" />
        <Row k="Total (pay on delivery)" v={formatMoney(cart.totals.totalPaise)} bold />
        {cart.totals.shippingPaise > 0 && <p className="hint">Free shipping on orders of {formatMoney(t.freeShippingThresholdPaise)} or more.</p>}
        {blocked ? <p role="alert" className="err">Remove or change unavailable items to continue.</p> : <Link href="/checkout" className="btn-primary w-full">Checkout</Link>}
      </aside>
    </div>
  );
}
const Row = ({ k, v, bold }: { k: string; v: string; bold?: boolean }) => <p className={`flex justify-between gap-4 ${bold ? "text-lg font-semibold" : "text-sm"}`}><span>{k}</span><span>{v}</span></p>;
