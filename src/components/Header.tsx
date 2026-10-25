import Link from "next/link";
import { getCustomer } from "@/lib/auth";
import { cartCount } from "@/lib/cart";
import { getStorefrontTenant } from "@/lib/tenant";
import { MobileNav } from "./MobileNav";

const LINKS = [
  { href: "/shop", label: "Shop all" },
  { href: "/new-arrivals", label: "New arrivals" },
  { href: "/best-sellers", label: "Best sellers" },
  { href: "/category/t-shirts", label: "T-shirts" },
  { href: "/category/shirts", label: "Shirts" },
  { href: "/category/hoodies", label: "Hoodies" },
  { href: "/category/outerwear", label: "Outerwear" },
  { href: "/track", label: "Track order" },
];

export async function Header() {
  const tenant = await getStorefrontTenant();
  const [customer, count] = await Promise.all([getCustomer(), cartCount(tenant.id)]);
  return (
    <header className="relative sticky top-0 z-30 border-b border-fog bg-chalk/95 backdrop-blur">
      <div className="container-x flex h-16 items-center justify-between gap-3">
        <Link href="/" className="font-display text-xl font-semibold tracking-wide text-indigo-deep no-underline sm:text-2xl">
          THREAD <span className="text-stitch">&amp;</span> FORM
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-5 text-sm lg:flex">
          {LINKS.slice(0, 7).map((l) => <Link key={l.href} href={l.href} className="no-underline hover:underline">{l.label}</Link>)}
        </nav>
        <div className="flex items-center gap-2 sm:gap-3">
          <form action="/search" role="search" className="hidden sm:block">
            <label htmlFor="hdr-q" className="sr-only">Search products</label>
            <input id="hdr-q" name="q" type="search" placeholder="Search" className="input !min-h-[38px] w-36 lg:w-44" />
          </form>
          <Link href={customer ? "/account" : "/login"} className="hidden min-h-[44px] items-center text-sm no-underline hover:underline sm:flex">{customer ? "Account" : "Sign in"}</Link>
          <Link href="/cart" className="btn-outline btn-sm" aria-label={`Cart, ${count} item${count === 1 ? "" : "s"}`}>Cart ({count})</Link>
          <MobileNav links={[...LINKS, { href: "/search", label: "Search" }, { href: customer ? "/account" : "/login", label: customer ? "Account" : "Sign in" }, { href: "/contact", label: "Contact" }]} />
        </div>
      </div>
    </header>
  );
}
