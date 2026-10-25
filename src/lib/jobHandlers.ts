import type { Order, OrderItem, WhatsAppMessage } from "@prisma/client";
import { prisma } from "./db";
import { appUrl } from "./env";
import { formatMoney } from "./money";
import { claimJobs, finishJob, NonRetryableError, type ClaimedJob, type JobHandler } from "./jobs";
import { expireStaleOrders } from "./orders";
import { sendEmail } from "./integrations/email";
import { waConfig, withinServiceWindow } from "./whatsapp/config";
import { sendButtons, sendTemplate, sendText, WhatsAppProviderError } from "./whatsapp/client";
import { codConfirmationBody, getOrCreateConversation, itemsSummary } from "./whatsapp/outbound";
import { buttonPayload } from "./whatsapp/parse";

type OrderFull = Order & { items: OrderItem[] };

async function loadOrder(orderId: unknown): Promise<OrderFull | null> {
  if (typeof orderId !== "string") return null;
  return prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
}

async function markSent(msg: WhatsAppMessage, providerId: string) {
  await prisma.whatsAppMessage.update({ where: { id: msg.id }, data: { status: "SENT", providerMessageId: providerId, sentAt: new Date(), errorCode: null, errorMessage: null } });
}
async function markFailed(msgId: string, code: string, message: string) {
  await prisma.whatsAppMessage.update({ where: { id: msgId }, data: { status: "FAILED", errorCode: code, errorMessage: message.slice(0, 300) } });
}

/* ------- business-initiated COD confirmation request (template, or buttons inside the 24h window) ------- */
async function waCodConfirm(job: ClaimedJob) {
  const order = await loadOrder(job.payload.orderId);
  if (!order || order.status !== "PENDING_CONFIRMATION" || order.confirmationStatus !== "AWAITING") return;
  const cfg = waConfig();
  const conv = await getOrCreateConversation(order.tenantId, order.contactPhone, order.contactName);
  const manualReview = () => prisma.order.updateMany({ where: { id: order.id, confirmationStatus: "AWAITING" }, data: { confirmationStatus: "MANUAL_REVIEW" } });

  // A staff "resend" pre-creates its own message row and passes its id; otherwise reuse the order's original request row.
  const preId = typeof job.payload.messageId === "string" ? job.payload.messageId : null;
  let msg = preId
    ? await prisma.whatsAppMessage.findFirst({ where: { id: preId, orderId: order.id } })
    : await prisma.whatsAppMessage.findFirst({ where: { orderId: order.id, direction: "OUTBOUND", templateName: cfg.templates.codConfirm }, orderBy: { createdAt: "asc" } });
  if (msg && msg.status !== "QUEUED") return; // already sent (or terminally failed)
  msg ??= await prisma.whatsAppMessage.create({
    data: { tenantId: order.tenantId, conversationId: conv.id, direction: "OUTBOUND", kind: "template", body: codConfirmationBody(order), templateName: cfg.templates.codConfirm, orderId: order.id, status: "QUEUED" },
  });

  if (conv.optedOutAt) {
    await markFailed(msg.id, "OPTED_OUT", "Customer opted out of WhatsApp messages");
    await manualReview();
    return;
  }
  if (!cfg.configured) {
    await markFailed(msg.id, "NOT_CONFIGURED", "WhatsApp is not connected; confirm this order manually");
    await manualReview();
    return;
  }
  try {
    const payloads = [buttonPayload("CONFIRM", order.publicRef), buttonPayload("CANCEL", order.publicRef)];
    const r = withinServiceWindow(conv.lastInboundAt)
      ? await sendButtons(order.contactPhone, msg.body, [{ id: payloads[0] as string, title: "Confirm Order" }, { id: payloads[1] as string, title: "Cancel Order" }])
      : await sendTemplate(order.contactPhone, cfg.templates.codConfirm, cfg.templates.language, [order.publicRef, itemsSummary(order.items), formatMoney(order.totalPaise, order.currency)], payloads);
    await markSent(msg, r.messageId);
    await prisma.codConfirmation.updateMany({ where: { orderId: order.id }, data: { requestMessageId: msg.id } });
  } catch (e) {
    const err = e instanceof WhatsAppProviderError ? e : new WhatsAppProviderError("Unexpected send error", true);
    if (!err.retryable || job.attempts >= job.maxAttempts) {
      await markFailed(msg.id, err.code ?? "ERROR", err.message);
      await manualReview();
      return; // terminal: reported honestly in the admin dashboard
    }
    await prisma.whatsAppMessage.update({ where: { id: msg.id }, data: { errorCode: err.code ?? null, errorMessage: err.message.slice(0, 300) } });
    throw err; // retry with backoff
  }
}

