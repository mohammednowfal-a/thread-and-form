import type { Metadata } from "next";
import { Policy } from "@/components/Policy";
import { POLICY } from "@/lib/policies";
export const metadata: Metadata = { title: "Returns and refunds", alternates: { canonical: "/returns-policy" } };
export default function Page() {
  return (
    <Policy title="Returns and refunds">
      <p>{POLICY.returnsSummary}</p>
      <h2>Cancelling an order</h2><p>{POLICY.cancellation}</p>
      <h2>How to return</h2><ul><li>Contact support within {POLICY.returnWindowDays} days of delivery with your order reference.</li><li>Items must be unworn, unwashed and have their tags.</li><li>We arrange the pickup. Refunds go to your bank account once the item reaches us.</li></ul>
    </Policy>
  );
}
