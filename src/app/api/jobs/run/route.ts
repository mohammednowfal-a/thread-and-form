import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { runWorkerTick } from "@/lib/jobHandlers";

export const dynamic = "force-dynamic";

/** Optional HTTP trigger for hosts that prefer cron over a long-running worker. */
export async function POST(req: Request) {
  const secret = env("JOBS_SECRET");
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return new Response("Unauthorized", { status: 401 });
  return NextResponse.json(await runWorkerTick(25));
}
