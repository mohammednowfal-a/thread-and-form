import Link from "next/link";
import { getStorefrontTenant } from "@/lib/tenant";

export async function Footer() {
  const t = await getStorefrontTenant();
  return (
    <footer className="stitch-b mt-24 border-t-2 border-dashed border-indigo/30 bg-indigo-deep text-chalk">
      <div className="container-x grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="font-display text-2xl">THREAD <span className="text-stitch">&amp;</span> FORM</p>
          <p className="mt-3 max-w-xs text-sm text-chalk/80">Clothing cut for the long haul. Pay when it arrives; we confirm every order with you first.</p>
        </div>
        <FooterCol title="Shop" links={[["/shop", "Shop all"], ["/new-arrivals", "New arrivals"], ["/best-sellers", "Best sellers"], ["/search", "Search"]]} />
        <FooterCol title="Help" links={[["/track", "Track an order"], ["/shipping-policy", "Shipping"], ["/returns-policy", "Returns and refunds"], ["/contact", "Contact us"]]} />
        <FooterCol title="Company" links={[["/privacy", "Privacy policy"], ["/terms", "Terms and conditions"], ["/account", "Your account"]]} />
      </div>
      <div className="border-t border-chalk/20 py-4 text-center text-xs text-chalk/70">
        &copy; {new Date().getFullYear()} {t.name}. Prices include taxes.
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <nav aria-label={title}>
      <p className="font-display text-lg">{title}</p>
      <ul className="mt-3 space-y-2 text-sm">
        {links.map(([href, label]) => <li key={href}><Link href={href} className="text-chalk/85 hover:text-white">{label}</Link></li>)}
      </ul>
    </nav>
  );
}
