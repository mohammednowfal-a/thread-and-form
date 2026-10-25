"use client";
import { useActionState } from "react";
import { trackAction, type FormState } from "@/app/(shop)/actions";

export function TrackForm() {
  const [s, action, pending] = useActionState(trackAction, {} as FormState);
  return (
    <form action={action} className="panel max-w-md space-y-4">
      {s.error && <p role="alert" className="err">{s.error}</p>}
      <div><label className="label" htmlFor="ref">Order reference</label><input id="ref" name="ref" className="input" placeholder="TF-AB12CD" autoCapitalize="characters" required /></div>
      <div><label className="label" htmlFor="phone">Mobile number on the order</label><input id="phone" name="phone" className="input" inputMode="tel" autoComplete="tel" required /><p className="hint">We check both so nobody else can view your order.</p></div>
      <button className="btn-primary" disabled={pending} type="submit">{pending ? "Checking…" : "Track order"}</button>
    </form>
  );
}
