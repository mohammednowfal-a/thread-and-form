"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomBytes } from "crypto";
import type { OrderStatus, RoleKey } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hashPassword, loginStaff, logoutStaff, requireStaff, revokeAllStaffSessions } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { transitionOrder } from "@/lib/orders";
import { enqueue, replayJob } from "@/lib/jobs";
import { replayWebhookEvent } from "@/lib/whatsapp/process";
import { createProviderShipment, NotConnectedError, PROVIDERS, type ProviderId } from "@/lib/integrations/shipping";
import { importShopifyProducts } from "@/lib/integrations/shopify";
import { productInputSchema, loginSchema } from "@/lib/validation";
import { codConfirmationBody } from "@/lib/whatsapp/outbound";
import { waConfig } from "@/lib/whatsapp/config";
import { ForbiddenError } from "@/lib/permissions";

export interface AdminState { error?: string; ok?: string }
const who = (s: { email: string }) => `staff:${s.email}`;
const fail = (e: unknown): AdminState => ({ error: e instanceof ForbiddenError ? "You do not have permission to do that." : e instanceof Error ? e.message : "Something went wrong." });

export async function loginStaffAction(_p: AdminState, fd: FormData): Promise<AdminState> {
  const parsed = loginSchema.safeParse({ email: fd.get("email"), password: fd.get("password") });
  if (!parsed.success) return { error: "Enter your email and password." };
  const r = await loginStaff(parsed.data.email, parsed.data.password);
  if (!r.ok) return { error: r.error };
  redirect("/admin");
}
export async function logoutStaffAction() {
  await logoutStaff();
  redirect("/admin/login");
}

/* -------------------------------- orders ------------------------------- */

const statusSchema = z.enum(["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED", "CANCELLED", "FAILED_DELIVERY", "RETURN_REQUESTED", "RETURNED"]);

export async function updateOrderStatus(fd: FormData) {
  const to = statusSchema.parse(fd.get("to")) as OrderStatus;
  const id = String(fd.get("orderId"));
  const s = await requireStaff(to === "CANCELLED" ? "orders.cancel" : to === "CONFIRMED" ? "orders.update" : "orders.fulfil");
  const order = await prisma.order.findFirst({ where: { id, tenantId: s.tenantId }, select: { id: true, status: true } });
  if (!order) throw new Error("Order not found");
  try {
    await transitionOrder({ tenantId: s.tenantId, orderId: id, to, source: `staff:${s.email}`, actorUserId: s.userId, note: String(fd.get("note") ?? "").slice(0, 200) || undefined });
  } catch (e) {
    redirect(`/admin/orders/${id}?error=${encodeURIComponent(e instanceof Error ? e.message : "Update failed")}`);
  }
  await audit({ tenantId: s.tenantId, actorUserId: s.userId, actorLabel: who(s), action: "order.status", entityType: "Order", entityId: id, metadata: { from: order.status, to } });
  revalidatePath(`/admin/orders/${id}`);
  redirect(`/admin/orders/${id}`);
}

export async function resendConfirmation(fd: FormData) {
  const s = await requireStaff("whatsapp.manage");
  const id = String(fd.get("orderId"));
  const order = await prisma.order.findFirst({ where: { id, tenantId: s.tenantId }, include: { items: true } });
  if (!order || order.status !== "PENDING_CONFIRMATION") redirect(`/admin/orders/${id}?error=${encodeURIComponent("Only orders pending confirmation can be re-sent")}`);
  if (!order.whatsappConsent) redirect(`/admin/orders/${id}?error=${encodeURIComponent("This customer did not consent to WhatsApp messages. Confirm by phone.")}`);
  const conv = await prisma.whatsAppConversation.upsert({ where: { tenantId_waId: { tenantId: s.tenantId, waId: order.contactPhone } }, create: { tenantId: s.tenantId, waId: order.contactPhone, profileName: order.contactName }, update: {} });
  if (conv.optedOutAt) redirect(`/admin/orders/${id}?error=${encodeURIComponent("This customer opted out of WhatsApp. Confirm by phone.")}`);
  await prisma.$transaction(async (tx) => {
    const msg = await tx.whatsAppMessage.create({ data: { tenantId: s.tenantId, conversationId: conv.id, direction: "OUTBOUND", kind: "template", body: codConfirmationBody(order), templateName: waConfig().templates.codConfirm, orderId: id, status: "QUEUED" } });
    await tx.order.update({ where: { id }, data: { confirmationStatus: "AWAITING" } });
    await enqueue(tx, { tenantId: s.tenantId, type: "WA_COD_CONFIRM", payload: { orderId: id, messageId: msg.id }, dedupeKey: `cod-resend:${msg.id}` });
  });
  await audit({ tenantId: s.tenantId, actorUserId: s.userId, actorLabel: who(s), action: "order.confirmation.resend", entityType: "Order", entityId: id });
  redirect(`/admin/orders/${id}`);
}

