import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const g = globalThis as unknown as { __prisma?: PrismaClient };

function create(): PrismaClient {
  const raw = process.env.DATABASE_URL ?? "";
  let schema = "public";
  let conn = raw;
  try {
    const u = new URL(raw);
    schema = u.searchParams.get("schema") ?? "public";
    u.searchParams.delete("schema");
    conn = u.toString();
  } catch {
    /* DATABASE_URL missing or malformed: surfaces at first query */
  }
  const adapter = new PrismaPg({ connectionString: conn }, { schema });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = g.__prisma ?? create();
if (process.env.NODE_ENV !== "production") g.__prisma = prisma;

export type Tx = Prisma.TransactionClient;
export { Prisma };

export function isUniqueViolation(e: unknown, field?: string): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  if (!field) return true;
  return JSON.stringify(e.meta ?? {}).includes(field);
}
