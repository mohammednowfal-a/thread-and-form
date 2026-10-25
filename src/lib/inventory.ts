import { prisma, type Tx } from "./db";

/**
 * Inventory policy
 *  - RESERVE when a COD order is placed (atomic conditional UPDATE; DB CHECK constraints are the safety net).
 *  - RELEASE when the order is cancelled / expires before shipping.
 *  - CONSUME (onHand -= q, reserved -= q) when the order moves to SHIPPED.
 */
export async function reserveStock(tx: Tx, tenantId: string, variantId: string, qty: number): Promise<boolean> {
  const n = await tx.$executeRaw`
    UPDATE "InventoryRecord" SET "reserved" = "reserved" + ${qty}
    WHERE "tenantId" = ${tenantId} AND "variantId" = ${variantId} AND "onHand" - "reserved" >= ${qty}`;
  return n === 1;
}

export async function releaseStock(tx: Tx, tenantId: string, variantId: string, qty: number): Promise<void> {
  await tx.$executeRaw`
    UPDATE "InventoryRecord" SET "reserved" = GREATEST("reserved" - ${qty}, 0)
    WHERE "tenantId" = ${tenantId} AND "variantId" = ${variantId}`;
}

export async function consumeStock(tx: Tx, tenantId: string, variantId: string, qty: number): Promise<boolean> {
  const n = await tx.$executeRaw`
    UPDATE "InventoryRecord" SET "onHand" = "onHand" - ${qty}, "reserved" = "reserved" - ${qty}
    WHERE "tenantId" = ${tenantId} AND "variantId" = ${variantId} AND "reserved" >= ${qty} AND "onHand" >= ${qty}`;
  return n === 1;
}

export async function availableMap(tenantId: string, variantIds: string[]): Promise<Map<string, number>> {
  const rows = await prisma.inventoryRecord.findMany({ where: { tenantId, variantId: { in: variantIds } } });
  return new Map(rows.map((r) => [r.variantId, Math.max(r.onHand - r.reserved, 0)]));
}

export function availableOf(r: { onHand: number; reserved: number } | null | undefined): number {
  return r ? Math.max(r.onHand - r.reserved, 0) : 0;
}