export async function addShipment(fd: FormData) {
  const s = await requireStaff("orders.fulfil");
  const id = String(fd.get("orderId"));
  const provider = z.enum(["manual", "shiprocket", "delhivery"]).parse(fd.get("provider")) as ProviderId;
  const order = await prisma.order.findFirst({ where: { id, tenantId: s.tenantId }, include: { items: true } });
  const back = (m: string) => redirect(`/admin/orders/${id}?error=${encodeURIComponent(m)}`);
  if (!order) return back("Order not found");
  if (!["CONFIRMED", "PROCESSING", "PACKED"].includes(order.status)) return back("Create shipments for confirmed orders that have not shipped yet");
  let tracking: string, label: string | undefined;
  try {
    if (provider === "manual") {
      tracking = String(fd.get("trackingNumber") ?? "").trim();
      if (!/^[A-Za-z0-9-]{6,30}$/.test(tracking)) return back("Enter the courier's real tracking number (6-30 letters, numbers or dashes)");
    } else {
      const r = await createProviderShipment(provider, order);
      tracking = r.trackingNumber; label = r.labelUrl;
    }
  } catch (e) {
    return back(e instanceof NotConnectedError ? e.message : `Courier error: ${e instanceof Error ? e.message : "unknown"}`);
  }
  try {
    await prisma.shipment.create({ data: { tenantId: s.tenantId, orderId: id, provider, trackingNumber: tracking, labelUrl: label ?? null, status: "CREATED" } });
  } catch {
    return back("That tracking number is already used");
  }
  await audit({ tenantId: s.tenantId, actorUserId: s.userId, actorLabel: who(s), action: "shipment.create", entityType: "Order", entityId: id, metadata: { provider } });
  redirect(`/admin/orders/${id}`);
}

export async function createReturn(fd: FormData) {
  const s = await requireStaff("returns.manage");
  const id = String(fd.get("orderId"));
  const reason = String(fd.get("reason") ?? "").trim().slice(0, 300);
  const order = await prisma.order.findFirst({ where: { id, tenantId: s.tenantId } });
  if (!order || !reason) redirect(`/admin/orders/${id}?error=${encodeURIComponent("A reason is required")}`);
  try {
    await transitionOrder({ tenantId: s.tenantId, orderId: id, to: "RETURN_REQUESTED", source: who(s), actorUserId: s.userId, note: reason });
  } catch (e) {
    redirect(`/admin/orders/${id}?error=${encodeURIComponent(e instanceof Error ? e.message : "Failed")}`);
  }
  await prisma.returnRequest.create({ data: { tenantId: s.tenantId, orderId: id, reason } });
  await audit({ tenantId: s.tenantId, actorUserId: s.userId, actorLabel: who(s), action: "return.create", entityType: "Order", entityId: id });
  redirect(`/admin/orders/${id}`);
}

export async function resolveReturn(fd: FormData) {
  const s = await requireStaff("returns.manage");
  const status = z.enum(["APPROVED", "REJECTED", "RECEIVED"]).parse(fd.get("status"));
  const r = await prisma.returnRequest.findFirst({ where: { id: String(fd.get("id")), tenantId: s.tenantId } });
  if (!r) return;
  await prisma.returnRequest.update({ where: { id: r.id }, data: { status, resolvedAt: new Date() } });
  if (status === "RECEIVED") await transitionOrder({ tenantId: s.tenantId, orderId: r.orderId, to: "RETURNED", source: who(s), actorUserId: s.userId }).catch(() => undefined);
  if (status === "REJECTED") await transitionOrder({ tenantId: s.tenantId, orderId: r.orderId, to: "DELIVERED", source: who(s), actorUserId: s.userId, note: "Return rejected" }).catch(() => undefined);
  await audit({ tenantId: s.tenantId, actorUserId: s.userId, actorLabel: who(s), action: `return.${status.toLowerCase()}`, entityType: "ReturnRequest", entityId: r.id });
  revalidatePath("/admin/returns");
}

