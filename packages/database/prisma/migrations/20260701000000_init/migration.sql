-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RoleType" AS ENUM ('SAAS_ADMIN', 'OWNER', 'MANAGER', 'CASHIER', 'INVENTORY_ASSISTANT', 'ADMIN', 'ACCOUNTANT');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_SETUP', 'ACTIVE', 'DISABLED', 'LOCKED');

-- CreateEnum
CREATE TYPE "AuthMethod" AS ENUM ('PASSWORD_TOTP', 'PASSWORD_ONLY', 'PIN_ONLY', 'OAUTH_GOOGLE');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SessionRevocationReason" AS ENUM ('LOGOUT', 'INACTIVITY', 'ROLE_CHANGE', 'USER_DEACTIVATION', 'ADMIN_REVOCATION', 'PASSWORD_CHANGED', 'TOKEN_EXPIRATION', 'NEW_LOGIN_EVICT', 'SECURITY_ANOMALY', 'STEP_UP_EXPIRY');

-- CreateEnum
CREATE TYPE "StepUpStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TwoFactorMethod" AS ENUM ('TOTP', 'BACKUP_CODE');

-- CreateEnum
CREATE TYPE "PhysicalCountState" AS ENUM ('OPEN', 'COUNTED', 'REVIEWED', 'APPROVED', 'APPLIED', 'ANNULLED');

-- CreateEnum
CREATE TYPE "SupplierIdentificationType" AS ENUM ('NIT', 'CC', 'CE', 'PASSPORT');

-- CreateEnum
CREATE TYPE "PurchaseOrderState" AS ENUM ('DRAFT', 'CONFIRMED', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'ANNULLED');

-- CreateEnum
CREATE TYPE "PurchaseReceptionState" AS ENUM ('DRAFT', 'CONFIRMED', 'ANNULLED');

-- CreateEnum
CREATE TYPE "PurchaseReturnState" AS ENUM ('DRAFT', 'CONFIRMED', 'APPROVED', 'ANNULLED');

-- CreateEnum
CREATE TYPE "FiscalDocumentType" AS ENUM ('INVOICE', 'POS_TICKET', 'CREDIT_NOTE', 'DEBIT_NOTE', 'SUPPORT_DOCUMENT');

-- CreateEnum
CREATE TYPE "FiscalDocumentState" AS ENUM ('PENDING_GENERATION', 'GENERATION_ERROR', 'PENDING_SIGNATURE', 'SIGNATURE_ERROR', 'PENDING_TRANSMISSION', 'IN_TRANSMISSION', 'PENDING_RESPONSE', 'VALIDATED', 'REJECTED', 'CONTINGENCY', 'ANNULLED');

-- CreateEnum
CREATE TYPE "ResolutionState" AS ENUM ('ACTIVE', 'EXPIRING', 'EXHAUSTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ConfigValueType" AS ENUM ('NUMBER', 'BOOLEAN', 'STRING', 'ARRAY', 'OBJECT');

-- CreateEnum
CREATE TYPE "SystemModule" AS ENUM ('AUTH_USERS', 'CASH_SHIFT', 'CATALOG', 'INVENTORY', 'PURCHASES', 'SALES_POS', 'CLIENTS', 'SYNC_OFFLINE', 'FISCAL_DIAN', 'REPORTS', 'CONFIGURATION');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'ACCESS', 'EXPORT', 'LOGIN', 'LOGOUT', 'SECURITY_ALERT', 'STATE_CHANGE');

-- CreateEnum
CREATE TYPE "PricingModel" AS ENUM ('FLAT', 'PER_LOCATION', 'PER_WORKSTATION', 'TIERED');

-- CreateEnum
CREATE TYPE "BillingPeriod" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ActivationCodeType" AS ENUM ('SUBSCRIPTION', 'WORKSTATION');

