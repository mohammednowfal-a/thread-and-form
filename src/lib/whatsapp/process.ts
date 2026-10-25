import type { MessageStatus, Prisma, Tenant } from "@prisma/client";
import { prisma, isUniqueViolation } from "../db";
import { env, isProd } from "../env";
import { waConfig } from "./config";
import { handleInbound } from "./chatbot";
import { getOrCreateConversation } from "./outbound";
import { parseWebhook, type WaEvent, type InboundEvent, type StatusEvent } from "./parse";

export async function resolveTenant(phoneNumberId: string): Promise<Tenant | null> {
  if (phoneNumberId) {
    const acct = await prisma.integrationAccount.findFirst({
      where: { provider: "whatsapp", config: { path: ["phoneNumberId"], equals: phoneNumberId } },
      include: { tenant: true },
    });
    if (acct) return acct.tenant;
    if (waConfig().phoneNumberId === phoneNumberId) return prisma.tenant.findUnique({ where: { slug: env("STOREFRONT_TENANT_SLUG", "thread-and-form") } });
    return null;
  }
  // Only allow the no-phone-number-id fallback outside production (local test payloads).
  if (!isProd()) return prisma.tenant.findUnique({ where: { slug: env("STOREFRONT_TENANT_SLUG", "thread-and-form") } });
  return null;
}

export interface IngestResult {
  received: number;
  duplicates: number;
  failed: number;
}

/** Stores each event durably (unique per provider event id) and then processes it exactly once. */
export async function ingestWhatsAppPayload(payload: unknown): Promise<IngestResult> {
  const events = parseWebhook(payload);
  const result: IngestResult = { received: events.length, duplicates: 0, failed: 0 };
  for (const ev of events) {
    let stored;
    try {
      stored = await prisma.webhookEvent.create({
        data: { provider: "whatsapp", externalId: ev.externalId, payload: ev as unknown as Prisma.InputJsonValue },
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        result.duplicates++;
        continue;
      }
      throw e;
    }
    const ok = await processStoredEvent(stored.id);
    if (!ok) result.failed++;
  }
  return result;
}

export async function processStoredEvent(id: string): Promise<boolean> {
  const row = await prisma.webhookEvent.findUnique({ where: { id } });
  if (!row) return false;
  try {
    const outcome = await processEvent(row.payload as unknown as WaEvent);
    await prisma.webhookEvent.update({ where: { id }, data: { status: outcome === "ignored" ? "IGNORED" : "PROCESSED", processedAt: new Date(), error: null } });
    return true;
  } catch (e) {
    await prisma.webhookEvent.update({ where: { id }, data: { status: "FAILED", error: (e instanceof Error ? e.message : String(e)).slice(0, 500) } });
    return false;
  }
}

/** Safe replay from the admin UI: processing is idempotent (message ids + order state machine). */
export async function replayWebhookEvent(id: string): Promise<boolean> {
  const row = await prisma.webhookEvent.findUnique({ where: { id } });
  if (!row || row.status === "PROCESSED") return false;
  return processStoredEvent(id);
}

async function processEvent(ev: WaEvent): Promise<"done" | "ignored"> {
  const tenant = await resolveTenant(ev.phoneNumberId);
  if (!tenant) return "ignored";
  return ev.kind === "message" ? processInbound(tenant, ev) : processStatus(tenant, ev);
}

async function processInbound(tenant: Tenant, ev: InboundEvent): Promise<"done" | "ignored"> {
  const conv = await getOrCreateConversation(tenant.id, ev.from, ev.profileName);
  try {
    await prisma.whatsAppMessage.create({
      data: {
        tenantId: tenant.id, conversationId: conv.id, direction: "INBOUND", providerMessageId: ev.externalId,
        kind: ev.buttonId ? "button_reply" : ev.messageType, body: ev.text, status: "RECEIVED", sentAt: new Date(),
      },
    });
  } catch (e) {
    if (isUniqueViolation(e)) return "ignored"; // same inbound message delivered twice
    throw e;
  }
  const fresh = await prisma.whatsAppConversation.update({ where: { id: conv.id }, data: { lastInboundAt: new Date() } });
  await handleInbound({ tenant, conv: fresh, ev });
  return "done";
}

const RANK: Record<string, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3 };

async function processStatus(tenant: Tenant, ev: StatusEvent): Promise<"done" | "ignored"> {
  const msg = await prisma.whatsAppMessage.findFirst({ where: { tenantId: tenant.id, providerMessageId: ev.messageId, direction: "OUTBOUND" } });
  if (!msg) throw new Error("Status for an unknown message (will succeed on replay if the send was still being recorded)");
  const incoming = ev.status.toUpperCase() as MessageStatus;
  const when = ev.timestamp ? new Date(ev.timestamp * 1000) : new Date();
  const cur = RANK[msg.status];

  if (incoming === "FAILED") {
    if (msg.status === "DELIVERED" || msg.status === "READ") return "done";
    await prisma.whatsAppMessage.update({ where: { id: msg.id }, data: { status: "FAILED", errorCode: ev.errorCode ?? null, errorMessage: ev.errorMessage?.slice(0, 300) ?? null } });
    if (msg.orderId && msg.templateName) {
      await prisma.order.updateMany({ where: { id: msg.orderId, tenantId: tenant.id, status: "PENDING_CONFIRMATION", confirmationStatus: "AWAITING" }, data: { confirmationStatus: "MANUAL_REVIEW" } });
    }
    return "done";
  }
  const next = RANK[incoming];
  if (next === undefined || (cur !== undefined && next <= cur)) return "done";
  await prisma.whatsAppMessage.update({
    where: { id: msg.id },
    data: {
      status: incoming,
      ...(incoming === "SENT" ? { sentAt: when } : {}),
      ...(incoming === "DELIVERED" ? { deliveredAt: when } : {}),
      ...(incoming === "READ" ? { readAt: when, deliveredAt: msg.deliveredAt ?? when } : {}),
    },
  });
  return "done";
}
