import Link from "next/link";
export default function NotFound() {
  return <main className="container-x py-24 text-center"><h1 className="text-4xl">We could not find that page</h1><p className="mt-3 text-graphite/75">The link may be old, or the product may no longer be available.</p><div className="mt-6 flex justify-center gap-3"><Link href="/" className="btn-primary">Go to the homepage</Link><Link href="/shop" className="btn-outline">Browse the shop</Link></div></main>;
}
