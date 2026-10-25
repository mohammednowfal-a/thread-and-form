"use client";
import Link from "next/link";
import { useActionState } from "react";
import { forgotPasswordAction, loginAction, registerAction, resetPasswordAction, saveAddressAction, type FormState } from "@/app/(shop)/actions";

const init: FormState = {};
function Msg({ s }: { s: FormState }) {
  return <>{s.error && <p role="alert" className="err">{s.error}</p>}{s.ok && <p role="status" className="text-sm text-moss">{s.ok}</p>}</>;
}

export function LoginForm() {
  const [s, a, p] = useActionState(loginAction, init);
  return (
    <form action={a} className="panel max-w-md space-y-4">
      <Msg s={s} />
      <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" className="input" required /></div>
      <div><label className="label" htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" className="input" required /></div>
      <button className="btn-primary w-full" disabled={p}>{p ? "Signing in…" : "Sign in"}</button>
      <p className="text-sm"><Link href="/forgot-password">Forgot your password?</Link> · <Link href="/register">Create an account</Link></p>
    </form>
  );
}
export function RegisterForm() {
  const [s, a, p] = useActionState(registerAction, init);
  return (
    <form action={a} className="panel max-w-md space-y-4">
      <Msg s={s} />
      <div><label className="label" htmlFor="name">Full name</label><input id="name" name="name" autoComplete="name" className="input" required /></div>
      <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" className="input" required /></div>
      <div><label className="label" htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="new-password" className="input" minLength={10} required /><p className="hint">At least 10 characters, with a letter and a number.</p></div>
      <button className="btn-primary w-full" disabled={p}>{p ? "Creating account…" : "Create account"}</button>
      <p className="text-sm">Already registered? <Link href="/login">Sign in</Link></p>
    </form>
  );
}
export function ForgotForm() {
  const [s, a, p] = useActionState(forgotPasswordAction, init);
  return (
    <form action={a} className="panel max-w-md space-y-4"><Msg s={s} />
      <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" className="input" required /></div>
      <button className="btn-primary w-full" disabled={p}>Send reset link</button></form>
  );
}
export function ResetForm({ token }: { token: string }) {
  const [s, a, p] = useActionState(resetPasswordAction, init);
  return (
    <form action={a} className="panel max-w-md space-y-4"><Msg s={s} /><input type="hidden" name="token" value={token} />
      <div><label className="label" htmlFor="password">New password</label><input id="password" name="password" type="password" autoComplete="new-password" className="input" minLength={10} required /></div>
      <button className="btn-primary w-full" disabled={p}>Save new password</button></form>
  );
}
export function AddressForm() {
  const [s, a, p] = useActionState(saveAddressAction, init);
  const f = (n: string, l: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => <div><label className="label" htmlFor={`a-${n}`}>{l}</label><input id={`a-${n}`} name={n} className="input" {...extra} /></div>;
  return (
    <form action={a} className="panel grid gap-3 sm:grid-cols-2"><div className="sm:col-span-2"><Msg s={s} /></div>
      {f("label", "Label", { defaultValue: "Home" })}{f("fullName", "Full name", { required: true })}{f("phone", "Mobile", { required: true, inputMode: "tel" })}{f("line1", "Address line 1", { required: true })}
      {f("line2", "Address line 2")}{f("city", "City", { required: true })}{f("state", "State", { required: true })}{f("pincode", "PIN code", { required: true, inputMode: "numeric", maxLength: 6 })}
      <button className="btn-primary sm:col-span-2" disabled={p}>Save address</button></form>
  );
}
