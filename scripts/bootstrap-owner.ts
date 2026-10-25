/*
 * One-time, controlled creation of a tenant and its first OWNER. Safe to run in production.
 *   BOOTSTRAP_OWNER_PASSWORD='...' npm run bootstrap:owner -- --email you@brand.com --name "Your Name" \
 *       --tenant-slug thread-and-form --tenant-name "THREAD & FORM"
 * If BOOTSTRAP_OWNER_PASSWORD is not set, a random password is generated and printed once.
 * Refuses to run if the tenant already has an owner. No default admin account ever exists.
 */
import "dotenv/config";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email")?.toLowerCase();
  const name = arg("name") ?? "Owner";
  const slug = arg("tenant-slug") ?? "thread-and-form";
  const tenantName = arg("tenant-name") ?? "THREAD & FORM";
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Pass a valid --email");

  const tenant = await prisma.tenant.upsert({ where: { slug }, create: { slug, name: tenantName }, update: {} });
  const owners = await prisma.membership.count({ where: { tenantId: tenant.id, role: "OWNER" } });
  if (owners > 0) throw new Error(`Tenant "${slug}" already has an owner. Use the Team page to add staff.`);

  const generated = !process.env.BOOTSTRAP_OWNER_PASSWORD;
  const password = process.env.BOOTSTRAP_OWNER_PASSWORD ?? randomBytes(12).toString("base64url");
  if (password.length < 10) throw new Error("Password must be at least 10 characters");
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name, passwordHash: await bcrypt.hash(password, 12) },
    update: {},
  });
  await prisma.membership.create({ data: { userId: user.id, tenantId: tenant.id, role: "OWNER" } });
  await prisma.auditLog.create({ data: { tenantId: tenant.id, actorLabel: "system:bootstrap", action: "owner.bootstrap", entityType: "User", entityId: user.id } });
  console.log(`Owner ready for tenant "${slug}": ${email}`);
  if (generated) console.log(`Generated password (shown once): ${password}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }).finally(() => prisma.$disconnect());
