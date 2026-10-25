import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { appUrl, env } from "@/lib/env";
import { waConfig } from "@/lib/whatsapp/config";
import { aiConfigured } from "@/lib/whatsapp/ai";
import { emailConfigured } from "@/lib/integrations/email";
import { PROVIDERS } from "@/lib/integrations/shipping";
import { shopifyConfigured } from "@/lib/integrations/shopify";
import { PageHead, Pill } from "@/components/admin";
import { shopifyImportAction } from "../../actions";

const Status = ({ ok, label }: { ok: boolean; label?: string }) => <Pill tone={ok ? "bg-stitch/30 text-graphite" : "bg-graphite/10 text-graphite"}>{ok ? (label ?? "Credentials set, not verified live") : "Not connected"}</Pill>;

export default async function Integrations({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const s = await requireStaff("integrations.manage");
  const { msg } = await searchParams;
  const wa = waConfig();
  const missing = [["WHATSAPP_PHONE_NUMBER_ID", wa.phoneNumberId], ["WHATSAPP_ACCESS_TOKEN", wa.accessToken], ["WHATSAPP_VERIFY_TOKEN", wa.verifyToken], ["WHATSAPP_APP_SECRET", wa.appSecret]].filter(([, v]) => !v).map(([k]) => k);
  const card = (title: string, status: React.ReactNode, body: React.ReactNode) => <section className="panel space-y-2"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg">{title}</h2>{status}</div><div className="space-y-2 text-sm">{body}</div></section>;
  return (
    <>
      <PageHead title="Integrations" />
      <p className="mb-4 max-w-prose text-sm text-graphite/80">Secrets live in environment variables and are never shown here. “Credentials set” means values exist; it does not prove the provider accepted them. Send a test order to verify.</p>
      {msg && <p role="status" className="panel mb-4">{msg}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {card("WhatsApp Business (Meta Cloud API)", <Status ok={wa.configured} />, <>
          <p>Webhook URL: <code className="break-all">{appUrl()}/api/webhooks/whatsapp</code></p>
          <p>Missing variables: {missing.length ? missing.join(", ") : "none"}</p>
          <p>Templates (must be approved in Meta): <code>{wa.templates.codConfirm}</code>, <code>{wa.templates.orderStatus}</code> ({wa.templates.language})</p>
          <details><summary className="cursor-pointer">Template text to submit to Meta</summary><pre className="mt-2 whitespace-pre-wrap rounded-sm bg-chalk p-2 text-xs">{`${wa.templates.codConfirm} (Utility)\nHi! Thank you for shopping with THREAD & FORM. Order: {{1}}. Items: {{2}}. COD amount: {{3}}. Please confirm that you want to purchase this and pay the amount on delivery.\nButtons (quick reply): Confirm Order | Cancel Order\n\n${wa.templates.orderStatus} (Utility)\nTHREAD & FORM order {{1}}: {{2}}`}</pre></details></>)}
        {card("AI assistant", <Status ok={aiConfigured()} label="Optional provider configured" />, <p>The assistant answers from your catalogue and policies with deterministic rules. An AI provider is optional and only classifies free-text questions; it can never confirm, cancel or edit orders. {aiConfigured() ? "" : "Currently running in rules-only mode."}</p>)}
        {card("Email", <Status ok={emailConfigured()} />, <p>{emailConfigured() ? "Order and password-reset emails are sent through the configured provider." : "Not connected: emails are queued and skipped, never reported as sent."}</p>)}
        {PROVIDERS.filter((p) => p.id !== "manual").map((p) => card(p.name, <Status ok={p.configured()} />, <><p>{p.note}</p><p>Webhook URL: <code className="break-all">{appUrl()}/api/webhooks/shipping/{p.id}</code> (send header <code>x-webhook-token</code>{env(p.id === "shiprocket" ? "SHIPROCKET_WEBHOOK_TOKEN" : "DELHIVERY_WEBHOOK_TOKEN") ? "" : "; token variable not set, so the endpoint is disabled"})</p></>))}
        {card("Shopify", <Status ok={shopifyConfigured()} />, <><p>One-way import of up to 50 products. Existing products are skipped. Implemented against Shopify&apos;s docs; not verified live.</p>{can(s.role, "integrations.manage") && shopifyConfigured() && <form action={shopifyImportAction}><button className="btn-outline btn-sm">Import products now</button></form>}</>)}
        {card("Online payments", <Pill tone="bg-graphite/10 text-graphite">Not available</Pill>, <p>Cash on Delivery is the only payment method. No online gateway has been built or verified, so none is advertised.</p>)}
      </div>
    </>
  );
}
