-- CreateEnum
CREATE TYPE "FiscalProvider" AS ENUM ('DIAN_DIRECT', 'ALANUBE', 'DATAICO');

-- CreateEnum
CREATE TYPE "CertificateCustody" AS ENUM ('SELF', 'PROVIDER');

-- CreateEnum
CREATE TYPE "FiscalCertificateStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED', 'ROTATED');

-- CreateEnum
CREATE TYPE "FiscalWebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'REJECTED');

-- AlterTable
ALTER TABLE "FiscalDocument" ADD COLUMN     "providerTrackId" TEXT,
ADD COLUMN     "providerType" "FiscalProvider";

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "certificateCustody" "CertificateCustody" NOT NULL DEFAULT 'SELF',
ADD COLUMN     "fiscalProvider" "FiscalProvider" NOT NULL DEFAULT 'DIAN_DIRECT';

-- AlterTable
ALTER TABLE "TechProviderConfig" ADD COLUMN     "providerType" "FiscalProvider" NOT NULL DEFAULT 'DIAN_DIRECT',
ADD COLUMN     "webhookSecretReference" TEXT;

-- CreateTable
CREATE TABLE "FiscalCertificate" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "subjectCn" TEXT NOT NULL,
    "issuerCn" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "status" "FiscalCertificateStatus" NOT NULL DEFAULT 'ACTIVE',
    "encryptedBundle" BYTEA NOT NULL,
    "keyEncryptionKeyVersion" TEXT NOT NULL DEFAULT 'v1',
    "issuerConfigId" TEXT,
    "uploadedById" TEXT,
    "activatedAt" TIMESTAMP(3),
    "rotatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalWebhookEvent" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "provider" "FiscalProvider" NOT NULL,
    "providerEventId" TEXT,
    "eventType" TEXT,
    "fiscalDocumentId" TEXT,
    "rawPayload" JSONB NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processingError" TEXT,
    "status" "FiscalWebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',

    CONSTRAINT "FiscalWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FiscalCertificate_subscriptionId_idx" ON "FiscalCertificate"("subscriptionId");

-- CreateIndex
CREATE INDEX "FiscalCertificate_status_validTo_idx" ON "FiscalCertificate"("status", "validTo");

-- CreateIndex
CREATE INDEX "FiscalCertificate_issuerConfigId_idx" ON "FiscalCertificate"("issuerConfigId");

-- CreateIndex
CREATE INDEX "FiscalWebhookEvent_subscriptionId_receivedAt_idx" ON "FiscalWebhookEvent"("subscriptionId", "receivedAt");

-- CreateIndex
CREATE INDEX "FiscalWebhookEvent_status_idx" ON "FiscalWebhookEvent"("status");

-- CreateIndex
CREATE INDEX "FiscalWebhookEvent_fiscalDocumentId_idx" ON "FiscalWebhookEvent"("fiscalDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalWebhookEvent_provider_providerEventId_key" ON "FiscalWebhookEvent"("provider", "providerEventId");

-- CreateIndex
CREATE INDEX "FiscalDocument_providerType_providerTrackId_idx" ON "FiscalDocument"("providerType", "providerTrackId");

-- AddForeignKey
ALTER TABLE "FiscalCertificate" ADD CONSTRAINT "FiscalCertificate_issuerConfigId_fkey" FOREIGN KEY ("issuerConfigId") REFERENCES "FiscalIssuerConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;