-- CreateEnum
CREATE TYPE "ActivationCodeStatus" AS ENUM ('UNUSED', 'USED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FraudSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "FraudSignalAction" AS ENUM ('LOG_ONLY', 'FLAG_REVIEW', 'RATE_LIMIT', 'REVOKE');

-- CreateEnum
CREATE TYPE "FraudAlertStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'DISMISSED', 'CONFIRMED_FRAUD');

-- CreateEnum
CREATE TYPE "SaleType" AS ENUM ('FREE_SALE', 'PRESCRIPTION', 'CONTROLLED_SUBSTANCE');

-- CreateEnum
CREATE TYPE "TaxSchemeType" AS ENUM ('IVA', 'INC', 'RETEFUENTE', 'RETEICA', 'IMPOCONSUMO', 'EXENTO');

-- CreateEnum
CREATE TYPE "PaymentMethodCategory" AS ENUM ('CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'BANK_TRANSFER', 'DIGITAL_WALLET', 'CHECK', 'CREDIT', 'OTHER');

-- CreateEnum
CREATE TYPE "BarcodeType" AS ENUM ('EAN13', 'EAN14', 'GTIN', 'INTERNAL', 'DATAMATRIX');

-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('PARTICULAR', 'FREQUENT', 'INSTITUTIONAL');

-- CreateEnum
CREATE TYPE "DataSubjectRequestStatus" AS ENUM ('NONE', 'PENDING_RECTIFICATION', 'PENDING_ERASURE', 'RECTIFIED', 'ERASURED', 'REJECTED');

-- CreateEnum
CREATE TYPE "IdentificationType" AS ENUM ('CC', 'NIT', 'CE', 'PASSPORT', 'TI', 'PEP');

-- CreateEnum
CREATE TYPE "LotState" AS ENUM ('ACTIVE', 'EXHAUSTED', 'EXPIRED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('PURCHASE_RECEIPT', 'SALE', 'POSITIVE_ADJUSTMENT', 'NEGATIVE_ADJUSTMENT', 'CLIENT_RETURN', 'SUPPLIER_RETURN', 'ADMIN_BLOCK', 'ADMIN_UNBLOCK', 'AUTO_EXPIRATION', 'PHYSICAL_COUNT', 'INITIAL_STOCK');

-- CreateEnum
CREATE TYPE "ShiftState" AS ENUM ('OPEN', 'CLOSED', 'FORCED_CLOSE');

-- CreateEnum
CREATE TYPE "CashCountType" AS ENUM ('PARTIAL', 'CLOSING');

-- CreateEnum
CREATE TYPE "SaleOperationalState" AS ENUM ('IN_PROGRESS', 'CONFIRMED', 'ANNULLED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "SyncOperationType" AS ENUM ('SALE_CONFIRMATION', 'SHIFT_CLOSURE', 'CLIENT_CREATION', 'INVENTORY_ADJUSTMENT', 'CLIENT_RETURN', 'FISCAL_DOCUMENT_SYNC', 'PRESCRIPTION_REGISTRATION', 'RESOLUTION_ALLOCATION', 'INVOICE_TRANSMISSION', 'INVOICE_TRANSMISSION_RESULT', 'PRODUCT_CREATION', 'PRODUCT_UPDATE');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'PERMANENT_FAILURE', 'DISCARDED');

-- CreateEnum
CREATE TYPE "ClientReturnState" AS ENUM ('DRAFT', 'PENDING_PICKUP', 'CONFIRMED', 'REJECTED', 'ANNULLED');

-- CreateEnum
CREATE TYPE "RecipeType" AS ENUM ('OFICIAL', 'PARTICULAR', 'INSTITUCIONAL');

-- CreateEnum
CREATE TYPE "AdjustmentState" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'APPLIED', 'ANNULLED');

-- CreateEnum
CREATE TYPE "OfflineBlessingStatus" AS ENUM ('PENDING', 'BLESSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OfflineBlessingRejectionReason" AS ENUM ('USER_DISABLED', 'USER_LOCKED', 'USER_NOT_FOUND', 'WORKSTATION_REVOKED', 'WORKSTATION_NOT_FOUND', 'LOCATION_ACCESS_REVOKED', 'TOKEN_EXPIRED', 'TOKEN_SIGNATURE_INVALID', 'TOKEN_REVOKED', 'FRAUD_DETECTED', 'WORKSTATION_FINGERPRINT_MISMATCH');

-- CreateEnum
CREATE TYPE "OfflineTokenRevocationReason" AS ENUM ('USER_DISABLED', 'USER_LOCKED', 'PASSWORD_CHANGED', 'PIN_CHANGED', 'WORKSTATION_REVOKED', 'ADMIN_REVOCATION', 'FRAUD_DETECTED', 'TOKEN_EXPIRED', 'SESSION_LIMIT_EXCEEDED', 'SECURITY_ANOMALY');

-- CreateEnum
CREATE TYPE "UpdateType" AS ENUM ('CRITICAL', 'MANDATORY', 'OPTIONAL', 'HOTFIX');

-- CreateEnum
CREATE TYPE "UpdateChannel" AS ENUM ('STABLE', 'BETA');

-- CreateEnum
CREATE TYPE "RolloutStrategy" AS ENUM ('PHASED', 'INSTANT');

-- CreateEnum
CREATE TYPE "UpdateVersionState" AS ENUM ('DRAFT', 'ROLLING_OUT', 'PAUSED', 'FULLY_DEPLOYED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "UpdateOutcome" AS ENUM ('CHECK_OK', 'CHECK_NO_UPDATE', 'CHECK_FAILED', 'DOWNLOAD_STARTED', 'DOWNLOAD_COMPLETED', 'DOWNLOAD_FAILED', 'INSTALL_STARTED', 'INSTALL_COMPLETED', 'INSTALL_FAILED', 'MIGRATION_STARTED', 'MIGRATION_COMPLETED', 'MIGRATION_FAILED', 'RESTARTED_OK', 'ROLLED_BACK', 'TELEMETRY_SENT');

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "module" "SystemModule" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityName" TEXT,
    "oldValues" JSONB,
    "newValues" JSONB,
    "details" TEXT,
    "userId" TEXT,
    "userRole" TEXT,
    "workstationId" TEXT,
    "sessionId" TEXT,
    "correlationId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "role" "RoleType" NOT NULL,
    "email" TEXT,
    "username" TEXT,
    "fullName" TEXT NOT NULL,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "avatarColor" TEXT,
    "authMethod" "AuthMethod" NOT NULL DEFAULT 'PASSWORD_ONLY',
    "passwordHash" TEXT,
    "passwordAlgorithm" TEXT,
    "pinHash" TEXT,
    "totpSecretEncrypted" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "backupCodesHash" TEXT,
    "passwordChangedAt" TIMESTAMP(3),
    "lastPasswordChangeAt" TIMESTAMP(3),
    "passwordMustChangeNextLogin" BOOLEAN NOT NULL DEFAULT false,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_SETUP',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "emailVerifiedAt" TIMESTAMP(3),
    "phoneVerifiedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "lastLoginWorkstationId" TEXT,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workstationId" TEXT NOT NULL,
    "workstationFingerprint" TEXT,
    "deviceInfo" TEXT,
    "tokenHash" TEXT NOT NULL,
    "refreshTokenHash" TEXT,
    "accessTokenId" TEXT,
    "refreshTokenId" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "revokedAt" TIMESTAMP(3),
    "revokedReason" "SessionRevocationReason",
    "revokedByUserId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "geoCountry" TEXT,
    "geoCity" TEXT,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workstation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "macAddress" TEXT,
    "serialNumber" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "registeredAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workstation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserLocationAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserLocationAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepUpRequest" (
    "id" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "operationId" TEXT,
    "requestingUserId" TEXT NOT NULL,
    "workstationId" TEXT NOT NULL,
    "requiredRole" "RoleType" NOT NULL,
    "status" "StepUpStatus" NOT NULL DEFAULT 'PENDING',
    "method" TEXT,
    "approvedByUserId" TEXT,
    "deniedByUserId" TEXT,
    "denialReason" TEXT,
    "approvalToken" TEXT,
    "oneTimeCode" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StepUpRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "identifier" TEXT NOT NULL,
    "sessionType" TEXT NOT NULL,
    "workstationId" TEXT,
    "ipAddress" TEXT,
    "success" BOOLEAN NOT NULL,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutoExpirationJob" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "lotsAffected" INTEGER,
    "triggeredBy" TEXT NOT NULL,
    "triggeredByUserId" TEXT,
    "notes" TEXT,

    CONSTRAINT "AutoExpirationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashShift" (
    "id" TEXT NOT NULL,
    "workstationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "state" "ShiftState" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedByUserId" TEXT,
    "openingBalance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "openingNotes" TEXT,
    "expectedClosingAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "actualClosingAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "closingDifference" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "closingNotes" TEXT,
    "forcedClose" BOOLEAN NOT NULL DEFAULT false,
    "hasExtendedAlert" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmaceuticalForm" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PharmaceuticalForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientReturn" (
    "id" TEXT NOT NULL,
    "sequentialNumber" INTEGER NOT NULL,
    "state" "ClientReturnState" NOT NULL DEFAULT 'DRAFT',
    "saleId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "refundAmount" DECIMAL(15,2) NOT NULL,
    "subtotalReturned" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "taxReturned" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "refundMethodId" TEXT NOT NULL,
    "reason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "annulledAt" TIMESTAMP(3),
    "annulledById" TEXT,
    "annulmentReason" TEXT,
    "cashShiftId" TEXT NOT NULL,
    "workstationId" TEXT NOT NULL,
    "creditNoteId" TEXT,

    CONSTRAINT "ClientReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientReturnItem" (
    "id" TEXT NOT NULL,
    "clientReturnId" TEXT NOT NULL,
    "saleItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceAtSale" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "unitPriceAtReturn" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,

    CONSTRAINT "ClientReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientReturnItemLot" (
    "id" TEXT NOT NULL,
    "clientReturnItemId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "ClientReturnItemLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientClassification" (
    "id" TEXT NOT NULL,
    "type" "ClientType" NOT NULL,
    "discountPercentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientClassification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "identificationType" "IdentificationType" NOT NULL,
    "identificationNumber" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "municipality" TEXT,
    "department" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "classificationId" TEXT,
    "consentGivenAt" TIMESTAMP(3),
    "consentVersion" TEXT,
    "consentScope" JSONB,
    "dataSubjectRequestStatus" "DataSubjectRequestStatus" NOT NULL DEFAULT 'NONE',
    "dataSubjectRequestAt" TIMESTAMP(3),

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalIssuerConfig" (
    "id" TEXT NOT NULL,
    "nit" TEXT NOT NULL,
    "verificationDigit" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "commercialName" TEXT,
    "organizationType" TEXT NOT NULL,
    "taxRegime" TEXT NOT NULL,
    "taxResponsibilities" TEXT,
    "address" TEXT NOT NULL,
    "municipality" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "postalCode" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "logoUrl" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "FiscalIssuerConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechProviderConfig" (
    "id" TEXT NOT NULL,
    "endpointUrl" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "timeoutSeconds" INTEGER NOT NULL DEFAULT 30,
    "credentialReference" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "TechProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalDocument" (
    "id" TEXT NOT NULL,
    "documentType" "FiscalDocumentType" NOT NULL,
    "consecutiveNumber" INTEGER NOT NULL,
    "fullNumber" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "cufeCude" TEXT NOT NULL,
    "cufeCudeAlgorithm" TEXT NOT NULL DEFAULT 'SHA-384',
    "xmlPayload" TEXT,
    "signedXml" TEXT,
    "xmlHash" TEXT,
    "fiscalState" "FiscalDocumentState" NOT NULL DEFAULT 'PENDING_GENERATION',
    "ptResponseCode" TEXT,
    "ptResponseMessage" TEXT,
    "lastRetryAt" TIMESTAMP(3),
    "contingencyReason" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalTax" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "issuerNitSnapshot" TEXT NOT NULL,
    "receiverNitSnapshot" TEXT,
    "receiverNameSnapshot" TEXT,
    "receiverType" TEXT,
    "saleId" TEXT,
    "purchaseReceptionId" TEXT,
    "clientReturnId" TEXT,
    "resolutionId" TEXT NOT NULL,
    "allocationId" TEXT,
    "referenceDocumentId" TEXT,
    "validUntil" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "xmlStorageKey" TEXT,
    "xmlStorageBackend" TEXT,
    "retentionExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalResolution" (
    "id" TEXT NOT NULL,
    "resolutionNumber" TEXT NOT NULL,
    "documentType" "FiscalDocumentType" NOT NULL,
    "prefix" TEXT NOT NULL,
    "rangeFrom" INTEGER NOT NULL,
    "rangeTo" INTEGER NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "state" "ResolutionState" NOT NULL DEFAULT 'ACTIVE',
    "currentConsecutive" INTEGER NOT NULL DEFAULT 0,
    "workstationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalResolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalResolutionAllocation" (
    "id" TEXT NOT NULL,
    "resolutionId" TEXT NOT NULL,
    "workstationId" TEXT NOT NULL,
    "rangeFrom" INTEGER NOT NULL,
    "rangeTo" INTEGER NOT NULL,
    "currentConsecutive" INTEGER NOT NULL DEFAULT 0,
    "allocatedAt" TIMESTAMP(3) NOT NULL,
    "allocatedByUserId" TEXT NOT NULL,
    "exhaustedAt" TIMESTAMP(3),

    CONSTRAINT "FiscalResolutionAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryAdjustmentDocument" (
    "id" TEXT NOT NULL,
    "sequentialNumber" INTEGER NOT NULL,
    "state" "AdjustmentState" NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "submittedForApprovalAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "approvalNotes" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedByUserId" TEXT,
    "rejectionReason" TEXT,
    "appliedAt" TIMESTAMP(3),
    "annulledAt" TIMESTAMP(3),
    "annulledByUserId" TEXT,
    "annulmentReason" TEXT,
    "physicalCountId" TEXT,

    CONSTRAINT "InventoryAdjustmentDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryAdjustmentCounter" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "lastSequentialNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InventoryAdjustmentCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "movementType" "MovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "previousStock" INTEGER NOT NULL,
    "resultingStock" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "lotId" TEXT NOT NULL,
    "adjustmentDocumentId" TEXT,
    "autoExpirationJobId" TEXT,
    "reason" TEXT,
    "approvedByUserId" TEXT,
    "purchaseReceptionId" TEXT,
    "saleId" TEXT,
    "supplierReturnId" TEXT,
    "clientReturnId" TEXT,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pricingModel" "PricingModel" NOT NULL,
    "basePriceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'COP',
    "billingPeriod" "BillingPeriod" NOT NULL DEFAULT 'MONTHLY',
    "maxLocations" INTEGER NOT NULL DEFAULT 1,
    "maxWorkstationsPerLocation" INTEGER NOT NULL DEFAULT 1,
    "includedWorkstations" INTEGER NOT NULL DEFAULT 1,
    "extraWorkstationPriceCents" INTEGER,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerTaxId" TEXT NOT NULL,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "customerAddress" TEXT,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "trialEndsAt" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "paymentMethod" TEXT,
    "paymentReference" TEXT,
    "lastPaymentAt" TIMESTAMP(3),
    "nextPaymentDueAt" TIMESTAMP(3),
    "gracePeriodDays" INTEGER NOT NULL DEFAULT 7,
    "offlineGracePeriodDays" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "region" TEXT,
    "country" TEXT NOT NULL DEFAULT 'CO',
    "taxId" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivationCode" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "locationId" TEXT,
    "code" TEXT NOT NULL,
    "type" "ActivationCodeType" NOT NULL,
    "status" "ActivationCodeStatus" NOT NULL DEFAULT 'UNUSED',
    "usedAt" TIMESTAMP(3),
    "usedByActivationId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivationCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkstationActivation" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "hardwareFingerprint" TEXT NOT NULL,
    "workstationName" TEXT NOT NULL,
    "activationCodeId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "lastCheckInAt" TIMESTAMP(3),
    "lastCheckInIp" TEXT,
    "initialActivationIp" TEXT,
    "checkInCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkstationActivation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LicenseCheckIn" (
    "id" TEXT NOT NULL,
    "workstationActivationId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "hardwareFingerprint" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LicenseCheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudAlert" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "workstationActivationId" TEXT,
    "severity" "FraudSeverity" NOT NULL,
    "suggestedAction" "FraudSignalAction" NOT NULL,
    "status" "FraudAlertStatus" NOT NULL DEFAULT 'OPEN',
    "detectorName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" JSONB,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolutionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FraudAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPaymentHistory" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'COP',
    "paymentMethod" TEXT,
    "paymentReference" TEXT,
    "notes" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionPaymentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lot" (
    "id" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "expirationDate" TIMESTAMP(3) NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "state" "LotState" NOT NULL DEFAULT 'ACTIVE',
    "currentStock" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "productId" TEXT NOT NULL,
    "locationCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "blockedAt" TIMESTAMP(3),
    "blockedByUserId" TEXT,
    "blockReason" TEXT,

    CONSTRAINT "Lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfflineSessionBlessing" (
    "id" TEXT NOT NULL,
    "localSessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "workstationId" TEXT NOT NULL,
    "offlineTokenJwt" TEXT NOT NULL,
    "workstationFingerprint" TEXT NOT NULL,
    "status" "OfflineBlessingStatus" NOT NULL DEFAULT 'PENDING',
    "rejectedReason" "OfflineBlessingRejectionReason",
    "rejectedReasonDetail" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "offlineToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blessedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),

    CONSTRAINT "OfflineSessionBlessing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfflineTokenRevocation" (
    "id" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "userId" TEXT,
    "workstationId" TEXT,
    "reason" "OfflineTokenRevocationReason" NOT NULL,
    "reasonDetail" TEXT,
    "revokedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfflineTokenRevocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" TEXT NOT NULL,
    "internalCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dianCode" TEXT,
    "category" "PaymentMethodCategory" NOT NULL,
    "isCash" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhysicalCount" (
    "id" TEXT NOT NULL,
    "sequentialNumber" INTEGER NOT NULL,
    "state" "PhysicalCountState" NOT NULL DEFAULT 'OPEN',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "startedByUserId" TEXT NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "appliedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhysicalCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" TEXT NOT NULL,
    "saleItemId" TEXT NOT NULL,
    "prescriptionNumber" TEXT,
    "prescriberIdType" "IdentificationType",
    "prescriberIdNumber" TEXT,
    "prescriberName" TEXT,
    "prescriberSpecialty" TEXT,
    "prescriptionDate" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "patientFullName" TEXT,
    "patientIdType" "IdentificationType",
    "patientIdNumber" TEXT,
    "fileUrl" TEXT,
    "fileHash" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "isControlledSubstance" BOOLEAN NOT NULL DEFAULT false,
    "controlledSubstanceBookEntry" TEXT,
    "controlledSubstanceBookPage" TEXT,
    "recipeType" "RecipeType",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductBarcode" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "barcodeType" "BarcodeType" NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductBarcode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductPriceHistory" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "previousPriceHistoryId" TEXT,
    "price" DECIMAL(15,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL,
    "changeReason" TEXT,

    CONSTRAINT "ProductPriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductTaxHistory" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "previousTaxHistoryId" TEXT,
    "taxSchemeId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL,
    "changeReason" TEXT,

    CONSTRAINT "ProductTaxHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "internalCode" TEXT NOT NULL,
    "commercialName" TEXT NOT NULL,
    "genericName" TEXT NOT NULL,
    "activePrinciple" TEXT NOT NULL,
    "concentration" TEXT,
    "concentrationUnit" TEXT,
    "laboratory" TEXT NOT NULL,
    "saleType" "SaleType" NOT NULL,
    "minimumStock" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "discontinuationReason" TEXT,
    "invimaRegistry" TEXT,
    "atcCode" TEXT,
    "therapeuticIndication" TEXT,
    "storageConditions" TEXT,
    "internalNotes" TEXT,
    "categoryId" TEXT,
    "pharmaceuticalFormId" TEXT,
    "currentPriceId" TEXT,
    "currentTaxHistoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "sequentialNumber" INTEGER NOT NULL,
    "state" "PurchaseOrderState" NOT NULL DEFAULT 'DRAFT',
    "expectedDeliveryDate" TIMESTAMP(3),
    "subtotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalTax" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "annulledAt" TIMESTAMP(3),
    "annulledById" TEXT,
    "annulmentReason" TEXT,
    "supplierId" TEXT NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "requestedQuantity" INTEGER NOT NULL DEFAULT 0,
    "receivedQuantity" INTEGER NOT NULL DEFAULT 0,
    "pendingQuantity" INTEGER NOT NULL DEFAULT 0,
    "expectedUnitCost" DECIMAL(15,2) NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseReception" (
    "id" TEXT NOT NULL,
    "sequentialNumber" INTEGER NOT NULL,
    "state" "PurchaseReceptionState" NOT NULL DEFAULT 'DRAFT',
    "receivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "subtotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalTax" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "annulledAt" TIMESTAMP(3),
    "annulledById" TEXT,
    "annulmentReason" TEXT,
    "supplierId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,

    CONSTRAINT "PurchaseReception_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseReceptionItem" (
    "id" TEXT NOT NULL,
    "purchaseReceptionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT,
    "lotId" TEXT,
    "receivedQuantity" INTEGER NOT NULL,
    "lotNumber" TEXT,
    "expirationDate" TIMESTAMP(3),
    "realUnitCost" DECIMAL(15,2) NOT NULL,
    "taxSchemeId" TEXT NOT NULL,
    "taxRate" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(15,2) NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseReceptionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleItemLot" (
    "id" TEXT NOT NULL,
    "saleItemId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCostAtSale" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "SaleItemLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleItem" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productInternalCodeSnapshot" TEXT NOT NULL,
    "productCommercialNameSnapshot" TEXT NOT NULL,
    "productGenericNameSnapshot" TEXT NOT NULL,
    "productConcentrationSnapshot" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(15,2) NOT NULL,
    "unitCost" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(6,4) NOT NULL,
    "taxAmount" DECIMAL(15,2) NOT NULL,
    "discountPercentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "discountReason" TEXT,
    "subtotal" DECIMAL(15,2) NOT NULL,
    "total" DECIMAL(15,2) NOT NULL,
    "requiresPrescription" BOOLEAN NOT NULL DEFAULT false,
    "saleItemPrescriptionId" TEXT,

    CONSTRAINT "SaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalePayment" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "paymentMethodId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "transactionReference" TEXT,
    "authorizationCode" TEXT,
    "cardBrand" TEXT,
    "cardLastFour" TEXT,
    "batchNumber" TEXT,
    "processorResponseCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "localNumber" BIGINT NOT NULL,
    "internalNumber" INTEGER,
    "operationalState" "SaleOperationalState" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "annulledAt" TIMESTAMP(3),
    "lastModifiedAt" TIMESTAMP(3) NOT NULL,
    "clientIdentificationTypeSnapshot" "IdentificationType",
    "clientIdentificationNumberSnapshot" TEXT,
    "clientNameSnapshot" TEXT,
    "clientId" TEXT,
    "clientClassificationIdSnapshot" TEXT,
    "clientTypeSnapshot" "ClientType",
    "subtotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalDiscount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalTax" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "changeAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "annulledById" TEXT,
    "annulmentReason" TEXT,
    "annulmentNotes" TEXT,
    "cashShiftId" TEXT NOT NULL,
    "workstationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceWorkstationId" TEXT NOT NULL,
    "sourceCreatedAt" TIMESTAMP(3),

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftCashCount" (
    "id" TEXT NOT NULL,
    "cashShiftId" TEXT NOT NULL,
    "countType" "CashCountType" NOT NULL,
    "paymentMethodId" TEXT NOT NULL,
    "paymentMethodIsCash" BOOLEAN NOT NULL DEFAULT false,
    "expectedAmount" DECIMAL(15,2) NOT NULL,
    "declaredAmount" DECIMAL(15,2) NOT NULL,
    "difference" DECIMAL(15,2) NOT NULL,
    "denominationsBreakdown" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "ShiftCashCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierReturn" (
    "id" TEXT NOT NULL,
    "sequentialNumber" INTEGER NOT NULL,
    "state" "PurchaseReturnState" NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT,
    "notes" TEXT,
    "subtotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalTax" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "annulledAt" TIMESTAMP(3),
    "annulledById" TEXT,
    "annulmentReason" TEXT,
    "supplierId" TEXT NOT NULL,
    "purchaseReceptionId" TEXT,

    CONSTRAINT "SupplierReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierReturnItem" (
    "id" TEXT NOT NULL,
    "supplierReturnId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,

    CONSTRAINT "SupplierReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "identificationType" "SupplierIdentificationType" NOT NULL,
    "identificationNumber" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT NOT NULL DEFAULT 'CO',
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 0,
    "creditLimit" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncInvoiceResult" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "workstationId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "cufeOfficial" TEXT,
    "dianXml" TEXT,
    "rejectionReason" TEXT,
    "authorizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncInvoiceResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncOperationOutcome" (
    "id" TEXT NOT NULL,
    "operationUuid" TEXT NOT NULL,
    "workstationId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "failureCategory" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncOperationOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncQueue" (
    "id" TEXT NOT NULL,
    "operationUuid" TEXT NOT NULL,
    "operationType" "SyncOperationType" NOT NULL,
    "payload" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "payloadSize" INTEGER NOT NULL,
    "versionSchema" INTEGER NOT NULL DEFAULT 1,
    "status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastErrorMessage" TEXT,
    "nextRetryAt" TIMESTAMP(3),
    "sourceWorkstationId" TEXT NOT NULL,
    "sourceCreatedAt" TIMESTAMP(3) NOT NULL,
    "clientSequence" BIGINT NOT NULL,
    "receivedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "correlationId" TEXT,
    "workstationId" TEXT,

    CONSTRAINT "SyncQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemConfig" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "valueType" "ConfigValueType" NOT NULL,
    "module" "SystemModule" NOT NULL,
    "description" TEXT,
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "TaxScheme" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxType" "TaxSchemeType" NOT NULL,
    "rate" DECIMAL(6,4) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "TaxScheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantConfig" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "activePresetCode" TEXT,
    "strictness" JSONB NOT NULL,
    "fiscal" JSONB NOT NULL,
    "workflow" JSONB NOT NULL,
    "customCompanyFields" JSONB NOT NULL DEFAULT '[]',
    "customStrictnessToggles" JSONB NOT NULL DEFAULT '[]',
    "configVersion" INTEGER NOT NULL DEFAULT 1,
    "lastModifiedById" TEXT,
    "lastModifiedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NamedPreset" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "strictness" JSONB NOT NULL,
    "fiscal" JSONB NOT NULL,
    "workflow" JSONB NOT NULL,
    "customCompanyFields" JSONB NOT NULL DEFAULT '[]',
    "customStrictnessToggles" JSONB NOT NULL DEFAULT '[]',
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NamedPreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfigChangelog" (
    "id" TEXT NOT NULL,
    "tenantConfigId" TEXT NOT NULL,
    "configVersion" INTEGER NOT NULL,
    "changeType" TEXT NOT NULL,
    "fieldPath" TEXT,
    "beforeValue" JSONB,
    "afterValue" JSONB,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfigChangelog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpdateVersion" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "channel" "UpdateChannel" NOT NULL DEFAULT 'STABLE',
    "downloadUrl" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "fileHash" TEXT NOT NULL,
    "releaseNotes" TEXT NOT NULL,
    "releaseDate" TIMESTAMP(3) NOT NULL,
    "updateType" "UpdateType" NOT NULL,
    "state" "UpdateVersionState" NOT NULL DEFAULT 'DRAFT',
    "mandatoryFrom" TIMESTAMP(3),
    "rolloutStrategy" "RolloutStrategy" NOT NULL DEFAULT 'PHASED',
    "rolloutStartDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rolloutSchedule" JSONB NOT NULL DEFAULT '[{"percent":5,"afterDays":0},{"percent":25,"afterDays":3},{"percent":50,"afterDays":7},{"percent":100,"afterDays":14}]',
    "minAppVersion" TEXT,
    "maxAppVersion" TEXT,
    "requiredPlanFeatures" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minPlan" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "isPaused" BOOLEAN NOT NULL DEFAULT false,
    "pausedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpdateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpdateAttemptLog" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "workstationId" TEXT NOT NULL,
    "licenseId" TEXT NOT NULL,
    "fromVersion" TEXT NOT NULL,
    "toVersion" TEXT,
    "outcome" "UpdateOutcome" NOT NULL,
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UpdateAttemptLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpdateChannelConfig" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "channel" "UpdateChannel" NOT NULL DEFAULT 'STABLE',
    "optedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "optedInByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpdateChannelConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_module_idx" ON "AuditLog"("createdAt", "module");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_correlationId_idx" ON "AuditLog"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_subscriptionId_username_idx" ON "User"("subscriptionId", "username");

-- CreateIndex
CREATE INDEX "User_subscriptionId_role_idx" ON "User"("subscriptionId", "role");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_tokenHash_key" ON "UserSession"("tokenHash");

-- CreateIndex
CREATE INDEX "UserSession_userId_status_idx" ON "UserSession"("userId", "status");

-- CreateIndex
CREATE INDEX "UserSession_expiresAt_idx" ON "UserSession"("expiresAt");

-- CreateIndex
CREATE INDEX "UserSession_tokenHash_idx" ON "UserSession"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Workstation_name_key" ON "Workstation"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Workstation_code_key" ON "Workstation"("code");

-- CreateIndex
CREATE INDEX "UserLocationAccess_locationId_idx" ON "UserLocationAccess"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "UserLocationAccess_userId_locationId_key" ON "UserLocationAccess"("userId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "StepUpRequest_approvalToken_key" ON "StepUpRequest"("approvalToken");

-- CreateIndex
CREATE INDEX "StepUpRequest_requestingUserId_status_idx" ON "StepUpRequest"("requestingUserId", "status");

-- CreateIndex
CREATE INDEX "StepUpRequest_workstationId_status_idx" ON "StepUpRequest"("workstationId", "status");

-- CreateIndex
CREATE INDEX "StepUpRequest_status_expiresAt_idx" ON "StepUpRequest"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_userId_createdAt_idx" ON "LoginAttempt"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_identifier_createdAt_idx" ON "LoginAttempt"("identifier", "createdAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_createdAt_idx" ON "LoginAttempt"("createdAt");

-- CreateIndex
CREATE INDEX "CashShift_workstationId_state_idx" ON "CashShift"("workstationId", "state");

-- CreateIndex
CREATE INDEX "CashShift_userId_state_idx" ON "CashShift"("userId", "state");

-- CreateIndex
CREATE INDEX "CashShift_closedAt_idx" ON "CashShift"("closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PharmaceuticalForm_name_key" ON "PharmaceuticalForm"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ClientReturn_sequentialNumber_key" ON "ClientReturn"("sequentialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ClientReturn_creditNoteId_key" ON "ClientReturn"("creditNoteId");

-- CreateIndex
CREATE INDEX "ClientReturn_saleId_idx" ON "ClientReturn"("saleId");

-- CreateIndex
CREATE INDEX "ClientReturn_cashShiftId_idx" ON "ClientReturn"("cashShiftId");

-- CreateIndex
CREATE INDEX "ClientReturn_state_idx" ON "ClientReturn"("state");

-- CreateIndex
CREATE INDEX "ClientReturn_creditNoteId_idx" ON "ClientReturn"("creditNoteId");

-- CreateIndex
CREATE INDEX "ClientReturnItem_clientReturnId_idx" ON "ClientReturnItem"("clientReturnId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientClassification_type_key" ON "ClientClassification"("type");

-- CreateIndex
CREATE INDEX "Client_fullName_idx" ON "Client"("fullName");

-- CreateIndex
CREATE INDEX "Client_classificationId_idx" ON "Client"("classificationId");

-- CreateIndex
CREATE INDEX "Client_municipality_idx" ON "Client"("municipality");

-- CreateIndex
CREATE UNIQUE INDEX "Client_identificationType_identificationNumber_key" ON "Client"("identificationType", "identificationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalIssuerConfig_nit_key" ON "FiscalIssuerConfig"("nit");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalDocument_fullNumber_key" ON "FiscalDocument"("fullNumber");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalDocument_cufeCude_key" ON "FiscalDocument"("cufeCude");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalDocument_clientReturnId_key" ON "FiscalDocument"("clientReturnId");

-- CreateIndex
CREATE INDEX "FiscalDocument_fiscalState_idx" ON "FiscalDocument"("fiscalState");

-- CreateIndex
CREATE INDEX "FiscalDocument_fiscalState_lastRetryAt_idx" ON "FiscalDocument"("fiscalState", "lastRetryAt");

-- CreateIndex
CREATE INDEX "FiscalDocument_saleId_idx" ON "FiscalDocument"("saleId");

-- CreateIndex
CREATE INDEX "FiscalDocument_purchaseReceptionId_idx" ON "FiscalDocument"("purchaseReceptionId");

-- CreateIndex
CREATE INDEX "FiscalDocument_clientReturnId_idx" ON "FiscalDocument"("clientReturnId");

-- CreateIndex
CREATE INDEX "FiscalDocument_issueDate_idx" ON "FiscalDocument"("issueDate");

-- CreateIndex
CREATE INDEX "FiscalDocument_archivedAt_idx" ON "FiscalDocument"("archivedAt");

-- CreateIndex
CREATE INDEX "FiscalDocument_retentionExpiresAt_idx" ON "FiscalDocument"("retentionExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalDocument_consecutiveNumber_resolutionId_key" ON "FiscalDocument"("consecutiveNumber", "resolutionId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalResolution_resolutionNumber_key" ON "FiscalResolution"("resolutionNumber");

-- CreateIndex
CREATE INDEX "FiscalResolution_documentType_prefix_idx" ON "FiscalResolution"("documentType", "prefix");

-- CreateIndex
CREATE INDEX "FiscalResolution_workstationId_documentType_state_idx" ON "FiscalResolution"("workstationId", "documentType", "state");

-- CreateIndex
CREATE INDEX "FiscalResolutionAllocation_workstationId_resolutionId_idx" ON "FiscalResolutionAllocation"("workstationId", "resolutionId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryAdjustmentDocument_sequentialNumber_key" ON "InventoryAdjustmentDocument"("sequentialNumber");

-- CreateIndex
CREATE INDEX "InventoryMovement_lotId_idx" ON "InventoryMovement"("lotId");

-- CreateIndex
CREATE INDEX "InventoryMovement_lotId_createdAt_idx" ON "InventoryMovement"("lotId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_createdAt_idx" ON "InventoryMovement"("createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_movementType_createdAt_idx" ON "InventoryMovement"("movementType", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_adjustmentDocumentId_idx" ON "InventoryMovement"("adjustmentDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");

-- CreateIndex
CREATE INDEX "Plan_isActive_isPublic_idx" ON "Plan"("isActive", "isPublic");

-- CreateIndex
CREATE INDEX "Plan_displayOrder_idx" ON "Plan"("displayOrder");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

-- CreateIndex
CREATE INDEX "Subscription_customerTaxId_idx" ON "Subscription"("customerTaxId");

-- CreateIndex
CREATE INDEX "Subscription_customerEmail_idx" ON "Subscription"("customerEmail");

-- CreateIndex
CREATE INDEX "Subscription_planId_idx" ON "Subscription"("planId");

-- CreateIndex
CREATE INDEX "Location_subscriptionId_idx" ON "Location"("subscriptionId");

-- CreateIndex
CREATE INDEX "Location_subscriptionId_isActive_idx" ON "Location"("subscriptionId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ActivationCode_code_key" ON "ActivationCode"("code");

-- CreateIndex
CREATE INDEX "ActivationCode_subscriptionId_idx" ON "ActivationCode"("subscriptionId");

-- CreateIndex
CREATE INDEX "ActivationCode_code_status_idx" ON "ActivationCode"("code", "status");

-- CreateIndex
CREATE INDEX "ActivationCode_type_status_idx" ON "ActivationCode"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkstationActivation_activationCodeId_key" ON "WorkstationActivation"("activationCodeId");

-- CreateIndex
CREATE INDEX "WorkstationActivation_subscriptionId_idx" ON "WorkstationActivation"("subscriptionId");

-- CreateIndex
CREATE INDEX "WorkstationActivation_locationId_idx" ON "WorkstationActivation"("locationId");

-- CreateIndex
CREATE INDEX "WorkstationActivation_hardwareFingerprint_idx" ON "WorkstationActivation"("hardwareFingerprint");

-- CreateIndex
CREATE INDEX "WorkstationActivation_hardwareFingerprint_isActive_idx" ON "WorkstationActivation"("hardwareFingerprint", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "WorkstationActivation_subscriptionId_hardwareFingerprint_key" ON "WorkstationActivation"("subscriptionId", "hardwareFingerprint");

-- CreateIndex
CREATE INDEX "LicenseCheckIn_workstationActivationId_checkedInAt_idx" ON "LicenseCheckIn"("workstationActivationId", "checkedInAt");

-- CreateIndex
CREATE INDEX "LicenseCheckIn_subscriptionId_checkedInAt_idx" ON "LicenseCheckIn"("subscriptionId", "checkedInAt");

-- CreateIndex
CREATE INDEX "LicenseCheckIn_checkedInAt_idx" ON "LicenseCheckIn"("checkedInAt");

-- CreateIndex
CREATE INDEX "FraudAlert_subscriptionId_idx" ON "FraudAlert"("subscriptionId");

-- CreateIndex
CREATE INDEX "FraudAlert_status_severity_idx" ON "FraudAlert"("status", "severity");

-- CreateIndex
CREATE INDEX "FraudAlert_detectedAt_idx" ON "FraudAlert"("detectedAt");

-- CreateIndex
CREATE INDEX "SubscriptionPaymentHistory_subscriptionId_idx" ON "SubscriptionPaymentHistory"("subscriptionId");

-- CreateIndex
CREATE INDEX "Lot_productId_idx" ON "Lot"("productId");

-- CreateIndex
CREATE INDEX "Lot_productId_state_idx" ON "Lot"("productId", "state");

-- CreateIndex
CREATE INDEX "Lot_expirationDate_idx" ON "Lot"("expirationDate");

-- CreateIndex
CREATE INDEX "OfflineSessionBlessing_userId_status_idx" ON "OfflineSessionBlessing"("userId", "status");

-- CreateIndex
CREATE INDEX "OfflineSessionBlessing_workstationId_status_idx" ON "OfflineSessionBlessing"("workstationId", "status");

-- CreateIndex
CREATE INDEX "OfflineSessionBlessing_localSessionId_idx" ON "OfflineSessionBlessing"("localSessionId");

-- CreateIndex
CREATE INDEX "OfflineSessionBlessing_createdAt_idx" ON "OfflineSessionBlessing"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OfflineTokenRevocation_jti_key" ON "OfflineTokenRevocation"("jti");

-- CreateIndex
CREATE INDEX "OfflineTokenRevocation_revokedAt_idx" ON "OfflineTokenRevocation"("revokedAt");

-- CreateIndex
CREATE INDEX "OfflineTokenRevocation_userId_idx" ON "OfflineTokenRevocation"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethod_internalCode_key" ON "PaymentMethod"("internalCode");

-- CreateIndex
CREATE UNIQUE INDEX "PhysicalCount_sequentialNumber_key" ON "PhysicalCount"("sequentialNumber");

-- CreateIndex
CREATE INDEX "PhysicalCount_state_idx" ON "PhysicalCount"("state");

-- CreateIndex
CREATE INDEX "PhysicalCount_startedAt_idx" ON "PhysicalCount"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Prescription_saleItemId_key" ON "Prescription"("saleItemId");

-- CreateIndex
CREATE INDEX "Prescription_prescriberIdNumber_idx" ON "Prescription"("prescriberIdNumber");

-- CreateIndex
CREATE INDEX "Prescription_prescriptionNumber_idx" ON "Prescription"("prescriptionNumber");

-- CreateIndex
CREATE INDEX "Prescription_isControlledSubstance_idx" ON "Prescription"("isControlledSubstance");

-- CreateIndex
CREATE UNIQUE INDEX "ProductBarcode_barcode_key" ON "ProductBarcode"("barcode");

-- CreateIndex
CREATE INDEX "ProductBarcode_productId_idx" ON "ProductBarcode"("productId");

-- CreateIndex
CREATE INDEX "ProductPriceHistory_productId_idx" ON "ProductPriceHistory"("productId");

-- CreateIndex
CREATE INDEX "ProductPriceHistory_productId_effectiveFrom_idx" ON "ProductPriceHistory"("productId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ProductTaxHistory_productId_idx" ON "ProductTaxHistory"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_internalCode_key" ON "Product"("internalCode");

-- CreateIndex
CREATE INDEX "Product_commercialName_idx" ON "Product"("commercialName");

-- CreateIndex
CREATE INDEX "Product_genericName_idx" ON "Product"("genericName");

-- CreateIndex
CREATE INDEX "Product_activePrinciple_idx" ON "Product"("activePrinciple");

-- CreateIndex
CREATE INDEX "Product_isActive_idx" ON "Product"("isActive");

-- CreateIndex
CREATE INDEX "Product_categoryId_isActive_idx" ON "Product"("categoryId", "isActive");

-- CreateIndex
CREATE INDEX "Product_invimaRegistry_idx" ON "Product"("invimaRegistry");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_sequentialNumber_key" ON "PurchaseOrder"("sequentialNumber");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_state_idx" ON "PurchaseOrder"("supplierId", "state");

-- CreateIndex
CREATE INDEX "PurchaseOrder_state_idx" ON "PurchaseOrder"("state");

-- CreateIndex
CREATE INDEX "PurchaseOrder_createdAt_idx" ON "PurchaseOrder"("createdAt");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_purchaseOrderId_productId_idx" ON "PurchaseOrderItem"("purchaseOrderId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReception_sequentialNumber_key" ON "PurchaseReception"("sequentialNumber");

-- CreateIndex
CREATE INDEX "PurchaseReception_supplierId_receivedAt_idx" ON "PurchaseReception"("supplierId", "receivedAt");

-- CreateIndex
CREATE INDEX "PurchaseReception_receivedAt_idx" ON "PurchaseReception"("receivedAt");

-- CreateIndex
CREATE INDEX "PurchaseReception_state_idx" ON "PurchaseReception"("state");

-- CreateIndex
CREATE INDEX "PurchaseReceptionItem_purchaseReceptionId_productId_idx" ON "PurchaseReceptionItem"("purchaseReceptionId", "productId");

-- CreateIndex
CREATE INDEX "SaleItemLot_saleItemId_idx" ON "SaleItemLot"("saleItemId");

-- CreateIndex
CREATE INDEX "SaleItemLot_lotId_idx" ON "SaleItemLot"("lotId");

-- CreateIndex
CREATE INDEX "SaleItem_saleId_idx" ON "SaleItem"("saleId");

-- CreateIndex
CREATE INDEX "SaleItem_productId_idx" ON "SaleItem"("productId");

-- CreateIndex
CREATE INDEX "SalePayment_saleId_idx" ON "SalePayment"("saleId");

-- CreateIndex
CREATE INDEX "SalePayment_paymentMethodId_idx" ON "SalePayment"("paymentMethodId");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_internalNumber_key" ON "Sale"("internalNumber");

-- CreateIndex
CREATE INDEX "Sale_cashShiftId_operationalState_idx" ON "Sale"("cashShiftId", "operationalState");

-- CreateIndex
CREATE INDEX "Sale_workstationId_confirmedAt_idx" ON "Sale"("workstationId", "confirmedAt");

-- CreateIndex
CREATE INDEX "Sale_confirmedAt_idx" ON "Sale"("confirmedAt");

-- CreateIndex
CREATE INDEX "Sale_operationalState_confirmedAt_idx" ON "Sale"("operationalState", "confirmedAt");

-- CreateIndex
CREATE INDEX "Sale_clientId_confirmedAt_idx" ON "Sale"("clientId", "confirmedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_localNumber_sourceWorkstationId_key" ON "Sale"("localNumber", "sourceWorkstationId");

-- CreateIndex
CREATE INDEX "ShiftCashCount_cashShiftId_countType_idx" ON "ShiftCashCount"("cashShiftId", "countType");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierReturn_sequentialNumber_key" ON "SupplierReturn"("sequentialNumber");

-- CreateIndex
CREATE INDEX "SupplierReturn_supplierId_createdAt_idx" ON "SupplierReturn"("supplierId", "createdAt");

-- CreateIndex
CREATE INDEX "SupplierReturnItem_supplierReturnId_productId_idx" ON "SupplierReturnItem"("supplierReturnId", "productId");

-- CreateIndex
CREATE INDEX "Supplier_businessName_idx" ON "Supplier"("businessName");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_identificationType_identificationNumber_key" ON "Supplier"("identificationType", "identificationNumber");

-- CreateIndex
CREATE INDEX "SyncInvoiceResult_workstationId_createdAt_idx" ON "SyncInvoiceResult"("workstationId", "createdAt");

-- CreateIndex
CREATE INDEX "SyncInvoiceResult_invoiceId_idx" ON "SyncInvoiceResult"("invoiceId");

-- CreateIndex
CREATE INDEX "SyncInvoiceResult_workstationId_status_idx" ON "SyncInvoiceResult"("workstationId", "status");

-- CreateIndex
CREATE INDEX "SyncOperationOutcome_workstationId_createdAt_idx" ON "SyncOperationOutcome"("workstationId", "createdAt");

-- CreateIndex
CREATE INDEX "SyncOperationOutcome_workstationId_outcome_idx" ON "SyncOperationOutcome"("workstationId", "outcome");

-- CreateIndex
CREATE INDEX "SyncOperationOutcome_createdAt_idx" ON "SyncOperationOutcome"("createdAt");

-- CreateIndex
CREATE INDEX "SyncOperationOutcome_operationUuid_idx" ON "SyncOperationOutcome"("operationUuid");

-- CreateIndex
CREATE UNIQUE INDEX "SyncQueue_operationUuid_key" ON "SyncQueue"("operationUuid");

-- CreateIndex
CREATE INDEX "SyncQueue_status_nextRetryAt_idx" ON "SyncQueue"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "SyncQueue_sourceWorkstationId_clientSequence_idx" ON "SyncQueue"("sourceWorkstationId", "clientSequence");

-- CreateIndex
CREATE INDEX "SyncQueue_operationType_status_idx" ON "SyncQueue"("operationType", "status");

-- CreateIndex
CREATE INDEX "SyncQueue_correlationId_idx" ON "SyncQueue"("correlationId");

-- CreateIndex
CREATE INDEX "SystemConfig_module_idx" ON "SystemConfig"("module");

-- CreateIndex
CREATE INDEX "TaxScheme_code_rate_idx" ON "TaxScheme"("code", "rate");

-- CreateIndex
CREATE UNIQUE INDEX "TenantConfig_subscriptionId_key" ON "TenantConfig"("subscriptionId");

-- CreateIndex
CREATE INDEX "TenantConfig_subscriptionId_idx" ON "TenantConfig"("subscriptionId");

-- CreateIndex
CREATE INDEX "NamedPreset_subscriptionId_idx" ON "NamedPreset"("subscriptionId");

-- CreateIndex
CREATE INDEX "NamedPreset_subscriptionId_isShared_idx" ON "NamedPreset"("subscriptionId", "isShared");

-- CreateIndex
CREATE INDEX "ConfigChangelog_tenantConfigId_configVersion_idx" ON "ConfigChangelog"("tenantConfigId", "configVersion");

-- CreateIndex
CREATE INDEX "ConfigChangelog_tenantConfigId_createdAt_idx" ON "ConfigChangelog"("tenantConfigId", "createdAt");

-- CreateIndex
CREATE INDEX "ConfigChangelog_changeType_createdAt_idx" ON "ConfigChangelog"("changeType", "createdAt");

-- CreateIndex
CREATE INDEX "UpdateVersion_channel_isActive_state_idx" ON "UpdateVersion"("channel", "isActive", "state");

-- CreateIndex
CREATE INDEX "UpdateVersion_state_idx" ON "UpdateVersion"("state");

-- CreateIndex
CREATE INDEX "UpdateVersion_releaseDate_idx" ON "UpdateVersion"("releaseDate");

-- CreateIndex
CREATE UNIQUE INDEX "UpdateVersion_version_channel_key" ON "UpdateVersion"("version", "channel");

-- CreateIndex
CREATE INDEX "UpdateAttemptLog_versionId_outcome_idx" ON "UpdateAttemptLog"("versionId", "outcome");

-- CreateIndex
CREATE INDEX "UpdateAttemptLog_workstationId_idx" ON "UpdateAttemptLog"("workstationId");

-- CreateIndex
CREATE INDEX "UpdateAttemptLog_occurredAt_idx" ON "UpdateAttemptLog"("occurredAt");

-- CreateIndex
CREATE INDEX "UpdateAttemptLog_outcome_occurredAt_idx" ON "UpdateAttemptLog"("outcome", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "UpdateChannelConfig_locationId_key" ON "UpdateChannelConfig"("locationId");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workstationId_fkey" FOREIGN KEY ("workstationId") REFERENCES "Workstation"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "UserSession"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_workstationId_fkey" FOREIGN KEY ("workstationId") REFERENCES "Workstation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLocationAccess" ADD CONSTRAINT "UserLocationAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepUpRequest" ADD CONSTRAINT "StepUpRequest_requestingUserId_fkey" FOREIGN KEY ("requestingUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepUpRequest" ADD CONSTRAINT "StepUpRequest_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepUpRequest" ADD CONSTRAINT "StepUpRequest_deniedByUserId_fkey" FOREIGN KEY ("deniedByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginAttempt" ADD CONSTRAINT "LoginAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoExpirationJob" ADD CONSTRAINT "AutoExpirationJob_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientReturn" ADD CONSTRAINT "ClientReturn_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientReturn" ADD CONSTRAINT "ClientReturn_annulledById_fkey" FOREIGN KEY ("annulledById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientReturn" ADD CONSTRAINT "ClientReturn_workstationId_fkey" FOREIGN KEY ("workstationId") REFERENCES "Workstation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientReturn" ADD CONSTRAINT "ClientReturn_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "FiscalDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientReturnItem" ADD CONSTRAINT "ClientReturnItem_clientReturnId_fkey" FOREIGN KEY ("clientReturnId") REFERENCES "ClientReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientReturnItem" ADD CONSTRAINT "ClientReturnItem_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "SaleItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientReturnItemLot" ADD CONSTRAINT "ClientReturnItemLot_clientReturnItemId_fkey" FOREIGN KEY ("clientReturnItemId") REFERENCES "ClientReturnItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "ClientClassification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalIssuerConfig" ADD CONSTRAINT "FiscalIssuerConfig_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechProviderConfig" ADD CONSTRAINT "TechProviderConfig_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_purchaseReceptionId_fkey" FOREIGN KEY ("purchaseReceptionId") REFERENCES "PurchaseReception"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_resolutionId_fkey" FOREIGN KEY ("resolutionId") REFERENCES "FiscalResolution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "FiscalResolutionAllocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_referenceDocumentId_fkey" FOREIGN KEY ("referenceDocumentId") REFERENCES "FiscalDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalResolution" ADD CONSTRAINT "FiscalResolution_workstationId_fkey" FOREIGN KEY ("workstationId") REFERENCES "Workstation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalResolutionAllocation" ADD CONSTRAINT "FiscalResolutionAllocation_resolutionId_fkey" FOREIGN KEY ("resolutionId") REFERENCES "FiscalResolution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalResolutionAllocation" ADD CONSTRAINT "FiscalResolutionAllocation_workstationId_fkey" FOREIGN KEY ("workstationId") REFERENCES "Workstation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalResolutionAllocation" ADD CONSTRAINT "FiscalResolutionAllocation_allocatedByUserId_fkey" FOREIGN KEY ("allocatedByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAdjustmentDocument" ADD CONSTRAINT "InventoryAdjustmentDocument_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAdjustmentDocument" ADD CONSTRAINT "InventoryAdjustmentDocument_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAdjustmentDocument" ADD CONSTRAINT "InventoryAdjustmentDocument_rejectedByUserId_fkey" FOREIGN KEY ("rejectedByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAdjustmentDocument" ADD CONSTRAINT "InventoryAdjustmentDocument_annulledByUserId_fkey" FOREIGN KEY ("annulledByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAdjustmentDocument" ADD CONSTRAINT "InventoryAdjustmentDocument_physicalCountId_fkey" FOREIGN KEY ("physicalCountId") REFERENCES "PhysicalCount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivationCode" ADD CONSTRAINT "ActivationCode_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivationCode" ADD CONSTRAINT "ActivationCode_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkstationActivation" ADD CONSTRAINT "WorkstationActivation_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkstationActivation" ADD CONSTRAINT "WorkstationActivation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkstationActivation" ADD CONSTRAINT "WorkstationActivation_activationCodeId_fkey" FOREIGN KEY ("activationCodeId") REFERENCES "ActivationCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LicenseCheckIn" ADD CONSTRAINT "LicenseCheckIn_workstationActivationId_fkey" FOREIGN KEY ("workstationActivationId") REFERENCES "WorkstationActivation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LicenseCheckIn" ADD CONSTRAINT "LicenseCheckIn_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudAlert" ADD CONSTRAINT "FraudAlert_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudAlert" ADD CONSTRAINT "FraudAlert_workstationActivationId_fkey" FOREIGN KEY ("workstationActivationId") REFERENCES "WorkstationActivation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPaymentHistory" ADD CONSTRAINT "SubscriptionPaymentHistory_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfflineSessionBlessing" ADD CONSTRAINT "OfflineSessionBlessing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfflineSessionBlessing" ADD CONSTRAINT "OfflineSessionBlessing_workstationId_fkey" FOREIGN KEY ("workstationId") REFERENCES "Workstation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfflineTokenRevocation" ADD CONSTRAINT "OfflineTokenRevocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfflineTokenRevocation" ADD CONSTRAINT "OfflineTokenRevocation_workstationId_fkey" FOREIGN KEY ("workstationId") REFERENCES "Workstation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicalCount" ADD CONSTRAINT "PhysicalCount_startedByUserId_fkey" FOREIGN KEY ("startedByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicalCount" ADD CONSTRAINT "PhysicalCount_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "SaleItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductBarcode" ADD CONSTRAINT "ProductBarcode_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPriceHistory" ADD CONSTRAINT "ProductPriceHistory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPriceHistory" ADD CONSTRAINT "ProductPriceHistory_previousPriceHistoryId_fkey" FOREIGN KEY ("previousPriceHistoryId") REFERENCES "ProductPriceHistory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTaxHistory" ADD CONSTRAINT "ProductTaxHistory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTaxHistory" ADD CONSTRAINT "ProductTaxHistory_previousTaxHistoryId_fkey" FOREIGN KEY ("previousTaxHistoryId") REFERENCES "ProductTaxHistory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTaxHistory" ADD CONSTRAINT "ProductTaxHistory_taxSchemeId_fkey" FOREIGN KEY ("taxSchemeId") REFERENCES "TaxScheme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_pharmaceuticalFormId_fkey" FOREIGN KEY ("pharmaceuticalFormId") REFERENCES "PharmaceuticalForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_annulledById_fkey" FOREIGN KEY ("annulledById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReception" ADD CONSTRAINT "PurchaseReception_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReception" ADD CONSTRAINT "PurchaseReception_annulledById_fkey" FOREIGN KEY ("annulledById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReception" ADD CONSTRAINT "PurchaseReception_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReception" ADD CONSTRAINT "PurchaseReception_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceptionItem" ADD CONSTRAINT "PurchaseReceptionItem_purchaseReceptionId_fkey" FOREIGN KEY ("purchaseReceptionId") REFERENCES "PurchaseReception"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceptionItem" ADD CONSTRAINT "PurchaseReceptionItem_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItemLot" ADD CONSTRAINT "SaleItemLot_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "SaleItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItemLot" ADD CONSTRAINT "SaleItemLot_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalePayment" ADD CONSTRAINT "SalePayment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalePayment" ADD CONSTRAINT "SalePayment_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_clientClassificationIdSnapshot_fkey" FOREIGN KEY ("clientClassificationIdSnapshot") REFERENCES "ClientClassification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_cashShiftId_fkey" FOREIGN KEY ("cashShiftId") REFERENCES "CashShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftCashCount" ADD CONSTRAINT "ShiftCashCount_cashShiftId_fkey" FOREIGN KEY ("cashShiftId") REFERENCES "CashShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftCashCount" ADD CONSTRAINT "ShiftCashCount_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierReturn" ADD CONSTRAINT "SupplierReturn_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierReturn" ADD CONSTRAINT "SupplierReturn_annulledById_fkey" FOREIGN KEY ("annulledById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierReturn" ADD CONSTRAINT "SupplierReturn_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierReturn" ADD CONSTRAINT "SupplierReturn_purchaseReceptionId_fkey" FOREIGN KEY ("purchaseReceptionId") REFERENCES "PurchaseReception"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierReturnItem" ADD CONSTRAINT "SupplierReturnItem_supplierReturnId_fkey" FOREIGN KEY ("supplierReturnId") REFERENCES "SupplierReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemConfig" ADD CONSTRAINT "SystemConfig_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfigChangelog" ADD CONSTRAINT "ConfigChangelog_tenantConfigId_fkey" FOREIGN KEY ("tenantConfigId") REFERENCES "TenantConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpdateAttemptLog" ADD CONSTRAINT "UpdateAttemptLog_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "UpdateVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;


