"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getStorefrontTenant } from "@/lib/tenant";
import { clampQty, ensureCart, findCart, mergeCartOnLogin } from "@/lib/cart";
import { availableOf } from "@/lib/inventory";
import { CheckoutError, cancelOrder, createCodOrder } from "@/lib/orders";
import { checkoutSchema, loginSchema, registerSchema, trackSchema, passwordSchema } from "@/lib/validation";
import { clientIp, createCustomerSession, getCustomer, hashPassword, hashToken, logoutCustomer, newToken, revokeAllCustomerSessions, verifyPassword } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";
import { orderToken, verifyOrderToken } from "@/lib/orderAccess";
import { normalizePhone } from "@/lib/phone";
import { enqueue } from "@/lib/jobs";
import { appUrl, env } from "@/lib/env";

export interface FormState { error?: string; fieldErrors?: Record<string, string>; ok?: string }

/* ------------------------------- cart -------------------------------- */

export async function addToCart(formData: FormData) {
  const tenant = await getStorefrontTenant();
  const variantId = String(formData.get("variantId") ?? "");
  const qty = clampQty(Number(formData.get("quantity") ?? 1));
  const variant = await prisma.productVariant.findFirst({ where: { id: variantId, tenantId: tenant.id, active: true, product: { status: "PUBLISHED" } }, include: { inventory: true, product: true } });
  if (!variant) redirect("/shop");
  const avail = availableOf(variant.inventory);
  if (avail < 1) redirect(`/product/${variant.product.slug}?error=soldout`);
  const customer = await getCustomer();
  const cart = await ensureCart(tenant.id, customer?.id);
  const existing = await prisma.cartItem.findUnique({ where: { cartId_variantId: { cartId: cart.id, variantId } } });
  const next = Math.min(clampQty((existing?.quantity ?? 0) + qty), avail);
  await prisma.cartItem.upsert({ where: { cartId_variantId: { cartId: cart.id, variantId } }, create: { cartId: cart.id, variantId, quantity: next }, update: { quantity: next } });
  revalidatePath("/cart");
  redirect("/cart");
}

async function ownedItem(itemId: string) {
  const tenant = await getStorefrontTenant();
  const cart = await findCart(tenant.id);
  if (!cart) return null;
  const item = await prisma.cartItem.findFirst({ where: { id: itemId, cartId: cart.id }, include: { variant: { include: { inventory: true } } } });
  return item ? { item, cart, tenant } : null;
}

export async function updateCartQty(formData: FormData) {
  const o = await ownedItem(String(formData.get("itemId") ?? ""));
  if (!o) return;
  const qty = Math.min(clampQty(Number(formData.get("quantity"))), Math.max(availableOf(o.item.variant.inventory), 1));
  await prisma.cartItem.update({ where: { id: o.item.id }, data: { quantity: qty } });
  revalidatePath("/cart");
}

export async function removeFromCart(formData: FormData) {
  const o = await ownedItem(String(formData.get("itemId") ?? ""));
  if (!o) return;
  await prisma.cartItem.delete({ where: { id: o.item.id } });
  revalidatePath("/cart");
}

export async function changeCartVariant(formData: FormData) {
  const o = await ownedItem(String(formData.get("itemId") ?? ""));
  if (!o) return;
  const newId = String(formData.get("variantId") ?? "");
  const target = await prisma.productVariant.findFirst({ where: { id: newId, tenantId: o.tenant.id, productId: o.item.variant.productId, active: true }, include: { inventory: true } });
  if (!target || target.id === o.item.variantId) return;
  const avail = availableOf(target.inventory);
  if (avail < 1) return;
  await prisma.$transaction(async (tx) => {
    const dest = await tx.cartItem.findUnique({ where: { cartId_variantId: { cartId: o.cart.id, variantId: target.id } } });
    await tx.cartItem.delete({ where: { id: o.item.id } });
    const qty = Math.min(clampQty((dest?.quantity ?? 0) + o.item.quantity), avail);
    await tx.cartItem.upsert({ where: { cartId_variantId: { cartId: o.cart.id, variantId: target.id } }, create: { cartId: o.cart.id, variantId: target.id, quantity: qty }, update: { quantity: qty } });
  });
  revalidatePath("/cart");
}

/* ----------------------------- checkout ------------------------------ */

