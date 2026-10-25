"use client";
import { useMemo, useState } from "react";
import { addToCart } from "@/app/(shop)/actions";
import { formatMoney } from "@/lib/money";
import { SafeImg } from "./SafeImg";

interface V { id: string; size: string; color: string; colorHex: string; available: number }
interface Img { url: string; alt: string }

export function PurchasePanel({ name, pricePaise, comparePaise, variants, images, soldOutError }: { name: string; pricePaise: number; comparePaise: number | null; variants: V[]; images: Img[]; soldOutError: boolean }) {
  const colors = useMemo(() => [...new Map(variants.map((v) => [v.color, v.colorHex])).entries()], [variants]);
  const firstInStock = variants.find((v) => v.available > 0) ?? variants[0];
  const [color, setColor] = useState(firstInStock?.color ?? "");
  const sizesForColor = variants.filter((v) => v.color === color);
  const [size, setSize] = useState(firstInStock?.size ?? "");
  const current = sizesForColor.find((v) => v.size === size) ?? sizesForColor.find((v) => v.available > 0) ?? sizesForColor[0];
  const [qty, setQty] = useState(1);
  const [thumb, setThumb] = useState<string | null>(null);

  const colorImages = images.filter((i) => i.alt === color);
  const gallery = colorImages.length ? colorImages : images;
  const main = gallery.find((i) => i.url === thumb) ?? gallery[0];
  const avail = current?.available ?? 0;
  const maxQty = Math.min(avail, 10);

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div>
        <div className="aspect-[5/6] overflow-hidden bg-[#E9E9E4]"><SafeImg priority src={main?.url ?? null} alt={`${name} in ${color}`} className="h-full w-full object-cover" /></div>
        {gallery.length > 1 && (
          <ul className="mt-3 flex gap-2">{gallery.map((g) => <li key={g.url}><button type="button" onClick={() => setThumb(g.url)} className="h-20 w-16 overflow-hidden border border-fog" aria-label="Show image"><SafeImg src={g.url} alt="" className="h-full w-full object-cover" /></button></li>)}</ul>
        )}
      </div>
      <form action={addToCart} className="space-y-6">
        <input type="hidden" name="variantId" value={current?.id ?? ""} />
        <p className="flex items-baseline gap-3 text-2xl"><span>{formatMoney(pricePaise)}</span>{comparePaise ? <s className="text-base text-graphite/60">{formatMoney(comparePaise)}</s> : null}<span className="text-sm text-graphite/70">incl. taxes</span></p>
        {soldOutError && <p role="alert" className="err">That size just sold out. Please choose another.</p>}

        <fieldset>
          <legend className="label">Colour: <span className="font-normal">{color}</span></legend>
          <div className="flex flex-wrap gap-2">
            {colors.map(([c, hex]) => (
              <label key={c} className={`flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border-2 ${c === color ? "border-indigo" : "border-transparent"}`}>
                <input type="radio" name="color" value={c} checked={c === color} onChange={() => { setColor(c); setThumb(null); const next = variants.filter((v) => v.color === c); if (!next.find((v) => v.size === size && v.available > 0)) setSize((next.find((v) => v.available > 0) ?? next[0])?.size ?? ""); }} className="sr-only" />
                <span className="h-8 w-8 rounded-full border border-graphite/30" style={{ background: hex }} title={c} /><span className="sr-only">{c}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="label">Size</legend>
          <div className="flex flex-wrap gap-2">
            {sizesForColor.map((v) => (
              <label key={v.id} className={`flex min-h-[44px] min-w-[52px] items-center justify-center border px-3 text-sm ${v.available === 0 ? "cursor-not-allowed text-graphite/40 line-through" : "cursor-pointer"} ${v.size === current?.size ? "border-indigo bg-indigo text-white" : "border-fog bg-white"}`}>
                <input type="radio" name="size" value={v.size} disabled={v.available === 0} checked={v.size === current?.size} onChange={() => setSize(v.size)} className="sr-only" />
                {v.size}<span className="sr-only">{v.available === 0 ? " (sold out)" : ""}</span>
              </label>
            ))}
          </div>
          {current && avail > 0 && avail <= 3 && <p className="mt-2 text-sm text-madder" role="status">Only {avail} left in this size</p>}
        </fieldset>

        <div>
          <label htmlFor="qty" className="label">Quantity</label>
          <select id="qty" name="quantity" value={Math.min(qty, Math.max(maxQty, 1))} onChange={(e) => setQty(Number(e.target.value))} className="input w-28" disabled={avail === 0}>
            {Array.from({ length: Math.max(maxQty, 1) }, (_, i) => i + 1).map((n) => <option key={n}>{n}</option>)}
          </select>
        </div>
        <button type="submit" className="btn-primary w-full sm:w-auto sm:min-w-[260px]" disabled={avail === 0}>{avail === 0 ? "Sold out" : "Add to cart"}</button>
        <p className="text-sm text-graphite/75">Cash on Delivery available. We confirm every order with you on WhatsApp before packing.</p>
      </form>
    </div>
  );
}
