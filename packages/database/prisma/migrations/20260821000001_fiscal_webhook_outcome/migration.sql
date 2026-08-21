-- CreateEnum
CREATE TYPE "FiscalWebhookOutcome" AS ENUM ('VALIDATED', 'REJECTED', 'OTHER');

-- AlterTable
ALTER TABLE "FiscalWebhookEvent" ADD COLUMN     "cufe" TEXT,
ADD COLUMN     "outcome" "FiscalWebhookOutcome",
ADD COLUMN     "responseCode" TEXT,
ADD COLUMN     "responseMessage" TEXT,
ADD COLUMN     "signedXml" TEXT;