export async function placeOrderAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const tenant = await getStorefrontTenant();
  const ip = await clientIp();
  if (!(await rateLimit(`checkout:${ip}`, 12, 3600))) return { error: "Too many orders from this connection. Please try again later." };

  const customer = await getCustomer();
  if (!customer && env("ALLOW_GUEST_CHECKOUT", "true") === "false") return { error: "Please sign in to place an order." };

  const parsed = checkoutSchema.safeParse({
    name: formData.get("name"), phone: formData.get("phone"), email: formData.get("email") ?? "", line1: formData.get("line1"), line2: formData.get("line2") || undefined,
    city: formData.get("city"), state: formData.get("state"), pincode: formData.get("pincode"),
    whatsappConsent: formData.get("whatsappConsent") === "on", idempotencyKey: formData.get("idempotencyKey"),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] = i.message;
    return { error: "Please fix the highlighted fields.", fieldErrors };
  }
  const d = parsed.data;
  if (formData.get("paymentMethod") !== "COD") return { error: "Choose Cash on Delivery to continue." };

  const cart = await findCart(tenant.id);
  const items = cart ? await prisma.cartItem.findMany({ where: { cartId: cart.id } }) : [];
  try {
    const { order } = await createCodOrder({
      tenantId: tenant.id, lines: items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
      contact: { name: d.name, phone: d.phone, email: d.email ?? customer?.email ?? null },
      address: { fullName: d.name, phone: d.phone, line1: d.line1, line2: d.line2, city: d.city, state: d.state, pincode: d.pincode },
      whatsappConsent: d.whatsappConsent, idempotencyKey: d.idempotencyKey, customerId: customer?.id ?? null, cartId: cart?.id ?? null,
    });
    redirect(`/order/${order.publicRef}?t=${orderToken(order.id)}`);
  } catch (e) {
    if (e instanceof CheckoutError) return { error: e.message };
    throw e; // includes Next's redirect signal
  }
}

/* ------------------------ order tracking + cancel -------------------- */

