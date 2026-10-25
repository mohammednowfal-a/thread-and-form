import type { Metadata } from "next";
import { Policy } from "@/components/Policy";
export const metadata: Metadata = { title: "Terms and conditions", alternates: { canonical: "/terms" } };
export default function Page() {
  return (
    <Policy title="Terms and conditions">
      <h2>Orders</h2><p>Placing an order is an offer to buy. A Cash on Delivery order is accepted when you confirm it (by WhatsApp or phone). Orders that are not confirmed in time are cancelled automatically and the items are released.</p>
      <h2>Prices</h2><p>Prices are in Indian rupees and include applicable taxes. The price charged is the price shown when you place your order, re-checked by our server.</p>
      <h2>Payment</h2><p>Cash on Delivery is the only payment method currently available. Please keep the exact amount ready for the courier.</p>
      <h2>Availability</h2><p>Items are reserved when you place an order. If an item cannot be supplied we will tell you and cancel that order without charge.</p>
      <h2>Changes</h2><p>We may update these terms; the version on this page applies to orders placed after the update.</p>
    </Policy>
  );
}
