import { cache } from "react";
import { prisma } from "./db";
import { env } from "./env";

export const getStorefrontTenant = cache(async () => {
  const slug = env("STOREFRONT_TENANT_SLUG", "thread-and-form");
  const t = await prisma.tenant.findUnique({ where: { slug } });
  if (!t) throw new Error(`Tenant "${slug}" does not exist. Run the demo seed or bootstrap:owner (see README).`);
  return t;
});
