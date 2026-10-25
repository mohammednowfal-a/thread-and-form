import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { PageHead } from "@/components/admin";
import { ProductForm } from "@/components/AdminForms";

export default async function NewProduct() {
  const s = await requireStaff("products.write");
  const categories = await prisma.category.findMany({ where: { tenantId: s.tenantId }, orderBy: { position: "asc" } });
  return <><PageHead title="Add product" />{categories.length === 0 ? <p className="panel">Create a category first (use the demo seed or add one in the database).</p> : <ProductForm categories={categories} />}<p className="mt-3 text-sm text-graphite/70">Save the product, then add sizes, colours, stock and images on its page.</p></>;
}
