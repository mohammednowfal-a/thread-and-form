import { NextResponse } from "next/server";
import { isProd } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { rateLimit } from "@/lib/ratelimit";
import { waConfig } from "@/lib/whatsapp/config";
import { verifySignature } from "@/lib/whatsapp/signature";
import { ingestWhatsAppPayload } from "@/lib/whatsapp/process";

export const dynamic = "force-dynamic";
const MAX_BODY = 1_000_000;

/** Meta subscription verification handshake. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const cfg = waConfig();
  const token = u.searchParams.get("hub.verify_token") ?? "";
  if (u.searchParams.get("hub.mode") === "subscribe" && cfg.verifyToken && safeEqual(token, cfg.verifyToken)) {
    return new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200, headers: { "content-type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown").trim();
  if (!(await rateLimit(`wa-webhook:${ip}`, 600, 60))) return new Response("Too many requests", { status: 429 });

  const raw = await req.text();
  if (raw.length > MAX_BODY) return new Response("Payload too large", { status: 413 });

  const { appSecret } = waConfig();
  if (appSecret) {
    if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), appSecret)) return new Response("Invalid signature", { status: 401 });
  } else if (isProd()) {
    return new Response("Webhook is not configured", { status: 503 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  try {
    const r = await ingestWhatsAppPayload(payload);
    // Always 200 once stored, so Meta doesn't redeliver forever; failed events are visible and replayable in the admin.
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    console.error("[wa-webhook] ingest failed", e instanceof Error ? e.message : e);
    return new Response("Server error", { status: 500 }); // Meta will retry
  }
}