/* ------------------------- catalogue + inventory ----------------------- */

const toPaise = (v: FormDataEntryValue | null) => { const n = Math.round(parseFloat(String(v ?? "")) * 100); return Number.isFinite(n) ? n : NaN; };

export async function saveProduct(_p: AdminState, fd: FormData): Promise<AdminState> {
  try {
    const s = await requireStaff("products.write");
    const compare = String(fd.get("compare") ?? "").trim();
    const parsed = productInputSchema.safeParse({
      name: fd.get("name"), slug: fd.get("slug"), sku: fd.get("sku"), categoryId: fd.get("categoryId"), description: fd.get("description"),
      material: fd.get("material") ?? "", fit: fd.get("fit") ?? "", pricePaise: toPaise(fd.get("price")), comparePricePaise: compare ? toPaise(compare) : null, status: fd.get("status"),
    });
    if (!parsed.success) return { error: parsed.error.issues.map((i) => `${String(i.path[0])}: ${i.message}`).join("; ") };
    const cat = await prisma.category.findFirst({ where: { id: parsed.data.categoryId, tenantId: s.tenantId } });
    if (!cat) return { error: "Choose a category from your store" };
    const data = { ...parsed.data, comparePricePaise: parsed.data.comparePricePaise ?? null, isNew: fd.get("isNew") === "on", isFeatured: fd.get("isFeatured") === "on", searchText: `${parsed.data.name} ${cat.name} ${parsed.data.material}`.toLowerCase() };
    const id = String(fd.get("id") ?? "");
    let savedId = id;
    if (id) {
      const r = await prisma.product.updateMany({ where: { id, tenantId: s.tenantId }, data });
      if (r.count !== 1) return { error: "Product not found" };
    } else {
      savedId = (await prisma.product.create({ data: { ...data, tenantId: s.tenantId } })).id;
    }
    await audit({ tenantId: s.tenantId, actorUserId: s.userId, actorLabel: who(s), action: id ? "product.update" : "product.create", entityType: "Product", entityId: savedId });
    revalidatePath("/admin/products");
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "P2002") return { error: "That slug or SKU is already used in your store" };
    return fail(e);
  }
  redirect("/admin/products");
}

export async function addVariant(fd: FormData) {
  const s = await requireStaff("inventory.write");
  const productId = String(fd.get("productId"));
  const p = await prisma.product.findFirst({ where: { id: productId, tenantId: s.tenantId } });
  const back = (m: string) => redirect(`/admin/products/${productId}?error=${encodeURIComponent(m)}`);
  if (!p) return back("Product not found");
  const size = String(fd.get("size") ?? "").trim(), color = String(fd.get("color") ?? "").trim(), sku = String(fd.get("sku") ?? "").trim();
  const hex = /^#[0-9a-fA-F]{6}$/.test(String(fd.get("colorHex"))) ? String(fd.get("colorHex")) : "#cccccc";
  const stock = Math.max(0, Math.min(100000, parseInt(String(fd.get("stock") ?? "0"), 10) || 0));
  if (!size || !color || !sku) return back("Size, colour and SKU are required");
  try {
    await prisma.productVariant.create({ data: { tenantId: s.tenantId, productId, size, color, colorHex: hex, sku, inventory: { create: { tenantId: s.tenantId, onHand: stock } } } });
  } catch { return back("That size/colour or SKU already exists"); }
  await audit({ tenantId: s.tenantId, actorUserId: s.userId, actorLabel: who(s), action: "variant.create", entityType: "Product", entityId: productId, metadata: { size, color, sku } });
  redirect(`/admin/products/${productId}`);
}

