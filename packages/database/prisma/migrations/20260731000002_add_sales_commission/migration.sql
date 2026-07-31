-- Create CommissionType enum type
CREATE TYPE "CommissionType" AS ENUM ('NONE', 'PERCENTAGE', 'FIXED');

-- Product: sales-commission configuration. commissionValue is a percentage
-- when the type is PERCENTAGE or a fixed per-unit amount when FIXED. The
-- optional window bounds when the commission applies; outside it the
-- commission is simply inactive (never blocks the sale).
ALTER TABLE "Product"
  ADD COLUMN "commissionType" "CommissionType" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "commissionValue" DECIMAL(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "commissionStartsAt" TIMESTAMP(3),
  ADD COLUMN "commissionEndsAt" TIMESTAMP(3);

-- SaleItem: commission snapshotted at sale time. The snapshot fields are
-- NULL together when no commission accrued; commissionAmount defaults to 0.
ALTER TABLE "SaleItem"
  ADD COLUMN "commissionTypeSnapshot" "CommissionType",
  ADD COLUMN "commissionValueSnapshot" DECIMAL(15, 2),
  ADD COLUMN "commissionAmount" DECIMAL(15, 2) NOT NULL DEFAULT 0;
