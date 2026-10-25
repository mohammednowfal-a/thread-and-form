import { requireStaff } from "@/lib/auth";
import { listCustomers } from "@/lib/admin/queries";
import { formatMoney } from "@/lib/money";
import { maskPhone } from "@/lib/phone";
import { PageHead, Pager, when } from "@/components/admin";

export default async function Customers({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const s = await requireStaff("customers.read");
  const page = Math.max(1, parseInt((await searchParams).page ?? "1", 10) || 1);
  const r = await listCustomers(s.tenantId, page);
  return (
    <>
      <PageHead title="Customers" />
      <h2 className="mb-2 text-lg">Registered accounts ({r.total})</h2>
      <div className="table-wrap"><table className="tbl"><thead><tr><th>Name</th><th>Email</th><th>Orders</th><th>WhatsApp</th><th>Joined</th></tr></thead>
        <tbody>{r.items.length === 0 && <tr><td colSpan={5} className="text-center text-graphite/70">No registered customers yet.</td></tr>}{r.items.map((c) => <tr key={c.id}><td>{c.name}</td><td>{c.email}</td><td>{c._count.orders}</td><td>{c.whatsappOptOutAt ? "Opted out" : c.whatsappOptInAt ? "Opted in" : "—"}</td><td>{when(c.createdAt)}</td></tr>)}</tbody></table></div>
      <Pager base="/admin/customers" page={page} pages={r.pages} />
      <h2 className="mb-2 mt-8 text-lg">Guest buyers</h2>
      <div className="table-wrap"><table className="tbl"><thead><tr><th>Name</th><th>Phone</th><th>Orders</th><th>Lifetime value</th></tr></thead>
        <tbody>{r.guests.length === 0 && <tr><td colSpan={4} className="text-center text-graphite/70">No guest orders yet.</td></tr>}{r.guests.map((g) => <tr key={g.contactPhone + g.contactName}><td>{g.contactName}</td><td>{maskPhone(g.contactPhone)}</td><td>{g._count}</td><td>{formatMoney(g._sum.totalPaise ?? 0)}</td></tr>)}</tbody></table></div>
    </>
  );
}
