import Link from "next/link";
import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth";
import { can, ROLE_LABEL, type Permission } from "@/lib/permissions";
import { logoutStaffAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { default: "Operations", template: "%s | Operations" }, robots: { index: false, follow: false } };

const NAV: { href: string; label: string; perm: Permission }[] = [
  { href: "/admin", label: "Overview", perm: "dashboard.view" },
  { href: "/admin/orders", label: "Orders", perm: "orders.read" },
  { href: "/admin/whatsapp", label: "WhatsApp", perm: "whatsapp.read" },
  { href: "/admin/shipping", label: "Shipping", perm: "orders.read" },
  { href: "/admin/returns", label: "Returns", perm: "orders.read" },
  { href: "/admin/products", label: "Products", perm: "products.read" },
  { href: "/admin/inventory", label: "Inventory", perm: "products.read" },
  { href: "/admin/customers", label: "Customers", perm: "customers.read" },
  { href: "/admin/analytics", label: "Analytics", perm: "analytics.view" },
  { href: "/admin/integrations", label: "Integrations", perm: "integrations.manage" },
  { href: "/admin/team", label: "Team", perm: "team.manage" },
  { href: "/admin/audit", label: "Audit log", perm: "audit.read" },
  { href: "/admin/settings", label: "Settings", perm: "settings.manage" },
];

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const s = await requireStaff();
  const links = NAV.filter((n) => can(s.role, n.perm));
  const nav = (cls: string) => <ul className={cls}>{links.map((l) => <li key={l.href}><Link href={l.href} className="flex min-h-[44px] items-center rounded-sm px-3 text-sm no-underline hover:bg-indigo-soft">{l.label}</Link></li>)}</ul>;
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[230px_1fr]">
      <aside className="hidden border-r border-fog bg-white lg:block">
        <div className="p-4"><p className="font-display text-lg">THREAD <span className="text-stitch">&amp;</span> FORM</p><p className="text-xs text-graphite/70">{s.tenantName}</p></div>
        {nav("px-2 pb-6")}
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-fog bg-white px-4 py-2">
          <details className="relative lg:hidden"><summary className="btn-outline btn-sm cursor-pointer list-none">Menu</summary><div className="absolute left-0 top-full z-30 mt-2 w-60 border border-fog bg-white p-2 shadow-lg">{nav("")}</div></details>
          <p className="hidden text-sm text-graphite/75 lg:block">Signed in as <strong>{s.name}</strong> · {ROLE_LABEL[s.role]}</p>
          <form action={logoutStaffAction}><button className="btn-outline btn-sm">Sign out</button></form>
        </header>
        <main id="main" className="p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
