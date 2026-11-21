-- 資料完整性約束（Prisma Schema 無法宣告的部分）

-- 庫存批次：不可負庫存、保留量不得超過在庫量
ALTER TABLE "InventoryLot"
  ADD CONSTRAINT "lot_onhand_nonneg" CHECK ("onHand" >= 0),
  ADD CONSTRAINT "lot_reserved_nonneg" CHECK ("reserved" >= 0),
  ADD CONSTRAINT "lot_reserved_le_onhand" CHECK ("reserved" <= "onHand"),
  ADD CONSTRAINT "lot_unitcost_nonneg" CHECK ("unitCost" >= 0);

ALTER TABLE "InventoryTransaction"
  ADD CONSTRAINT "invtx_qty_nonzero" CHECK ("quantity" <> 0),
  ADD CONSTRAINT "invtx_balance_nonneg" CHECK ("balanceAfter" >= 0);

ALTER TABLE "InventoryReservation"
  ADD CONSTRAINT "resv_qty_pos" CHECK ("quantity" > 0),
  ADD CONSTRAINT "resv_target" CHECK ("salesOrderItemId" IS NOT NULL OR "productionOrderId" IS NOT NULL);

ALTER TABLE "GreenBeanLot"
  ADD CONSTRAINT "green_weights_pos" CHECK ("purchasedWeightG" > 0 AND "receivedWeightG" > 0),
  ADD CONSTRAINT "green_costs_nonneg" CHECK ("unitPricePerKg" >= 0 AND "shippingCost" >= 0 AND "otherCost" >= 0);

ALTER TABLE "RoastBatch"
  ADD CONSTRAINT "roast_weights" CHECK ("greenWeightG" > 0 AND "roastedWeightG" > 0 AND "roastedWeightG" <= "greenWeightG"),
  ADD CONSTRAINT "roast_rating" CHECK ("qualityRating" IS NULL OR "qualityRating" BETWEEN 1 AND 10);

ALTER TABLE "ProductionOrder"
  ADD CONSTRAINT "po_qty_pos" CHECK ("plannedQty" > 0 AND ("actualQty" IS NULL OR "actualQty" >= 0)),
  ADD CONSTRAINT "po_fill_pos" CHECK ("fillWeightG" > 0),
  ADD CONSTRAINT "po_loss_nonneg" CHECK ("lossG" IS NULL OR "lossG" >= 0);

ALTER TABLE "ProductionConsumption" ADD CONSTRAINT "pc_qty_pos" CHECK ("quantity" > 0);

ALTER TABLE "ProductBundleComponent"
  ADD CONSTRAINT "bundle_qty_pos" CHECK ("quantity" > 0),
  ADD CONSTRAINT "bundle_not_self" CHECK ("bundleVariantId" <> "componentVariantId");

ALTER TABLE "ProductVariant"
  ADD CONSTRAINT "variant_prices_nonneg" CHECK ("listPrice" >= 0 AND "salePrice" >= 0),
  ADD CONSTRAINT "variant_fill_pos" CHECK ("fillWeightG" IS NULL OR "fillWeightG" > 0);

ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "soi_qty_pos" CHECK ("quantity" > 0);
ALTER TABLE "OrderBatchAllocation" ADD CONSTRAINT "alloc_qty_pos" CHECK ("quantity" > 0);
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "payment_amount_pos" CHECK ("amount" > 0);
ALTER TABLE "ReturnItem" ADD CONSTRAINT "return_qty_pos" CHECK ("quantity" > 0);
ALTER TABLE "SalesOrder" ADD CONSTRAINT "order_amounts_nonneg"
  CHECK ("subtotal" >= 0 AND "total" >= 0 AND "discountTotal" >= 0 AND "taxTotal" >= 0 AND "shippingFee" >= 0 AND "refundedTotal" >= 0 AND "refundedTotal" <= "total");

-- 庫存帳本不可修改、不可刪除；錯誤必須以沖銷交易更正
CREATE OR REPLACE FUNCTION ata_ledger_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_immutable: InventoryTransaction rows cannot be % (use a REVERSAL transaction)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "inventory_tx_immutable"
  BEFORE UPDATE OR DELETE ON "InventoryTransaction"
  FOR EACH ROW EXECUTE FUNCTION ata_ledger_immutable();

-- 稽核紀錄同樣只能新增
CREATE TRIGGER "audit_log_immutable"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION ata_ledger_immutable();
