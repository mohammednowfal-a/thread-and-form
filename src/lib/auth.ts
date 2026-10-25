import { createHmac, randomBytes } from "crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import type { RoleKey } from "@prisma/client";
import { prisma } from "./db";
import { isProd, sessionSecret } from "./env";
import { assertCan, can, ForbiddenError, type Permission } from "./permissions";
import { rateLimit } from "./ratelimit";
export { safeEqual } from "./crypto";

const STAFF_COOKIE = "tf_staff";
const CUSTOMER_COOKIE = "tf_customer";
const STAFF_TTL_H = 12;
const CUSTOMER_TTL_D = 30;

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}
export function hashToken(token: string): string {
  return createHmac("sha256", sessionSecret()).update(token).digest("hex");
}

const BCRYPT_COST = 12;
export const hashPassword = (pw: string) => bcrypt.hash(pw, BCRYPT_COST);
// Compared when the account doesn't exist, so response time doesn't reveal which emails are registered.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", BCRYPT_COST);
export async function verifyPassword(pw: string, hash: string | null | undefined): Promise<boolean> {
  const ok = await bcrypt.compare(pw, hash ?? DUMMY_HASH);
  return !!hash && ok;
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
}

async function setCookie(name: string, value: string, maxAgeSec: number) {
  (await cookies()).set(name, value, { httpOnly: true, secure: isProd(), sameSite: "lax", path: "/", maxAge: maxAgeSec });
}

/* ------------------------------ Staff ------------------------------ */

export interface StaffContext {
  userId: string;
  email: string;
  name: string;
  tenantId: string;
  tenantName: string;
  role: RoleKey;
  sessionId: string;
}

export async function loginStaff(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const ip = await clientIp();
  if (!(await rateLimit(`login:staff:${ip}`, 20, 900)) || !(await rateLimit(`login:staff:${email}`, 8, 900)))
    return { ok: false, error: "Too many attempts. Try again in a few minutes." };
  const user = await prisma.user.findUnique({ where: { email }, include: { memberships: true } });
  const ok = await verifyPassword(password, user?.passwordHash);
  if (!user || !ok || user.disabledAt || user.memberships.length === 0) return { ok: false, error: "Email or password is incorrect." };
  const token = newToken();
  await prisma.staffSession.create({
    data: { tokenHash: hashToken(token), userId: user.id, activeTenantId: user.memberships[0]?.tenantId ?? null, expiresAt: new Date(Date.now() + STAFF_TTL_H * 3600_000) },
  });
  await setCookie(STAFF_COOKIE, token, STAFF_TTL_H * 3600);
  return { ok: true };
}

export async function getStaff(): Promise<StaffContext | null> {
  const token = (await cookies()).get(STAFF_COOKIE)?.value;
  if (!token) return null;
  const s = await prisma.staffSession.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { include: { memberships: { include: { tenant: true } } } } } });
  if (!s || s.revokedAt || s.expiresAt < new Date() || s.user.disabledAt) return null;
  // Tenant is derived from verified membership, never from anything the browser sends.
  const m = s.user.memberships.find((x) => x.tenantId === s.activeTenantId) ?? s.user.memberships[0];
  if (!m) return null;
  return { userId: s.user.id, email: s.user.email, name: s.user.name, tenantId: m.tenantId, tenantName: m.tenant.name, role: m.role, sessionId: s.id };
}

/** Use at the top of every admin page and every admin server action. */
export async function requireStaff(permission?: Permission): Promise<StaffContext> {
  const s = await getStaff();
  if (!s) redirect("/admin/login");
  if (permission) assertCan(s.role, permission);
  return s;
}

export async function staffCan(permission: Permission): Promise<boolean> {
  const s = await getStaff();
  return !!s && can(s.role, permission);
}

export async function logoutStaff() {
  const jar = await cookies();
  const token = jar.get(STAFF_COOKIE)?.value;
  if (token) await prisma.staffSession.updateMany({ where: { tokenHash: hashToken(token) }, data: { revokedAt: new Date() } });
  jar.delete(STAFF_COOKIE);
}

export async function revokeAllStaffSessions(userId: string) {
  await prisma.staffSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

/* ----------------------------- Customer ---------------------------- */

export async function createCustomerSession(customerId: string) {
  const token = newToken();
  await prisma.customerSession.create({ data: { tokenHash: hashToken(token), customerId, expiresAt: new Date(Date.now() + CUSTOMER_TTL_D * 86400_000) } });
  await setCookie(CUSTOMER_COOKIE, token, CUSTOMER_TTL_D * 86400);
}

export async function getCustomer() {
  const token = (await cookies()).get(CUSTOMER_COOKIE)?.value;
  if (!token) return null;
  const s = await prisma.customerSession.findUnique({ where: { tokenHash: hashToken(token) }, include: { customer: true } });
  if (!s || s.revokedAt || s.expiresAt < new Date()) return null;
  return s.customer;
}

export async function logoutCustomer() {
  const jar = await cookies();
  const token = jar.get(CUSTOMER_COOKIE)?.value;
  if (token) await prisma.customerSession.updateMany({ where: { tokenHash: hashToken(token) }, data: { revokedAt: new Date() } });
  jar.delete(CUSTOMER_COOKIE);
}

export async function revokeAllCustomerSessions(customerId: string) {
  await prisma.customerSession.updateMany({ where: { customerId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export { ForbiddenError };
