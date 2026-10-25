import type { OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "../db";

/* Every function takes tenantId (derived server-side from the staff member's verified membership)
   and scopes every query by it. Nothing here accepts a tenant id from the browser. */

export const ADMIN_PAGE = 25;

export async function overview(tenantId: string) {
  const since7 = new Date(Date.now() - 7 * 86400_000);
  const [byStatus, awaiting, confirmed, manual, cancelled, total, collected, pipeline, recent, failedMsgs, deadJobs, failedEvents, lowStock, top] = await Promise.all([
    prisma.order.groupBy({ by: ["status"], where: { tenantId }, _count: true }),
    prisma.order.count({ where: { tenantId, status: "PENDING_CONFIRMATION", confirmationStatus: "AWAITING" } }),
    prisma.order.count({ where: { tenantId, confirmationStatus: "CONFIRMED" } }),
    prisma.order.count({ where: { tenantId, status: "PENDING_CONFIRMATION", confirmationStatus: "MANUAL_REVIEW" } }),
    prisma.order.count({ where: { tenantId, status: "CANCELLED" } }),
    prisma.order.count({ where: { tenantId } }),
    prisma.order.aggregate({ where: { tenantId, paymentStatus: "COLLECTED" }, _sum: { totalPaise: true } }),
    prisma.order.aggregate({ where: { tenantId, status: { in: ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED"] } }, _sum: { totalPaise: true } }),
    prisma.order.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.whatsAppMessage.count({ where: { tenantId, direction: "OUTBOUND", status: "FAILED", createdAt: { gte: since7 } } }),
    prisma.job.count({ where: { tenantId, status: "DEAD" } }),
    prisma.webhookEvent.count({ where: { status: "FAILED" } }),
    lowStockVariants(tenantId, 6),
    topProducts(tenantId, 5),
  ]);
  return {
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count])) as Partial<Record<OrderStatus, number>>,
    awaiting, confirmed, manual, cancelled, total, cancellationRate: total ? cancelled / total : 0,
    collectedPaise: collected._sum.totalPaise ?? 0, pipelinePaise: pipeline._sum.totalPaise ?? 0,
    recent, failedMsgs, deadJobs, failedEvents, lowStock, top,
  };
}

export async function lowStockVariants(tenantId: string, take = 100) {
  const rows = await prisma.inventoryRecord.findMany({
    where: { tenantId, variant: { active: true, product: { status: { not: "ARCHIVED" } } } },
    include: { variant: { include: { product: { select: { name: true, slug: true } } } } },
  });
  return rows.filter((r) => r.onHand - r.reserved <= r.lowStockThreshold).sort((a, b) => a.onHand - a.reserved - (b.onHand - b.reserved)).slice(0, take);
}

export async function topProducts(tenantId: string, take = 5) {
  const g = await prisma.orderItem.groupBy({
    by: ["productId", "nameSnapshot"],
    where: { order: { tenantId, status: { notIn: ["CANCELLED", "RETURNED"] } } },
    _sum: { quantity: true, lineTotalPaise: true }, orderBy: { _sum: { quantity: "desc" } }, take,
  });
  return g.map((r) => ({ name: r.nameSnapshot, units: r._sum.quantity ?? 0, revenuePaise: r._sum.lineTotalPaise ?? 0 }));
}

export interface OrderFilter { status?: OrderStatus; confirmation?: string; q?: string; page?: number }

export async function listOrders(tenantId: string, f: OrderFilter) {
  const where: Prisma.OrderWhereInput = {
    tenantId,
    ...(f.status ? { status: f.status } : {}),
    ...(f.confirmation ? { confirmationStatus: f.confirmation as never } : {}),
    ...(f.q ? { OR: [{ publicRef: { contains: f.q.toUpperCase() } }, { contactPhone: { contains: f.q.replace(/\D/g, "") || "no-match" } }, { contactName: { contains: f.q, mode: "insensitive" } }] } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where, orderBy: { createdAt: "desc" }, skip: ((f.page ?? 1) - 1) * ADMIN_PAGE, take: ADMIN_PAGE,
      include: { messages: { where: { direction: "OUTBOUND", templateName: { not: null } }, orderBy: { createdAt: "desc" }, take: 1 } },
    }),
  ]);
  return { total, items, pages: Math.max(1, Math.ceil(total / ADMIN_PAGE)) };
}

