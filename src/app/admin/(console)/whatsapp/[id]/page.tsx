import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { PageHead, when } from "@/components/admin";

export default async function Conversation({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireStaff("whatsapp.read");
  const { id } = await params;
  const c = await prisma.whatsAppConversation.findFirst({ where: { id, tenantId: s.tenantId }, include: { messages: { orderBy: { createdAt: "asc" }, take: 200, include: { order: { select: { id: true, publicRef: true } } } } } });
  if (!c) notFound();
  return (
    <>
      <PageHead title={c.profileName ?? "Conversation"}><Link href="/admin/whatsapp" className="btn-outline btn-sm">Back</Link></PageHead>
      <p className="mb-4 text-sm text-graphite/75">+{c.waId} {c.optedOutAt && "· opted out"}</p>
      <ul className="max-w-2xl space-y-2">{c.messages.map((m) => <li key={m.id} className={`rounded-sm border p-3 text-sm ${m.direction === "OUTBOUND" ? "ml-8 border-indigo/30 bg-indigo-soft/50" : "mr-8 border-fog bg-white"}`}>
        <p className="whitespace-pre-wrap">{m.body || `(${m.kind})`}</p>
        <p className="mt-1 text-xs text-graphite/65">{when(m.createdAt)} · {m.status}{m.errorCode ? ` · ${m.errorCode}` : ""}{m.order && <> · <Link href={`/admin/orders/${m.order.id}`}>{m.order.publicRef}</Link></>}</p></li>)}</ul>
    </>
  );
}
