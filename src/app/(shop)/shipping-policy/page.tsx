import type { Metadata } from "next";
import { Policy } from "@/components/Policy";
import { getStorefrontTenant } from "@/lib/tenant";
import { formatMoney } from "@/lib/money";
import { POLICY } from "@/lib/policies";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shipping policy", alternates: { canonical: "/shipping-policy" } };
export default async function Page() {
  const t = await getStorefrontTenant();
  return (
    <Policy title="Shipping policy">
      <p>We ship across India. Delivery usually takes {POLICY.deliveryDaysMin}-{POLICY.deliveryDaysMax} business days after your order is confirmed.</p>
      <h2>Shipping fees</h2><p>Shipping is {formatMoney(t.shippingFeePaise, t.currency)}. It is free on orders of {formatMoney(t.freeShippingThresholdPaise, t.currency)} or more.</p>
      <h2>Cash on Delivery</h2><p>{POLICY.codAvailability} {POLICY.codConfirmation} Orders above {formatMoney(t.codMaxTotalPaise, t.currency)} need approval from our support team.</p>
      <h2>Tracking</h2><p>Once your order ships you can follow it on our <a href="/track">tracking page</a>. We only show a tracking number when the courier has issued a real one.</p>
    </Policy>
  );
}
