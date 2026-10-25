import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/permissions";
import { PageHead, when } from "@/components/admin";
import { MemberForm } from "@/components/AdminForms";
import { changeRole, removeMember } from "../../actions";

export default async function Team() {
  const s = await requireStaff("team.manage");
  const members = await prisma.membership.findMany({ where: { tenantId: s.tenantId }, include: { user: true }, orderBy: { createdAt: "asc" } });
  return (
    <>
      <PageHead title="Team and roles" />
      <div className="table-wrap"><table className="tbl"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Added</th><th /></tr></thead><tbody>{members.map((m) => <tr key={m.id}><td>{m.user.name}</td><td>{m.user.email}</td>
        <td>{m.role === "OWNER" ? ROLE_LABEL.OWNER : <form action={changeRole} className="flex gap-2"><input type="hidden" name="id" value={m.id} /><label className="sr-only" htmlFor={`r-${m.id}`}>Role</label><select id={`r-${m.id}`} name="role" defaultValue={m.role} className="input !min-h-[36px]">{(["ADMIN", "OPS_MANAGER", "FULFILLMENT", "SUPPORT", "ANALYST"] as const).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select><button className="btn-outline btn-sm">Save</button></form>}</td>
        <td className="text-xs">{when(m.createdAt)}</td><td>{m.role !== "OWNER" && m.userId !== s.userId && <form action={removeMember}><input type="hidden" name="id" value={m.id} /><button className="text-madder underline">Remove</button></form>}</td></tr>)}</tbody></table></div>
      <h2 className="mb-2 mt-8 text-lg">Add a team member</h2><MemberForm />
      <p className="mt-3 max-w-prose text-sm text-graphite/75">New people get a one-time generated password that is shown once. Permissions are enforced on the server for every action, not just by hiding buttons.</p>
    </>
  );
}