export function getOrder(tenantId: string, id: string) {
  return prisma.order.findFirst({
    where: { id, tenantId },
    include: {
      items: true, history: { orderBy: { createdAt: "asc" } }, cod: true, shipments: { orderBy: { createdAt: "desc" } }, returns: true,
      messages: { orderBy: { createdAt: "asc" } }, customer: true,
    },
  });
}

export async function listCustomers(tenantId: string, page = 1) {
  const [total, items] = await Promise.all([
    prisma.customer.count({ where: { tenantId } }),
    prisma.customer.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, skip: (page - 1) * ADMIN_PAGE, take: ADMIN_PAGE, include: { _count: { select: { orders: true } } } }),
  ]);
  // Guest buyers have no account: summarise them from orders so support can still find them.
  const guests = await prisma.order.groupBy({ by: ["contactPhone", "contactName"], where: { tenantId, customerId: null }, _count: true, _sum: { totalPaise: true }, orderBy: { _max: { createdAt: "desc" } }, take: 25 });
  return { total, items, guests, pages: Math.max(1, Math.ceil(total / ADMIN_PAGE)) };
}

export async function confirmationMonitor(tenantId: string) {
  const [counts, rows] = await Promise.all([
    prisma.order.groupBy({ by: ["confirmationStatus"], where: { tenantId }, _count: true }),
    prisma.order.findMany({
      where: { tenantId, OR: [{ confirmationStatus: { in: ["AWAITING", "MANUAL_REVIEW", "CANCEL_REQUESTED"] } }, { messages: { some: { status: "FAILED", direction: "OUTBOUND" } } }] },
      orderBy: { createdAt: "desc" }, take: 40,
      include: { messages: { where: { direction: "OUTBOUND", templateName: { not: null } }, orderBy: { createdAt: "desc" }, take: 1 } },
    }),
  ]);
  return { counts: Object.fromEntries(counts.map((c) => [c.confirmationStatus, c._count])) as Record<string, number>, rows };
}

/** One combined label for the admin; the underlying message status and confirmation status stay separate columns. */
export function whatsappStage(confirmation: string, orderStatus: string, msg?: { status: string } | null): string {
  if (orderStatus === "CANCELLED" || confirmation === "CANCELLED") return "Cancelled";
  if (confirmation === "CONFIRMED") return "Confirmed by customer";
  if (confirmation === "CANCEL_REQUESTED") return "Cancellation requested";
  if (confirmation === "MANUAL_REVIEW") return msg?.status === "FAILED" ? "Message failed / manual review" : "Requires manual review";
  if (confirmation === "NOT_REQUIRED") return "Not required";
  if (!msg || msg.status === "QUEUED") return "Confirmation message queued";
  if (msg.status === "SENT") return "Message sent";
  if (msg.status === "DELIVERED" || msg.status === "READ") return "Delivered (awaiting reply)";
  return "Awaiting WhatsApp confirmation";
}

export async function analytics(tenantId: string, days = 14) {
  const since = new Date(Date.now() - days * 86400_000);
  const rows = await prisma.$queryRaw<{ day: Date; orders: bigint; value: bigint }[]>`
    SELECT date_trunc('day', "createdAt") AS day, COUNT(*) AS orders, COALESCE(SUM("totalPaise"),0) AS value
    FROM "Order" WHERE "tenantId" = ${tenantId} AND "createdAt" >= ${since} AND "status" <> 'CANCELLED'
    GROUP BY 1 ORDER BY 1`;
  return rows.map((r) => ({ day: r.day, orders: Number(r.orders), valuePaise: Number(r.value) }));
}
