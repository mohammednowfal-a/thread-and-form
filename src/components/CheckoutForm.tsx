"use client";
import { useActionState } from "react";
import { placeOrderAction, type FormState } from "@/app/(shop)/actions";

const init: FormState = {};
interface Defaults { name: string; phone: string; email: string; line1: string; line2: string; city: string; state: string; pincode: string }

export function CheckoutForm({ idempotencyKey, defaults }: { idempotencyKey: string; defaults: Defaults }) {
  const [state, action, pending] = useActionState(placeOrderAction, init);
  const fe = state.fieldErrors ?? {};
  const field = (name: keyof Defaults, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: string) => (
    <div>
      <label htmlFor={name} className="label">{label}</label>
      <input id={name} name={name} defaultValue={defaults[name]} className="input" aria-invalid={!!fe[name]} aria-describedby={fe[name] ? `${name}-e` : undefined} {...props} />
      {hint && !fe[name] && <p className="hint">{hint}</p>}
      {fe[name] && <p id={`${name}-e`} className="err">{fe[name]}</p>}
    </div>
  );
  return (
    <form action={action} className="space-y-8" noValidate>
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {state.error && <p role="alert" className="panel border-madder text-madder">{state.error}</p>}
      <fieldset className="space-y-4"><legend className="font-display text-xl">Contact</legend>
        {field("name", "Full name", { autoComplete: "name", required: true })}
        {field("phone", "Mobile number", { autoComplete: "tel", inputMode: "tel", required: true }, "Used for delivery and for your WhatsApp order confirmation.")}
        {field("email", "Email (optional)", { autoComplete: "email", type: "email" })}
      </fieldset>
      <fieldset className="space-y-4"><legend className="font-display text-xl">Delivery address</legend>
        {field("line1", "Address line 1", { autoComplete: "address-line1", required: true })}
        {field("line2", "Address line 2 (optional)", { autoComplete: "address-line2" })}
        <div className="grid gap-4 sm:grid-cols-3">
          {field("city", "City", { autoComplete: "address-level2", required: true })}
          {field("state", "State", { autoComplete: "address-level1", required: true })}
          {field("pincode", "PIN code", { autoComplete: "postal-code", inputMode: "numeric", maxLength: 6, required: true })}
        </div>
      </fieldset>
      <fieldset className="space-y-3"><legend className="font-display text-xl">Payment</legend>
        <label className="stitch flex items-start gap-3 p-4"><input type="radio" name="paymentMethod" value="COD" defaultChecked className="mt-1 h-5 w-5" />
          <span><span className="font-medium">Cash on Delivery</span><span className="block text-sm text-graphite/75">Pay the courier when your order arrives. Online payment is not available yet.</span></span></label>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="whatsappConsent" className="mt-1 h-5 w-5" />
          <span>Send my order confirmation to this number on WhatsApp. I understand my order is only packed after I confirm. Reply STOP any time to opt out. <span className="block text-graphite/70">If you leave this unticked, our team will call you to confirm instead.</span></span></label>
      </fieldset>
      <button className="btn-primary w-full sm:w-auto sm:min-w-[260px]" type="submit" disabled={pending}>{pending ? "Placing your order…" : "Place order (Cash on Delivery)"}</button>
    </form>
  );
}
