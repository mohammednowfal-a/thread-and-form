import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { isSoldOut, type CardProduct } from "@/lib/catalog";
import { SafeImg } from "./SafeImg";

export function ProductCard({ p }: { p: CardProduct }) {
  const sold = isSoldOut(p);
  const colors = [...new Map(p.variants.map((v) => [v.color, v.colorHex])).entries()];
  return (
    <article className="group">
      <Link href={`/product/${p.slug}`} className="block no-underline">
        <div className="relative aspect-[5/6] overflow-hidden bg-[#E9E9E4]">
          <SafeImg src={p.images[0]?.url ?? null} alt={p.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
          {sold && <span className="badge absolute left-3 top-3 bg-graphite text-white">Sold out</span>}
          {!sold && p.isNew && <span className="badge absolute left-3 top-3 bg-stitch text-graphite">New</span>}
        </div>
        <h3 className="mt-3 font-display text-lg leading-snug">{p.name}</h3>
      </Link>
      <p className="mt-1 flex items-baseline gap-2 text-sm">
        <span className="font-medium">{formatMoney(p.pricePaise)}</span>
        {p.comparePricePaise ? <s className="text-graphite/60">{formatMoney(p.comparePricePaise)}</s> : null}
      </p>
      <ul className="mt-2 flex gap-1.5" aria-label="Colours">
        {colors.map(([name, hex]) => (
          <li key={name} title={name} className="h-3.5 w-3.5 rounded-full border border-graphite/30" style={{ background: hex }}><span className="sr-only">{name}</span></li>
        ))}
      </ul>
    </article>
  );
}
