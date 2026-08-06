-- CreateIndex
-- Descending index backing SaleService.getNextLocalNumber (findFirst
-- orderBy localNumber desc filtered by workstationId) without a sort.
CREATE INDEX "Sale_workstationId_localNumber_idx" ON "Sale"("workstationId", "localNumber" DESC);
