import Link from "next/link";
import type { OrderStatus } from "@prisma/client";
import { STATUS_LABEL } from "@/lib/orderStatus";

const TONE: Record<OrderStatus, string> = {
  PENDING_CONFIRMATION: "bg-stitch/30 text-graphite", CONFIRMED: "bg-moss/15 text-moss", PROCESSING: "bg-indigo-soft text-indigo", PACKED: "bg-indigo-soft text-indigo",
  SHIPPED: "bg-indigo/15 text-indigo", DELIVERED: "bg-moss/25 text-moss", CANCELLED: "bg-graphite/10 text-graphite", RETURN_REQUESTED: "bg-madder/15 text-madder",
  RETURNED: "bg-graphite/15 text-graphite", FAILED_DELIVERY: "bg-madder/15 text-madder",
};
export const StatusBadge = ({ s }: { s: OrderStatus }) => <span className={`badge ${TONE[s]}`}>{STATUS_LABEL[s]}</span>;
export const Pill = ({ children, tone = "bg-indigo-soft text-indigo" }: { children: React.ReactNode; tone?: string }) => <span className={`badge ${tone}`}>{children}</span>;

export function Stat({ label, value, hint, href }: { label: string; value: string | number; hint?: string; href?: string }) {
  const body = (<><p className="text-sm text-graphite/75">{label}</p><p className="mt-1 font-display text-3xl text-indigo-deep">{value}</p>{hint && <p className="mt-1 text-xs text-graphite/65">{hint}</p>}</>);
  return href ? <Link href={href} className="panel block no-underline hover:bg-indigo-soft/50">{body}</Link> : <div className="panel">{body}</div>;
}

export function PageHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl sm:text-3xl">{title}</h1><div className="flex flex-wrap gap-2">{children}</div></div>;
}

export function Pager({ base, page, pages, params = {} }: { base: string; page: number; pages: number; params?: Record<string, string | undefined> }) {
  if (pages <= 1) return null;
  const href = (p: number) => { const q = new URLSearchParams(); for (const [k, v] of Object.entries(params)) if (v) q.set(k, v); if (p > 1) q.set("page", String(p)); const s = q.toString(); return s ? `${base}?${s}` : base; };
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-center gap-3 text-sm">
      {page > 1 ? <Link className="btn-outline btn-sm" href={href(page - 1)}>Previous</Link> : <span />}
      <span>Page {page} of {pages}</span>
      {page < pages ? <Link className="btn-outline btn-sm" href={href(page + 1)}>Next</Link> : <span />}
    </nav>
  );
}

export const when = (d: Date | null | undefined) => (d ? d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");
