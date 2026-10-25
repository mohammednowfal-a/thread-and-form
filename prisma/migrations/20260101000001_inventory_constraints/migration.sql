-- Database-level inventory safety net: stock can never go negative or over-reserved,
-- even if application code has a bug or two requests race.
ALTER TABLE "InventoryRecord" ADD CONSTRAINT "InventoryRecord_onHand_nonneg" CHECK ("onHand" >= 0);
ALTER TABLE "InventoryRecord" ADD CONSTRAINT "InventoryRecord_reserved_nonneg" CHECK ("reserved" >= 0);
ALTER TABLE "InventoryRecord" ADD CONSTRAINT "InventoryRecord_reserved_lte_onhand" CHECK ("reserved" <= "onHand");
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_quantity_range" CHECK ("quantity" BETWEEN 1 AND 10);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "Order" ADD CONSTRAINT "Order_total_nonneg" CHECK ("totalPaise" >= 0);
