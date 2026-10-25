import type { Order, OrderItem, WhatsAppConversation } from "@prisma/client";
import { prisma } from "../db";
import { enqueue } from "../jobs";
import { formatMoney } from "../money";

export async function getOrCreateConversation(tenantId: string, waId: string, profileName?: string): Promise<WhatsAppConversation> {
  return prisma.whatsAppConversation.upsert({
    where: { tenantId_waId: { tenantId, waId } },
    create: { tenantId, waId, profileName: profileName ?? null },
    update: profileName ? { profileName } : {},
  });
}

export interface ReplyOptions {
  orderId?: string;
  buttons?: { id: string; title: string }[];
}

/** Records a free-form reply and queues it durably. Sending happens in the job worker. */
export async function queueReply(tenantId: string, conversationId: string, body: string, opts: ReplyOptions = {}) {
  await prisma.$transaction(async (tx) => {
    const msg = await tx.whatsAppMessage.create({
      data: {
        tenantId, conversationId, direction: "OUTBOUND", kind: opts.buttons?.length ? "interactive" : "text",
        body, orderId: opts.orderId ?? null, status: "QUEUED",
      },
    });
    await enqueue(tx, { tenantId, type: "WA_SEND_MESSAGE", payload: { messageId: msg.id, buttons: opts.buttons ?? null } });
  });
}

export function itemsSummary(items: Pick<OrderItem, "nameSnapshot" | "sizeSnapshot" | "colorSnapshot" | "quantity">[]): string {
  return items.map((i) => `${i.nameSnapshot} (${i.sizeSnapshot}, ${i.colorSnapshot}) x${i.quantity}`).join("; ");
}

/** The detailed confirmation text, used when we are inside the 24h customer-service window (interactive buttons). */
export function codConfirmationBody(order: Order & { items: OrderItem[] }): string {
  const lines = [
    "Hi! Thank you for shopping with THREAD & FORM.",
    "",
    `Order: ${order.publicRef}`,
    ...order.items.flatMap((i) => [
      "",
      `Product: ${i.nameSnapshot}`,
      `Size: ${i.sizeSnapshot}`,
      `Color: ${i.colorSnapshot}`,
      `Quantity: ${i.quantity}`,
    ]),
    "",
    `COD amount: ${formatMoney(order.totalPaise, order.currency)}`,
    "",
    "Please confirm that you want to purchase this product and pay the stated amount on delivery.",
  ];
  return lines.join("\n");
}
