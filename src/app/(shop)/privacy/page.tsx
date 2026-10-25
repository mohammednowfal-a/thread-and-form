import type { Metadata } from "next";
import { Policy } from "@/components/Policy";
export const metadata: Metadata = { title: "Privacy policy", alternates: { canonical: "/privacy" } };
export default function Page() {
  return (
    <Policy title="Privacy policy">
      <p>We collect only what we need to deliver your order and look after your account.</p>
      <h2>What we collect</h2>
      <ul><li>Name, mobile number, delivery address and (optionally) email, to deliver and confirm your order.</li><li>Your order history and, if you create an account, your sign-in details (passwords are stored hashed, never in plain text).</li><li>WhatsApp conversation messages with our store number, so we can confirm orders and answer questions.</li></ul>
      <h2>WhatsApp messages</h2>
      <p>We only message you on WhatsApp about your order if you tick the consent box at checkout. Reply STOP at any time to opt out; we will then contact you by phone about any open order.</p>
      <h2>Who sees your data</h2>
      <p>Our staff (by role), our couriers (name, phone and address, for delivery) and our service providers such as WhatsApp (Meta) and email delivery. We do not sell your data.</p>
      <h2>How long we keep it</h2>
      <p>Order records are kept for the period required for accounting and tax. Webhook and message logs are kept for a limited period. Ask us to delete your account and we will, except where the law requires us to keep a record.</p>
      <h2>Contact</h2><p>Questions or deletion requests: see our <a href="/contact">contact page</a>.</p>
    </Policy>
  );
}
