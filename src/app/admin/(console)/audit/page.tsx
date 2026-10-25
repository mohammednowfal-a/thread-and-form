import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { PageHead, when } from "@/components/admin";

export default async function Audit() {
  const s = await requireStaff("audit.read");
  const rows = await prisma.auditLog.findMany({ where: { tenantId: s.tenantId }, orderBy: { createdAt: "desc" }, take: 150 });
  return (
    <>
      <PageHead title="Audit log" />
      <div className="table-wrap"><table className="tbl"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead><tbody>{rows.length === 0 && <tr><td colSpan={5} className="text-center text-graphite/70">No audit entries yet.</td></tr>}{rows.map((r) => <tr key={r.id}><td className="text-xs">{when(r.createdAt)}</td><td>{r.actorLabel}</td><td className="font-mono text-xs">{r.action}</td><td className="text-xs">{r.entityType} {r.entityId?.slice(0, 8)}</td><td className="max-w-xs break-words text-xs">{JSON.stringify(r.metadata)}</td></tr>)}</tbody></table></div>
    </>
  );
}
