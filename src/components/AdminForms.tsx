"use client";
import { useActionState } from "react";
import { addMember, loginStaffAction, saveProduct, saveSettings, type AdminState } from "@/app/admin/actions";

const init: AdminState = {};
const Msg = ({ s }: { s: AdminState }) => <>{s.error && <p role="alert" className="err">{s.error}</p>}{s.ok && <p role="status" className="text-sm text-moss">{s.ok}</p>}</>;
const F = ({ id, label, children, hint }: { id: string; label: string; children: React.ReactNode; hint?: string }) => <div><label htmlFor={id} className="label">{label}</label>{children}{hint && <p className="hint">{hint}</p>}</div>;

export function StaffLoginForm() {
  const [s, a, p] = useActionState(loginStaffAction, init);
  return (
    <form action={a} className="panel w-full max-w-sm space-y-4"><Msg s={s} />
      <F id="email" label="Work email"><input id="email" name="email" type="email" autoComplete="username" className="input" required /></F>
      <F id="password" label="Password"><input id="password" name="password" type="password" autoComplete="current-password" className="input" required /></F>
      <button className="btn-primary w-full" disabled={p}>{p ? "Signing in…" : "Sign in"}</button></form>
  );
}

interface PDefaults { id?: string; name?: string; slug?: string; sku?: string; categoryId?: string; description?: string; material?: string; fit?: string; price?: string; compare?: string; status?: string; isNew?: boolean; isFeatured?: boolean }
export function ProductForm({ categories, d = {} }: { categories: { id: string; name: string }[]; d?: PDefaults }) {
  const [s, a, p] = useActionState(saveProduct, init);
  return (
    <form action={a} className="panel grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2"><Msg s={s} /></div>
      <input type="hidden" name="id" value={d.id ?? ""} />
      <F id="name" label="Name"><input id="name" name="name" defaultValue={d.name} className="input" required /></F>
      <F id="slug" label="URL slug" hint="Lowercase letters, numbers, dashes"><input id="slug" name="slug" defaultValue={d.slug} className="input" required /></F>
      <F id="sku" label="SKU"><input id="sku" name="sku" defaultValue={d.sku} className="input" required /></F>
      <F id="categoryId" label="Category"><select id="categoryId" name="categoryId" defaultValue={d.categoryId} className="input" required>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></F>
      <F id="price" label="Price (₹)"><input id="price" name="price" inputMode="decimal" defaultValue={d.price} className="input" required /></F>
      <F id="compare" label="Compare-at price (₹, optional)"><input id="compare" name="compare" inputMode="decimal" defaultValue={d.compare} className="input" /></F>
      <F id="material" label="Fabric"><input id="material" name="material" defaultValue={d.material} className="input" /></F>
      <F id="fit" label="Fit"><input id="fit" name="fit" defaultValue={d.fit} className="input" /></F>
      <div className="sm:col-span-2"><F id="description" label="Description"><textarea id="description" name="description" defaultValue={d.description} rows={4} className="input" required /></F></div>
      <F id="status" label="Status"><select id="status" name="status" defaultValue={d.status ?? "DRAFT"} className="input"><option value="DRAFT">Draft (hidden)</option><option value="PUBLISHED">Published</option><option value="ARCHIVED">Archived (hidden)</option></select></F>
      <div className="flex items-end gap-6 pb-2 text-sm"><label className="flex items-center gap-2"><input type="checkbox" name="isNew" defaultChecked={d.isNew} className="h-5 w-5" />New arrival</label><label className="flex items-center gap-2"><input type="checkbox" name="isFeatured" defaultChecked={d.isFeatured} className="h-5 w-5" />Featured</label></div>
      <div className="sm:col-span-2"><button className="btn-primary" disabled={p}>{p ? "Saving…" : "Save product"}</button></div></form>
  );
}

interface SDefaults { name: string; shipping: string; freeThreshold: string; codMax: string; codFee: string; expiryHours: number; supportEmail: string; supportPhone: string; whatsappConfirmEnabled: boolean }
export function SettingsForm({ d }: { d: SDefaults }) {
  const [s, a, p] = useActionState(saveSettings, init);
  return (
    <form action={a} className="panel grid max-w-3xl gap-4 sm:grid-cols-2"><div className="sm:col-span-2"><Msg s={s} /></div>
      <F id="name" label="Store name"><input id="name" name="name" defaultValue={d.name} className="input" required /></F>
      <F id="expiryHours" label="Cancel unconfirmed COD orders after (hours)"><input id="expiryHours" name="expiryHours" type="number" min={1} max={336} defaultValue={d.expiryHours} className="input" /></F>
      <F id="shipping" label="Shipping fee (₹)"><input id="shipping" name="shipping" inputMode="decimal" defaultValue={d.shipping} className="input" /></F>
      <F id="freeThreshold" label="Free shipping from (₹)"><input id="freeThreshold" name="freeThreshold" inputMode="decimal" defaultValue={d.freeThreshold} className="input" /></F>
      <F id="codMax" label="Maximum COD order (₹)"><input id="codMax" name="codMax" inputMode="decimal" defaultValue={d.codMax} className="input" /></F>
      <F id="codFee" label="COD handling fee (₹)"><input id="codFee" name="codFee" inputMode="decimal" defaultValue={d.codFee} className="input" /></F>
      <F id="supportEmail" label="Support email"><input id="supportEmail" name="supportEmail" type="email" defaultValue={d.supportEmail} className="input" /></F>
      <F id="supportPhone" label="Support phone / WhatsApp"><input id="supportPhone" name="supportPhone" defaultValue={d.supportPhone} className="input" /></F>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="whatsappConfirmEnabled" defaultChecked={d.whatsappConfirmEnabled} className="h-5 w-5" />Send COD confirmation requests on WhatsApp (when connected and the customer consented)</label>
      <div className="sm:col-span-2"><button className="btn-primary" disabled={p}>Save settings</button></div></form>
  );
}

export function MemberForm() {
  const [s, a, p] = useActionState(addMember, init);
  return (
    <form action={a} className="panel grid gap-3 sm:grid-cols-4"><div className="sm:col-span-4"><Msg s={s} /></div>
      <F id="m-name" label="Name"><input id="m-name" name="name" className="input" required /></F>
      <F id="m-email" label="Email"><input id="m-email" name="email" type="email" className="input" required /></F>
      <F id="m-role" label="Role"><select id="m-role" name="role" className="input"><option value="ADMIN">Administrator</option><option value="OPS_MANAGER">Operations manager</option><option value="FULFILLMENT">Fulfilment staff</option><option value="SUPPORT">Customer support</option><option value="ANALYST">Read-only analyst</option></select></F>
      <div className="flex items-end"><button className="btn-primary w-full" disabled={p}>Add member</button></div></form>
  );
}
