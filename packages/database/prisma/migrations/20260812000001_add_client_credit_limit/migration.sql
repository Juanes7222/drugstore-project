-- Store credit feature: per-client credit limit in COP (pesos).
-- NULL = the client has no credit; falls back to the tenant default limit.
ALTER TABLE "Client" ADD COLUMN "creditLimit" DECIMAL(15,2);
