import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

// The header/footer read the tenant and cart from the database, so every storefront page is rendered per request.
export const dynamic = "force-dynamic";

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main id="main" className="min-h-[60vh]">{children}</main>
      <Footer />
    </>
  );
}
