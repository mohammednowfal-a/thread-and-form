import { prisma, Prisma, type Tx } from "./db";

export interface AuditInput {
  tenantId?: string | null;
  actorUserId?: string | null;
  actorLabel: string; // e.g. "staff:jane@x.com", "whatsapp:9199…", "system"
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

const SECRET_KEYS = /pass|token|secret|authorization|api[_-]?key/i;

function scrub(obj: Record<string, unknown>): Prisma.InputJsonValue {
  const out: Record<string, Prisma.InputJsonValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEYS.test(k)) continue;
    out[k] = (typeof v === "object" && v !== null ? JSON.parse(JSON.stringify(v)) : (v ?? null)) as Prisma.InputJsonValue;
  }
  return out;
}

export async function audit(input: AuditInput, db: Tx | typeof prisma = prisma) {
  await db.auditLog.create({
    data: {
      tenantId: input.tenantId ?? null,
      actorUserId: input.actorUserId ?? null,
      actorLabel: input.actorLabel,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadata: scrub(input.metadata ?? {}),
    },
  });
}