export async function addImage(fd: FormData) {
  const s = await requireStaff("products.write");
  const productId = String(fd.get("productId"));
  const url = String(fd.get("url") ?? "").trim();
  const ok = /^https:\/\/[^\s]+$/.test(url) || /^\/products\/[A-Za-z0-9._-]+$/.test(url);
  if (!ok) redirect(`/admin/products/${productId}?error=${encodeURIComponent("Image URL must start with https:// (or be a /products/ file)")}`);
  const p = await prisma.product.findFirst({ where: { id: productId, tenantId: s.tenantId } });
  if (!p) return;
  const count = await prisma.productImage.count({ where: { productId } });
  await prisma.productImage.create({ data: { productId, url, alt: String(fd.get("alt") ?? "").slice(0, 80), position: count } });
  redirect(`/admin/products/${productId}`);
}
export async function deleteImage(fd: FormData) {
  const s = await requireStaff("products.write");
  const img = await prisma.productImage.findFirst({ where: { id: String(fd.get("id")), product: { tenantId: s.tenantId } } });
  if (!img) return;
  await prisma.productImage.delete({ where: { id: img.id } });
  redirect(`/admin/products/${img.productId}`);
}

export async function adjustStock(fd: FormData) {
  const s = await requireStaff("inventory.write");
  const variantId = String(fd.get("variantId"));
  const onHand = parseInt(String(fd.get("onHand")), 10);
  const reason = String(fd.get("reason") ?? "").trim().slice(0, 120);
  const rec = await prisma.inventoryRecord.findFirst({ where: { variantId, tenantId: s.tenantId } });
  const back = (m?: string) => redirect(`/admin/inventory${m ? `?error=${encodeURIComponent(m)}` : ""}`);
  if (!rec) return back("Variant not found");
  if (!Number.isInteger(onHand) || onHand < rec.reserved || onHand > 100000) return back(`Stock can't be below the ${rec.reserved} units reserved for open orders`);
  await prisma.inventoryRecord.update({ where: { id: rec.id }, data: { onHand } });
  await audit({ tenantId: s.tenantId, actorUserId: s.userId, actorLabel: who(s), action: "inventory.adjust", entityType: "ProductVariant", entityId: variantId, metadata: { from: rec.onHand, to: onHand, reason } });
  back();
}

/* ---------------------------- ops, settings, team ---------------------- */

export async function replayJobAction(fd: FormData) {
  const s = await requireStaff("jobs.manage");
  await replayJob(s.tenantId, String(fd.get("id")));
  await audit({ tenantId: s.tenantId, actorUserId: s.userId, actorLabel: who(s), action: "job.replay", entityType: "Job", entityId: String(fd.get("id")) });
  revalidatePath("/admin/whatsapp");
}
export async function replayWebhookAction(fd: FormData) {
  const s = await requireStaff("jobs.manage");
  await replayWebhookEvent(String(fd.get("id")));
  await audit({ tenantId: s.tenantId, actorUserId: s.userId, actorLabel: who(s), action: "webhook.replay", entityType: "WebhookEvent", entityId: String(fd.get("id")) });
  revalidatePath("/admin/whatsapp");
}

export async function saveSettings(_p: AdminState, fd: FormData): Promise<AdminState> {
  try {
    const s = await requireStaff("settings.manage");
    const num = (k: string) => Math.round(parseFloat(String(fd.get(k) ?? "")) * 100);
    const schema = z.object({ name: z.string().trim().min(1).max(80), shippingFeePaise: z.number().int().min(0).max(1_000_000), freeShippingThresholdPaise: z.number().int().min(0).max(100_000_000), codMaxTotalPaise: z.number().int().min(0).max(100_000_000), codFeePaise: z.number().int().min(0).max(100_000), confirmationExpiryHours: z.number().int().min(1).max(336), supportEmail: z.string().trim().email().or(z.literal("")), supportPhone: z.string().trim().max(30) });
    const r = schema.safeParse({ name: fd.get("name"), shippingFeePaise: num("shipping"), freeShippingThresholdPaise: num("freeThreshold"), codMaxTotalPaise: num("codMax"), codFeePaise: num("codFee"), confirmationExpiryHours: parseInt(String(fd.get("expiryHours")), 10), supportEmail: fd.get("supportEmail") ?? "", supportPhone: fd.get("supportPhone") ?? "" });
    if (!r.success) return { error: r.error.issues.map((i) => `${String(i.path[0])}: ${i.message}`).join("; ") };
    await prisma.tenant.update({ where: { id: s.tenantId }, data: { ...r.data, supportEmail: r.data.supportEmail || null, supportPhone: r.data.supportPhone || null, whatsappConfirmEnabled: fd.get("whatsappConfirmEnabled") === "on" } });
    await audit({ tenantId: s.tenantId, actorUserId: s.userId, actorLabel: who(s), action: "settings.update", entityType: "Tenant", entityId: s.tenantId });
    revalidatePath("/admin/settings");
    return { ok: "Settings saved." };
  } catch (e) { return fail(e); }
}

