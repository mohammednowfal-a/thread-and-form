import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { rateLimit } from "@/lib/ratelimit";
import { transitionOrder } from "@/lib/orders";
import { mapCourierStatus } from "@/lib/integrations/shipping";

export const dynamic = "force-dynamic";
const TOKENS: Record<string, string> = { shiprocket: "SHIPROCKET_WEBHOOK_TOKEN", delhivery: "DELHIVERY_WEBHOOK_TOKEN" };

/** Courier status callbacks. Authenticated by a shared token header; idempotent via the order state machine. */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const envName = TOKENS[provider];
  const secret = envName ? env(envName) : "";
  if (!secret) return new Response("Not found", { status: 404 });
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown").trim();
  if (!(await rateLimit(`ship-webhook:${ip}`, 300, 60))) return new Response("Too many requests", { status: 429 });
  if (!safeEqual(req.headers.get("x-webhook-token") ?? "", secret)) return new Response("Unauthorized", { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const awb = String(body?.awb ?? body?.waybill ?? body?.tracking_number ?? "");
  const status = String(body?.current_status ?? body?.status ?? "");
  if (!awb || !status) return NextResponse.json({ ok: true, ignored: true });

  const shipment = await prisma.shipment.findFirst({ where: { provider, trackingNumber: awb }, include: { order: true } });
  if (!shipment) return NextResponse.json({ ok: true, ignored: true });
  await prisma.shipment.update({ where: { id: shipment.id }, data: { status: status.slice(0, 80), lastEvent: { status, at: new Date().toISOString() } } });
  const next = mapCourierStatus(status);
  if (next && next !== shipment.order.status) {
    try {
      await transitionOrder({ tenantId: shipment.tenantId, orderId: shipment.orderId, to: next, source: `shipping:${provider}`, note: status.slice(0, 120) });
    } catch {
      /* Not a valid transition from the current state (duplicate or out-of-order callback): ignore safely. */
    }
  }
  return NextResponse.json({ ok: true });
}
