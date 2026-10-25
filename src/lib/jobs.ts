import { randomUUID } from "crypto";
import { prisma, type Tx } from "./db";

export interface JobInput {
  tenantId?: string | null;
  type: string;
  payload: Record<string, unknown>;
  dedupeKey?: string;
  runAt?: Date;
  maxAttempts?: number;
}

/** Durable outbox: insert inside the caller's transaction. Duplicate dedupeKey is silently ignored. */
export async function enqueue(db: Tx | typeof prisma, job: JobInput): Promise<void> {
  await db.$executeRaw`
    INSERT INTO "Job" ("id", "tenantId", "type", "payload", "status", "attempts", "maxAttempts", "runAt", "dedupeKey", "createdAt", "updatedAt")
    VALUES (${randomUUID()}, ${job.tenantId ?? null}, ${job.type}, ${JSON.stringify(job.payload)}::jsonb, 'PENDING'::"JobStatus", 0,
            ${job.maxAttempts ?? 6}, ${job.runAt ?? new Date()}, ${job.dedupeKey ?? null}, now(), now())
    ON CONFLICT ("dedupeKey") DO NOTHING`;
}

export class NonRetryableError extends Error {}

export const BACKOFF_SECONDS = [30, 120, 600, 1800, 7200, 21600];
export function backoffSeconds(attempt: number): number {
  return BACKOFF_SECONDS[Math.min(Math.max(attempt - 1, 0), BACKOFF_SECONDS.length - 1)] ?? 21600;
}

export interface ClaimedJob {
  id: string;
  tenantId: string | null;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

export async function claimJobs(limit = 10): Promise<ClaimedJob[]> {
  return prisma.$queryRaw<ClaimedJob[]>`
    UPDATE "Job" SET "status" = 'RUNNING'::"JobStatus", "lockedAt" = now(), "attempts" = "attempts" + 1, "updatedAt" = now()
    WHERE "id" IN (
      SELECT "id" FROM "Job"
      WHERE ("status" = 'PENDING'::"JobStatus" AND "runAt" <= now())
         OR ("status" = 'RUNNING'::"JobStatus" AND "lockedAt" < now() - interval '5 minutes')
      ORDER BY "runAt" ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    RETURNING "id", "tenantId", "type", "payload", "attempts", "maxAttempts"`;
}

export type JobHandler = (job: ClaimedJob) => Promise<void>;

export async function finishJob(job: ClaimedJob, error?: unknown) {
  if (!error) {
    await prisma.job.update({ where: { id: job.id }, data: { status: "DONE", lockedAt: null, lastError: null } });
    return;
  }
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  const dead = error instanceof NonRetryableError || job.attempts >= job.maxAttempts;
  await prisma.job.update({
    where: { id: job.id },
    data: dead
      ? { status: "DEAD", lockedAt: null, lastError: message }
      : { status: "PENDING", lockedAt: null, lastError: message, runAt: new Date(Date.now() + backoffSeconds(job.attempts) * 1000) },
  });
}

/** Safe replay of a dead job from the admin UI. */
export async function replayJob(tenantId: string, jobId: string): Promise<boolean> {
  const r = await prisma.job.updateMany({
    where: { id: jobId, tenantId, status: "DEAD" },
    data: { status: "PENDING", attempts: 0, runAt: new Date(), lastError: null },
  });
  return r.count === 1;
}