export async function trackAction(_p: FormState, formData: FormData): Promise<FormState> {
  const tenant = await getStorefrontTenant();
  const ip = await clientIp();
  const parsed = trackSchema.safeParse({ ref: formData.get("ref"), phone: formData.get("phone") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the details and try again." };
  if (!(await rateLimit(`track:${ip}`, 15, 900))) return { error: "Too many attempts. Try again in a few minutes." };
  const phone = normalizePhone(parsed.data.phone);
  const order = phone ? await prisma.order.findFirst({ where: { tenantId: tenant.id, publicRef: parsed.data.ref, contactPhone: phone } }) : null;
  if (!order) return { error: "We couldn't find an order with those details." }; // same message for wrong ref or wrong phone
  redirect(`/order/${order.publicRef}?t=${orderToken(order.id)}`);
}

export async function customerCancelOrder(formData: FormData) {
  const tenant = await getStorefrontTenant();
  const ref = String(formData.get("ref") ?? "");
  const order = await prisma.order.findUnique({ where: { tenantId_publicRef: { tenantId: tenant.id, publicRef: ref } } });
  if (!order) return;
  const customer = await getCustomer();
  const allowed = verifyOrderToken(order.id, String(formData.get("t") ?? "")) || (customer && order.customerId === customer.id);
  if (!allowed) return;
  await cancelOrder({ tenantId: tenant.id, orderId: order.id, source: "customer:web", reason: "Cancelled by customer on website", customerInitiated: true });
  revalidatePath(`/order/${ref}`);
  redirect(`/order/${ref}?t=${orderToken(order.id)}`);
}

/* ------------------------------ accounts ----------------------------- */

export async function registerAction(_p: FormState, formData: FormData): Promise<FormState> {
  const tenant = await getStorefrontTenant();
  if (!(await rateLimit(`register:${await clientIp()}`, 10, 3600))) return { error: "Too many sign-ups from this connection. Try again later." };
  const parsed = registerSchema.safeParse({ name: formData.get("name"), email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check your details.", fieldErrors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])) };
  const existing = await prisma.customer.findUnique({ where: { tenantId_email: { tenantId: tenant.id, email: parsed.data.email } } });
  if (existing) return { error: "We couldn't create that account. Try signing in, or use a different email." };
  const c = await prisma.customer.create({ data: { tenantId: tenant.id, email: parsed.data.email, name: parsed.data.name, passwordHash: await hashPassword(parsed.data.password) } });
  await createCustomerSession(c.id);
  await mergeCartOnLogin(tenant.id, c.id);
  redirect("/account");
}

export async function loginAction(_p: FormState, formData: FormData): Promise<FormState> {
  const tenant = await getStorefrontTenant();
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "Enter your email and password." };
  const ip = await clientIp();
  if (!(await rateLimit(`login:cust:${ip}`, 20, 900)) || !(await rateLimit(`login:cust:${parsed.data.email}`, 8, 900))) return { error: "Too many attempts. Try again in a few minutes." };
  const c = await prisma.customer.findUnique({ where: { tenantId_email: { tenantId: tenant.id, email: parsed.data.email } } });
  const ok = await verifyPassword(parsed.data.password, c?.passwordHash);
  if (!c || !ok) return { error: "Email or password is incorrect." };
  await createCustomerSession(c.id);
  await mergeCartOnLogin(tenant.id, c.id);
  redirect("/account");
}

export async function logoutAction() {
  await logoutCustomer();
  redirect("/");
}

export async function forgotPasswordAction(_p: FormState, formData: FormData): Promise<FormState> {
  const tenant = await getStorefrontTenant();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!(await rateLimit(`forgot:${await clientIp()}`, 5, 3600))) return { error: "Too many requests. Try again later." };
  const c = email ? await prisma.customer.findUnique({ where: { tenantId_email: { tenantId: tenant.id, email } } }) : null;
  if (c?.passwordHash) {
    const token = newToken();
    await prisma.passwordReset.create({ data: { tokenHash: hashToken(token), customerId: c.id, expiresAt: new Date(Date.now() + 3600_000) } });
    await enqueue(prisma, { tenantId: tenant.id, type: "EMAIL_PASSWORD_RESET", payload: { to: c.email, url: `${appUrl()}/reset-password?token=${token}` }, maxAttempts: 4 });
  }
  return { ok: "If that email has an account, a reset link is on its way." }; // identical response either way
}

export async function resetPasswordAction(_p: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get("token") ?? "");
  const pw = passwordSchema.safeParse(formData.get("password"));
  if (!pw.success) return { error: pw.error.issues[0]?.message };
  const row = await prisma.passwordReset.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.usedAt || row.expiresAt < new Date() || !row.customerId) return { error: "This reset link is invalid or has expired. Request a new one." };
  await prisma.$transaction([
    prisma.customer.update({ where: { id: row.customerId }, data: { passwordHash: await hashPassword(pw.data) } }),
    prisma.passwordReset.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
  ]);
  await revokeAllCustomerSessions(row.customerId); // existing sessions end when the password changes
  redirect("/login?reset=1");
}

const addressSchema = z.object({ label: z.string().trim().max(30).default("Home"), fullName: z.string().trim().min(1).max(80), phone: z.string().trim().min(8), line1: z.string().trim().min(1).max(120), line2: z.string().trim().max(120).optional(), city: z.string().trim().min(1).max(60), state: z.string().trim().min(1).max(60), pincode: z.string().regex(/^[1-9]\d{5}$/) });

export async function saveAddressAction(_p: FormState, formData: FormData): Promise<FormState> {
  const c = await getCustomer();
  if (!c) redirect("/login");
  const parsed = addressSchema.safeParse(Object.fromEntries(formData));
  const phone = parsed.success ? normalizePhone(parsed.data.phone) : null;
  if (!parsed.success || !phone) return { error: "Check the address: all fields are required, with a valid phone and 6-digit PIN." };
  const count = await prisma.customerAddress.count({ where: { customerId: c.id } });
  if (count >= 10) return { error: "You can save up to 10 addresses." };
  await prisma.customerAddress.create({ data: { ...parsed.data, phone, customerId: c.id, isDefault: count === 0 } });
  revalidatePath("/account");
  return { ok: "Address saved." };
}

export async function deleteAddressAction(formData: FormData) {
  const c = await getCustomer();
  if (!c) redirect("/login");
  await prisma.customerAddress.deleteMany({ where: { id: String(formData.get("id") ?? ""), customerId: c.id } });
  revalidatePath("/account");
}