const ROLES = ["ADMIN", "OPS_MANAGER", "FULFILLMENT", "SUPPORT", "ANALYST"] as const;

export async function addMember(_p: AdminState, fd: FormData): Promise<AdminState> {
  try {
    const s = await requireStaff("team.manage");
    const parsed = z.object({ email: z.string().trim().toLowerCase().email(), name: z.string().trim().min(1).max(80), role: z.enum(ROLES) }).safeParse({ email: fd.get("email"), name: fd.get("name"), role: fd.get("role") });
    if (!parsed.success) return { error: "Enter a valid email, name and role." };
    let user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    let password: string | null = null;
    if (!user) {
      password = randomBytes(9).toString("base64url");
      user = await prisma.user.create({ data: { email: parsed.data.email, name: parsed.data.name, passwordHash: await hashPassword(password) } });
    }
    try {
      await prisma.membership.create({ data: { userId: user.id, tenantId: s.tenantId, role: parsed.data.role as RoleKey } });
    } catch { return { error: "That person is already on your team." }; }
    await audit({ tenantId: s.tenantId, actorUserId: s.userId, actorLabel: who(s), action: "team.add", entityType: "User", entityId: user.id, metadata: { role: parsed.data.role } });
    revalidatePath("/admin/team");
    return { ok: password ? `Added. Share this one-time password securely (it will not be shown again): ${password}` : "Added. They can sign in with their existing password." };
  } catch (e) { return fail(e); }
}

export async function changeRole(fd: FormData) {
  const s = await requireStaff("team.manage");
  const role = z.enum(ROLES).parse(fd.get("role")) as RoleKey;
  const m = await prisma.membership.findFirst({ where: { id: String(fd.get("id")), tenantId: s.tenantId } });
  if (!m || m.role === "OWNER") return; // the owner role is never edited through the UI
  await prisma.membership.update({ where: { id: m.id }, data: { role } });
  await audit({ tenantId: s.tenantId, actorUserId: s.userId, actorLabel: who(s), action: "team.role", entityType: "Membership", entityId: m.id, metadata: { role } });
  revalidatePath("/admin/team");
}
export async function removeMember(fd: FormData) {
  const s = await requireStaff("team.manage");
  const m = await prisma.membership.findFirst({ where: { id: String(fd.get("id")), tenantId: s.tenantId } });
  if (!m || m.role === "OWNER" || m.userId === s.userId) return;
  await prisma.membership.delete({ where: { id: m.id } });
  await revokeAllStaffSessions(m.userId);
  await audit({ tenantId: s.tenantId, actorUserId: s.userId, actorLabel: who(s), action: "team.remove", entityType: "Membership", entityId: m.id });
  revalidatePath("/admin/team");
}

export async function shopifyImportAction(): Promise<void> {
  const s = await requireStaff("integrations.manage");
  let msg: string;
  try {
    const r = await importShopifyProducts(s.tenantId);
    msg = `Imported ${r.created} product(s), skipped ${r.skipped}.`;
    await audit({ tenantId: s.tenantId, actorUserId: s.userId, actorLabel: who(s), action: "shopify.import", entityType: "Integration", metadata: r });
  } catch (e) { msg = e instanceof Error ? e.message : "Import failed"; }
  redirect(`/admin/integrations?msg=${encodeURIComponent(msg)}`);
}

export const providerList = async () => PROVIDERS.map((p) => ({ id: p.id, name: p.name, configured: p.configured(), note: p.note }));