/* ------- free-form replies queued by the chatbot (always inside the customer-service window) ------- */
async function waSendMessage(job: ClaimedJob) {
  const messageId = String(job.payload.messageId ?? "");
  const msg = await prisma.whatsAppMessage.findUnique({ where: { id: messageId }, include: { conversation: true } });
  if (!msg || msg.status !== "QUEUED") return;
  if (!waConfig().configured) return markFailed(msg.id, "NOT_CONFIGURED", "WhatsApp is not connected");
  if (!withinServiceWindow(msg.conversation.lastInboundAt)) return markFailed(msg.id, "OUTSIDE_WINDOW", "Free-form messages are only allowed within 24h of the customer's last message");
  try {
    const buttons = Array.isArray(job.payload.buttons) ? (job.payload.buttons as { id: string; title: string }[]) : null;
    const r = buttons?.length ? await sendButtons(msg.conversation.waId, msg.body, buttons) : await sendText(msg.conversation.waId, msg.body);
    await markSent(msg, r.messageId);
  } catch (e) {
    const err = e instanceof WhatsAppProviderError ? e : new WhatsAppProviderError("Unexpected send error", true);
    if (!err.retryable || job.attempts >= job.maxAttempts) return markFailed(msg.id, err.code ?? "ERROR", err.message);
    throw err;
  }
}

/* ------- notices (acks + status updates): text in-window, template out-of-window, otherwise honest failure ------- */
async function deliverNotice(order: OrderFull, key: string, text: string, job: ClaimedJob) {
  const cfg = waConfig();
  const conv = await getOrCreateConversation(order.tenantId, order.contactPhone, order.contactName);
  const label = `notice:${key}`;
  let msg = await prisma.whatsAppMessage.findFirst({ where: { orderId: order.id, direction: "OUTBOUND", templateName: label } });
  if (msg && msg.status !== "QUEUED") return;
  msg ??= await prisma.whatsAppMessage.create({ data: { tenantId: order.tenantId, conversationId: conv.id, direction: "OUTBOUND", kind: "text", body: text, templateName: label, orderId: order.id, status: "QUEUED" } });
  if (conv.optedOutAt) return markFailed(msg.id, "OPTED_OUT", "Customer opted out");
  if (!cfg.configured) return markFailed(msg.id, "NOT_CONFIGURED", "WhatsApp is not connected");
  try {
    const r = withinServiceWindow(conv.lastInboundAt)
      ? await sendText(order.contactPhone, text)
      : await sendTemplate(order.contactPhone, cfg.templates.orderStatus, cfg.templates.language, [order.publicRef, text]);
    await markSent(msg, r.messageId);
  } catch (e) {
    const err = e instanceof WhatsAppProviderError ? e : new WhatsAppProviderError("Unexpected send error", true);
    if (!err.retryable || job.attempts >= job.maxAttempts) return markFailed(msg.id, err.code ?? "ERROR", err.message);
    throw err;
  }
}

const ackHandler = (key: string, textFor: (o: OrderFull) => string): JobHandler => async (job) => {
  const order = await loadOrder(job.payload.orderId);
  if (!order || !order.whatsappConsent) return;
  await deliverNotice(order, key, textFor(order), job);
};

