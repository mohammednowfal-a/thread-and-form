import type { Metadata } from "next";
import { getStorefrontTenant } from "@/lib/tenant";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Contact and support", alternates: { canonical: "/contact" } };
export default async function Page() {
  const t = await getStorefrontTenant();
  return (
    <div className="container-x max-w-3xl py-12">
      <h1 className="text-3xl sm:text-4xl">Contact and support</h1>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <section className="panel"><h2 className="text-xl">Order help</h2><p className="mt-2 text-sm">Track an order with your reference and mobile number, or cancel it before it is packed.</p><a className="btn-primary mt-3" href="/track">Track an order</a></section>
        <section className="panel"><h2 className="text-xl">Talk to us</h2>
          <ul className="mt-2 space-y-1 text-sm">{t.supportEmail && <li>Email: <a href={`mailto:${t.supportEmail}`}>{t.supportEmail}</a></li>}{t.supportPhone && <li>Phone / WhatsApp: <a href={`tel:${t.supportPhone}`}>{t.supportPhone}</a></li>}{!t.supportEmail && !t.supportPhone && <li>Support details have not been set yet. Add them in Admin → Settings.</li>}</ul></section>
      </div>
    </div>
  );
}
