import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PageHead, Pill, when } from "@/components/admin";
import { resolveReturn } from "../../actions";

export default async function Returns() {
  const s = await requireStaff("orders.read");
  const [rows, cancelled] = await Promise.all([
    prisma.returnRequest.findMany({ where: { tenantId: s.tenantId }, orderBy: { createdAt: "desc" }, take: 50, include: { order: { select: { id: true, publicRef: true } } } }),
    prisma.order.findMany({ where: { tenantId: s.tenantId, status: "CANCELLED" }, orderBy: { cancelledAt: "desc" }, take: 20, select: { id: true, publicRef: true, cancelSource: true, cancelReason: true, cancelledAt: true } }),
  ]);
  const manage = can(s.role, "returns.manage");
  return (
    <>
      <PageHead title="Returns and cancellations" />
      <h2 className="mb-2 text-lg">Return requests</h2>
      <div className="table-wrap"><table className="tbl"><thead><tr><th>Order</th><th>Reason</th><th>Status</th><th>Requested</th>{manage && <th>Action</th>}</tr></thead><tbody>{rows.length === 0 && <tr><td colSpan={5} className="text-center text-graphite/70">No return requests.</td></tr>}
        {rows.map((r) => <tr key={r.id}><td><Link href={`/admin/orders/${r.order.id}`} className="font-mono">{r.order.publicRef}</Link></td><td>{r.reason}</td><td><Pill>{r.status.toLowerCase()}</Pill></td><td className="text-xs">{when(r.createdAt)}</td>
          {manage && <td>{r.status === "REQUESTED" || r.status === "APPROVED" ? <form action={resolveReturn} className="flex gap-2"><input type="hidden" name="id" value={r.id} />{r.status === "REQUESTED" && <button name="status" value="APPROVED" className="btn-outline btn-sm">Approve</button>}{r.status === "REQUESTED" && <button name="status" value="REJECTED" className="btn-outline btn-sm">Reject</button>}{r.status === "APPROVED" && <button name="status" value="RECEIVED" className="btn-primary btn-sm">Mark received</button>}</form> : "—"}</td>}</tr>)}</tbody></table></div>
      <h2 className="mb-2 mt-8 text-lg">Recent cancellations</h2>
      <div className="table-wrap"><table className="tbl"><thead><tr><th>Order</th><th>Source</th><th>Reason</th><th>When</th></tr></thead><tbody>{cancelled.length === 0 && <tr><td colSpan={4} className="text-center text-graphite/70">No cancellations.</td></tr>}{cancelled.map((o) => <tr key={o.id}><td><Link href={`/admin/orders/${o.id}`} className="font-mono">{o.publicRef}</Link></td><td>{o.cancelSource}</td><td>{o.cancelReason ?? "—"}</td><td className="text-xs">{when(o.cancelledAt)}</td></tr>)}</tbody></table></div>
    </>
  );
}