const emailOrderPlaced: JobHandler = async (job) => {
  const order = await loadOrder(job.payload.orderId);
  if (!order?.contactEmail) return;
  const body = [
    `Hi ${order.contactName},`, "", `Thanks for your THREAD & FORM order ${order.publicRef}.`, "",
    ...order.items.map((i) => `- ${i.nameSnapshot} (${i.sizeSnapshot}, ${i.colorSnapshot}) x${i.quantity}`), "",
    `Pay on delivery: ${formatMoney(order.totalPaise, order.currency)}`, "",
    `Track your order: ${appUrl()}/track`,
  ].join("\n");
  await sendEmail(order.contactEmail, `Your THREAD & FORM order ${order.publicRef}`, body); // NOT_CONNECTED is reported, not faked
};

const emailPasswordReset: JobHandler = async (job) => {
  const to = String(job.payload.to ?? "");
  const url = String(job.payload.url ?? "");
  if (!to || !url) throw new NonRetryableError("Invalid reset job");
  await sendEmail(to, "Reset your THREAD & FORM password", `Use this link within 1 hour to choose a new password:\n${url}\n\nIf you did not ask for this, ignore this email.`);
};

export const HANDLERS: Record<string, JobHandler> = {
  WA_COD_CONFIRM: waCodConfirm,
  WA_SEND_MESSAGE: waSendMessage,
  WA_ORDER_CONFIRMED_ACK: ackHandler("confirmed", (o) => `Thank you! Your order ${o.publicRef} is confirmed. We'll pack it soon and keep you posted. COD amount: ${formatMoney(o.totalPaise, o.currency)}.`),
  WA_ORDER_CANCELLED_ACK: ackHandler("cancelled", (o) => `Your order ${o.publicRef} has been cancelled. No payment is needed. You're always welcome back at THREAD & FORM.`),
  WA_ORDER_STATUS: async (job) => {
    const order = await loadOrder(job.payload.orderId);
    if (!order || !order.whatsappConsent) return;
    const status = String(job.payload.status ?? "");
    const text = status === "SHIPPED" ? `Your order ${order.publicRef} has been shipped. Keep ${formatMoney(order.totalPaise, order.currency)} ready for delivery.` : `Your order ${order.publicRef} was delivered. Thank you for shopping with THREAD & FORM!`;
    await deliverNotice(order, `status-${status}`, text, job);
  },
  EMAIL_ORDER_PLACED: emailOrderPlaced,
  EMAIL_PASSWORD_RESET: emailPasswordReset,
};

/** Data-retention policy: keep operational logs only as long as they are useful. */
export async function purgeOldData(now = new Date()): Promise<void> {
  const d = (days: number) => new Date(now.getTime() - days * 86400_000);
  await prisma.webhookEvent.deleteMany({ where: { status: { in: ["PROCESSED", "IGNORED"] }, receivedAt: { lt: d(30) } } });
  await prisma.job.deleteMany({ where: { status: "DONE", updatedAt: { lt: d(14) } } });
  await prisma.rateLimitBucket.deleteMany({ where: { resetAt: { lt: now } } });
  await prisma.staffSession.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: d(30) } }] } });
  await prisma.customerSession.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: d(30) } }] } });
  await prisma.passwordReset.deleteMany({ where: { expiresAt: { lt: d(1) } } });
}
let lastPurge = 0;

/** One worker tick: expire stale COD orders, then run due jobs. Safe to run from several processes. */
export async function runWorkerTick(limit = 10): Promise<{ processed: number; expired: number }> {
  if (Date.now() - lastPurge > 3600_000) {
    lastPurge = Date.now();
    await purgeOldData().catch((e) => console.error("[purge] failed", e instanceof Error ? e.message : e));
  }
  const expired = await expireStaleOrders();
  const jobs = await claimJobs(limit);
  for (const job of jobs) {
    const handler = HANDLERS[job.type];
    try {
      if (!handler) throw new NonRetryableError(`No handler for job type ${job.type}`);
      await handler(job);
      await finishJob(job);
    } catch (e) {
      await finishJob(job, e);
    }
  }
  return { processed: jobs.length, expired };
}
