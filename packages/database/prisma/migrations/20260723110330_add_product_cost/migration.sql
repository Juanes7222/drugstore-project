-- Create ProductCostHistory table
CREATE TABLE "ProductCostHistory" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "previousCostHistoryId" TEXT,
    "cost" DECIMAL(15,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL,
    "changeReason" TEXT,

    CONSTRAINT "ProductCostHistory_pkey" PRIMARY KEY ("id")
);

-- Add currentCostId to Product
ALTER TABLE "Product" ADD COLUMN "currentCostId" TEXT;

-- Create indexes
CREATE INDEX "ProductCostHistory_productId_idx" ON "ProductCostHistory"("productId");
CREATE INDEX "ProductCostHistory_productId_effectiveFrom_idx" ON "ProductCostHistory"("productId", "effectiveFrom");

-- Add foreign keys
ALTER TABLE "ProductCostHistory" ADD CONSTRAINT "ProductCostHistory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductCostHistory" ADD CONSTRAINT "ProductCostHistory_previousCostHistoryId_fkey" FOREIGN KEY ("previousCostHistoryId") REFERENCES "ProductCostHistory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_currentCostId_fkey" FOREIGN KEY ("currentCostId") REFERENCES "ProductCostHistory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
