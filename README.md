# Pharmacy System (Droguería) - Project Documentation

**Project Version:** 1.0.0**Last Updated:** July 2, 2026**Status:** Domain Scaffold Complete - Ready for Business Logic Implementation

---

## Table of Contents

1. [Project Overview](#project-overview)

1. [Technology Stack](#technology-stack)

1. [Project Structure](#project-structure)

1. [Architecture Principles](#architecture-principles)

1. [Domain Modules](#domain-modules)

1. [Database Schema](#database-schema)

1. [Development Setup](#development-setup)

1. [Build & Deployment](#build--deployment)

1. [Code Standards](#code-standards)

1. [Regulatory Compliance](#regulatory-compliance)

---

## Project Overview

**Pharmacy System** is a **local-first pharmacy point-of-sale (POS) system** designed for the Colombian regulatory context. The system is built as a monorepo using **pnpm workspaces** and **Turborepo**, with a focus on:

- **Offline-first architecture**: Workstations can operate independently and synchronize when connectivity is available

- **Colombian regulatory compliance**: DIAN fiscal integration, IVA reporting, Habeas Data (Ley 1581/2012)

- **Scalable microservices**: Separate backend, frontend (POS desktop, backoffice web), and fiscal engine microservice

- **Type-safe development**: End-to-end TypeScript with strict mode enabled

### Core Use Cases

1. **Point-of-Sale (POS)**: Real-time sales transactions with inventory management

1. **Inventory Management**: Lot tracking, expiration monitoring, FIFO valuation

1. **Fiscal Integration**: DIAN invoice generation, tax reporting, contingency mode

1. **Cash Management**: Cash shift tracking, payment method reconciliation

1. **Reporting & Analytics**: Sales, inventory, cash, and tax reporting

1. **Synchronization**: Multi-workstation sync with conflict resolution

1. **User Management**: Role-based access control (RBAC) with audit logging

---

## Technology Stack

### Core Technologies

| Layer | Technology | Version | Purpose |
| --- | --- | --- | --- |
| **Runtime** | Node.js | 22 LTS | Server runtime |
| **Package Manager** | pnpm | 11 | Monorepo package management |
| **Monorepo Tool** | Turborepo | 2 | Build orchestration and caching |
| **Language** | TypeScript | 6+ | Type-safe development |
| **Framework** | NestJS | 11 | Backend framework |
| **Database** | PostgreSQL | 16 | Primary data store |
| **ORM** | Prisma | 7 | Type-safe database access |
| **Validation** | Zod | 4 | Runtime schema validation |
| **Authentication** | Passport.js | Latest | JWT-based auth |

### Development Tools

- **TypeScript Compiler**: `tsc` with strict mode

- **Linting**: ESLint (configured but not yet implemented)

- **Testing**: Jest (configured but not yet implemented)

- **API Documentation**: Swagger/OpenAPI (future phase)

### Excluded Technologies

- ❌ `class-validator` — Replaced with Zod for runtime validation

- ❌ CommonJS `require()` — ES modules only

- ❌ Decorators for validation — DTOs implement Zod schemas manually

---

## Project Structure

### Monorepo Layout

```
pharmacy-system/
├── apps/
│   ├── server/                          # NestJS backend (COMPLETE SCAFFOLD)
│   ├── pos-desktop/                     # Tauri POS application (future)
│   ├── backoffice/                      # React web admin dashboard (future)
│   └── fiscal-engine/                   # Microservice for DIAN integration (future)
├── packages/
│   ├── shared-types/                    # TypeScript interfaces and enums
│   └── shared-validation/               # Zod schemas for runtime validation
├── pnpm-workspace.yaml                  # Monorepo workspace configuration
├── turbo.json                           # Turborepo build pipeline
├── tsconfig.base.json                   # Base TypeScript configuration
├── .npmrc                               # pnpm configuration
└── package.json                         # Root package (private workspace)
```

### apps/server Structure

```
apps/server/
├── src/
│   ├── main.ts                          # Application entry point
│   ├── app.module.ts                    # Root NestJS module
│   ├── config/
│   │   └── env.schema.ts                # Environment validation
│   ├── infrastructure/
│   │   └── prisma/
│   │       ├── prisma.service.ts        # Prisma client wrapper
│   │       └── prisma.module.ts         # Prisma module
│   ├── common/
│   │   ├── decorators/
│   │   │   ├── roles.decorator.ts       # Role-based access decorator
│   │   │   ├── current-user.decorator.ts
│   │   │   └── auditable.decorator.ts   # Audit logging decorator
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts        # JWT authentication guard
│   │   │   └── roles.guard.ts           # Role-based access guard
│   │   ├── filters/
│   │   │   └── http-exception.filter.ts # Global exception handler
│   │   ├── interceptors/
│   │   │   └── audit-log.interceptor.ts # Audit logging interceptor
│   │   ├── pipes/
│   │   │   └── zod-validation.pipe.ts   # Zod schema validation pipe
│   │   └── exceptions/
│   │       ├── domain.exception.ts      # Domain-specific exceptions
│   │       └── not-implemented-for-phase.exception.ts
│   └── modules/                         # Domain modules (10 total )
│       ├── auth/                        # Authentication & Sessions
│       ├── cash-shift/                  # Cash management
│       ├── catalog/                     # Product catalog
│       ├── clients/                     # Client management
│       ├── configuration/               # System configuration
│       ├── fiscal-dian/                 # DIAN fiscal integration
│       ├── inventory-lots/              # Inventory & lot management
│       ├── purchases/                   # Purchase orders & suppliers
│       ├── reports/                     # Analytics & reporting
│       └── sales-pos/                   # Point-of-sale transactions
│           └── sync/                    # Multi-workstation sync
├── prisma/
│   ├── schema.prisma                    # Database schema (60+ models)
│   └── migrations/                      # Database migrations
├── package.json                         # Server dependencies
├── tsconfig.json                        # Server TypeScript config
└── .env.example                         # Environment variables template
```

### packages/shared-types Structure

```
packages/shared-types/
├── src/
│   ├── index.ts                         # Barrel exports
│   ├── enums.ts                         # All shared enums
│   ├── user.ts                          # User interface
│   ├── product.ts                       # Product interface
│   ├── client.ts                        # Client interface
│   ├── sale.ts                          # Sale interface
│   ├── sale-item.ts                     # Sale item interface
│   ├── fiscal-document.ts               # Fiscal document interface
│   ├── sync-queue-entry.ts              # Sync queue interface
│   └── cash-shift.ts                    # Cash shift interface
├── package.json
└── tsconfig.json
```

### packages/shared-validation Structure

```
packages/shared-validation/
├── src/
│   ├── index.ts                         # Barrel exports
│   ├── product-schema.ts                # Product Zod schema
│   ├── client-schema.ts                 # Client Zod schema
│   ├── create-sale-schema.ts            # Sale creation Zod schema
│   └── user-login-schema.ts             # Login Zod schema
├── package.json
└── tsconfig.json
```

---

## Architecture Principles

### 1. **Monorepo with Workspaces**

- **Root workspace**: Private, contains only configuration

- **Shared packages** (`@pharmacy/shared-types`, `@pharmacy/shared-validation`): Reusable across all apps

- **Apps**: Independent applications (server, POS, backoffice, fiscal-engine)

- **Build orchestration**: Turborepo handles dependency graph and caching

### 2. **Modular Backend Architecture**

- **10 Domain Modules**: Each module is self-contained with controller, service, DTOs, and entities

- **Layered Architecture**: Controllers → Services → Prisma (data access)

- **Cross-cutting Concerns**: Centralized in `common/` (guards, filters, interceptors, decorators)

- **Dependency Injection**: NestJS built-in DI container

### 3. **Type Safety**

- **End-to-end TypeScript**: All source code in TypeScript with strict mode

- **Shared types**: `@pharmacy/shared-types` defines domain entities

- **Runtime validation**: Zod schemas in `@pharmacy/shared-validation`

- **Prisma Client**: Auto-generated types from schema

### 4. **Local-First Synchronization**

- **Workstation Independence**: Each POS terminal can operate offline

- **Sync Queue**: Pending operations stored locally, synced when online

- **Conflict Resolution**: Last-write-wins with sequence numbers per workstation

- **Idempotency**: Operations identified by UUID to prevent duplicates

### 5. **Security & Audit**

- **JWT Authentication**: Stateful sessions with revocation support

- **Role-Based Access Control**: 4 roles (CASHIER, INVENTORY_ASSISTANT, ACCOUNTANT, ADMIN)

- **Audit Logging**: All mutations and sensitive reads logged with user, action, timestamp

- **Password Hashing**: bcrypt with configurable rounds

### 6. **Regulatory Compliance**

- **DIAN Integration**: Invoice generation, XML signing, transmission to DIAN

- **IVA Reporting**: Tax breakdown by scheme type (IVA, INC, RETEFUENTE, etc.)

- **Habeas Data (Ley 1581/2012)**: Client consent tracking, data subject rights

- **Fiscal Document Retention**: 5-year archival with XML payload management

---

## Domain Modules

### 1. **Auth Module** (`auth`)

**Responsibilities**: User authentication, session management, password hashing

**Endpoints**:

- `POST /auth/login` — Authenticate user, create session

- `POST /auth/logout` — Revoke session

- `POST /auth/refresh` — Refresh JWT token

- `GET /auth/me` — Get current user profile

**Key Entities**: User, UserSession

**Key Features**:

- JWT-based stateful sessions

- Session revocation with reason tracking

- Failed login attempt tracking with account locking

- Password hashing with bcrypt

---

### 2. **Cash Shift Module** (`cash-shift`)

**Responsibilities**: Cash shift lifecycle, payment method reconciliation

**Endpoints**:

- `GET /cash-shift` — List shifts (paginated, filterable)

- `GET /cash-shift/:id` — Get shift details

- `POST /cash-shift` — Open new shift

- `PATCH /cash-shift/:id` — Update shift

- `POST /cash-shift/:id/close` — Close shift and reconcile

**Key Entities**: CashShift, ShiftCashCount

**Key Features**:

- Shift state machine (OPEN, CLOSED, RECONCILED, DISCREPANCY)

- Payment method breakdown

- Cash count reconciliation

---

### 3. **Catalog Module** (`catalog`)

**Responsibilities**: Product master data, pricing, tax schemes

**Endpoints**:

- `GET /catalog/products` — List products (paginated, searchable)

- `GET /catalog/products/:id` — Get product details

- `POST /catalog/products` — Create product

- `PATCH /catalog/products/:id` — Update product

**Key Entities**: Product, ProductBarcode, ProductPriceHistory, ProductTaxHistory

**Key Features**:

- Multiple barcodes per product (EAN13, EAN14, GTIN, internal, DataMatrix)

- Price history with effective dates

- Tax scheme history

- Categories and pharmaceutical forms

---

### 4. **Clients Module** (`clients`)

**Responsibilities**: Customer master data, Habeas Data compliance

**Endpoints**:

- `GET /clients` — List clients (paginated, filterable)

- `GET /clients/:id` — Get client details

- `POST /clients` — Create client

- `PATCH /clients/:id` — Update client

**Key Entities**: Client, ClientClassification, DataSubjectRequest

**Key Features**:

- Client type (PARTICULAR, FREQUENT, INSTITUTIONAL)

- Identification type (CC, NIT, CE, PASSPORT, TI, PEP)

- Consent scope tracking (Habeas Data compliance)

- Discount classification

---

### 5. **Configuration Module** (`configuration`)

**Responsibilities**: System-wide settings and parameters

**Endpoints**:

- `GET /configuration` — List all configurations

- `GET /configuration/:key` — Get configuration by key

- `PATCH /configuration/:key` — Upsert configuration

**Key Entities**: SystemConfig

**Key Features**:

- Discriminated union for config values (NUMBER, BOOLEAN, STRING, ARRAY, OBJECT)

- Sensitive flag for restricted access

- Module-scoped configurations

---

### 6. **Fiscal DIAN Module** (`fiscal-dian`)

**Responsibilities**: DIAN fiscal document generation and tracking

**Endpoints**:

- `GET /fiscal-dian/documents` — List fiscal documents (paginated, filterable)

- `GET /fiscal-dian/documents/:id` — Get document details

- `GET /fiscal-dian/documents/:id/xml` — Download XML payload

- `POST /fiscal-dian/documents/:id/retry` — Retry failed document

- `GET /fiscal-dian/resolutions` — List DIAN resolutions

- `GET /fiscal-dian/resolutions/:id` — Get resolution details

- `POST /fiscal-dian/resolutions` — Create new resolution

**Key Entities**: FiscalDocument, FiscalResolution, FiscalResolutionAllocation, FiscalIssuerConfig, TechProviderConfig

**Key Features**:

- 11-state document lifecycle (PENDING_GENERATION, GENERATION_ERROR, PENDING_SIGNATURE, etc.)

- XML payload storage in PostgreSQL TOAST

- Resolution number range management with row-level locking

- Contingency mode support

- 5-year archival with payload anonymization

---

### 7. **Inventory & Lots Module** (`inventory-lots`)

**Responsibilities**: Stock management, lot tracking, inventory adjustments

**Endpoints**:

- `GET /inventory/lots` — List lots (paginated, filterable)

- `GET /inventory/lots/:id` — Get lot details

- `POST /inventory/lots/:id/block` — Block lot from sales

- `POST /inventory/lots/:id/unblock` — Unblock lot

- `GET /inventory/adjustments` — List adjustments

- `POST /inventory/adjustments` — Create adjustment

- `POST /inventory/adjustments/:id/submit` — Submit for approval

- `POST /inventory/adjustments/:id/approve` — Approve adjustment

- `POST /inventory/adjustments/:id/reject` — Reject adjustment

- `POST /inventory/adjustments/:id/apply` — Apply approved adjustment

- `POST /inventory/adjustments/:id/annul` — Annul adjustment

- `GET /inventory/movements` — List inventory movements (append-only ledger)

**Key Entities**: Lot, InventoryMovement, InventoryAdjustmentDocument, PhysicalCount, AutoExpirationJob

**Key Features**:

- Lot state machine (ACTIVE, EXHAUSTED, EXPIRED, BLOCKED)

- FIFO-based stock valuation

- Expiration monitoring

- Adjustment workflow (DRAFT → SUBMITTED → APPROVED/REJECTED → APPLIED/ANNULLED)

- Append-only movement ledger

- 11 movement types (PURCHASE_RECEPTION, SALE, SUPPLIER_RETURN, CLIENT_RETURN, ADJUSTMENT, etc.)

---

### 8. **Purchases Module** (`purchases`)

**Responsibilities**: Supplier management, purchase orders, receptions

**Endpoints**:

- `GET /purchases/suppliers` — List suppliers

- `GET /purchases/suppliers/:id` — Get supplier details

- `POST /purchases/suppliers` — Create supplier

- `PATCH /purchases/suppliers/:id` — Update supplier

- `GET /purchases/orders` — List purchase orders

- `GET /purchases/orders/:id` — Get order details

- `POST /purchases/orders` — Create purchase order

- `PATCH /purchases/orders/:id` — Update order

**Key Entities**: Supplier, PurchaseOrder, PurchaseOrderItem, PurchaseReception, PurchaseReceptionItem, SupplierReturn, SupplierReturnItem

**Key Features**:

- Supplier identification (NIT, CC, CE, PASSPORT)

- Credit limit management

- Purchase order state machine (DRAFT, CONFIRMED, PARTIALLY_RECEIVED, FULLY_RECEIVED, ANNULLED)

- Reception without prior PO support

- Tax snapshot capture for DIAN reporting

- Supplier return tracking

---

### 9. **Reports Module** (`reports`)

**Responsibilities**: Analytics and reporting across all domains

**Endpoints**:

- `GET /reports/sales-summary` — Sales aggregation by SaleType

- `GET /reports/cash-shift-summary` — Cash aggregation by PaymentMethodCategory

- `GET /reports/inventory-valuation` — Inventory FIFO valuation and expiring lots

- `GET /reports/tax-summary` — Tax breakdown by TaxSchemeType (IVA reporting)

**Key Features**:

- Date range filtering (shared query shape)

- Aggregation across sales, cash, inventory, and fiscal domains

- FIFO-based valuation

- Colombian tax reporting (IVA, INC, RETEFUENTE, RETEICA, IMPOCONSUMO, EXENTO)

- Audit trail of report access

---

### 10. **Sales & POS Module** (`sales-pos`)

**Responsibilities**: Point-of-sale transactions, sales recording

**Endpoints**:

- `GET /sales` — List sales (paginated, filterable)

- `GET /sales/:id` — Get sale details

- `POST /sales` — Create sale

- `POST /sales/:id/confirm` — Confirm sale

- `POST /sales/:id/annul` — Annul sale

**Key Entities**: Sale, SaleItem, ClientReturn, Recipe

**Key Features**:

- Sale type (FREE_SALE, PRESCRIPTION, CONTROLLED_SUBSTANCE)

- Sale state machine (IN_PROGRESS, CONFIRMED, ANNULLED, ABANDONED)

- Prescription tracking

- Client return management with credit notes

- Payment method breakdown

---

### 11. **Sync Module** (`sync`)

**Responsibilities**: Multi-workstation synchronization

**Endpoints**:

- `POST /sync/batch` — Submit batch of pending operations

- `GET /sync/status` — Get workstation sync status

- `GET /sync/queue` — List pending operations (ADMIN only)

- `GET /sync/queue/:id` — Get operation details

- `POST /sync/queue/:id/retry` — Retry failed operation

**Key Entities**: SyncQueue

**Key Features**:

- Idempotent operations via UUID

- Conflict resolution by source workstation + sequence number

- 7 operation types (CREATE_SALE, UPDATE_SALE, CREATE_ADJUSTMENT, UPDATE_ADJUSTMENT, CREATE_PURCHASE_ORDER, UPDATE_PURCHASE_ORDER, SYNC_CATALOG)

- 4 status states (PENDING, PROCESSING, COMPLETED, FAILED)

- Retry mechanism with exponential backoff (future phase)

---

## Database Schema

### Overview

- **60+ models** across 7 domains

- **30+ enums** for type safety

- **PostgreSQL 16** with TOAST for large objects (XML payloads)

- **Prisma 6** for type-safe access

- **Optimistic locking** via version fields on mutable entities

- **Referential integrity**: Mostly enforced at application layer for audit preservation

### Key Design Patterns

#### 1. **Circular References (Application-Managed)**

```
model Product {
  currentPriceId String?  // FK to ProductPriceHistory
  currentTaxHistoryId String?  // FK to ProductTaxHistory
}
```

**Rationale**: Circular foreign keys would require deferred constraints. Instead, the application maintains consistency.

#### 2. **Polymorphic Relations (Column-Based)**

```
model InventoryMovement {
  purchaseReceptionId String?  // @relation
  saleId String?  // plain column (no @relation)
  supplierReturnId String?  // @relation
  clientReturnId String?  // plain column (no @relation)
}
```

**Rationale**: Mixed approach avoids over-constraining while maintaining type safety for primary sources.

#### 3. **Append-Only Ledgers**

```
model InventoryMovement {
  @@index([createdAt])
  @@index([lotId, createdAt])
}

model AuditLog {
  @@index([userId, createdAt])
  @@index([entityType, entityId])
}
```

**Rationale**: Immutable records with strategic indexes for query performance.

#### 4. **Denormalization for Performance**

```
model Lot {
  currentStock Int  // Denormalized from InventoryMovement
  version Int  // Optimistic locking
}
```

**Rationale**: Avoids expensive aggregations; application maintains consistency via transactions.

#### 5. **Partial Indexes (Raw SQL)**

```
model FiscalResolution {
  /// Partial unique index: (workstationId, documentType, prefix) WHERE state = ACTIVE
  /// Requires raw SQL migration
}
```

**Rationale**: Only one active resolution per workstation/document type/prefix combination.

#### 6. **Exclusion Constraints (GiST, Raw SQL)**

```
model FiscalResolution {
  /// Exclusion constraint: no overlapping ranges for same workstation
  /// Requires raw SQL migration
}
```

**Rationale**: Prevents accidental number range conflicts.

#### 7. **Row-Level Locking**

```
model FiscalResolutionAllocation {
  /// SELECT FOR UPDATE in application code
  /// Ensures atomic number allocation
}
```

**Rationale**: Prevents race conditions in concurrent number generation.

### Core Models by Domain

#### Auth & Catalog

- User, UserSession, Workstation

- Category, PharmaceuticalForm

- TaxScheme, PaymentMethod

- Product, ProductBarcode, ProductPriceHistory, ProductTaxHistory

#### Clients & Inventory/Lots

- ClientClassification, Client, DataSubjectRequest

- Lot, InventoryMovement, InventoryAdjustmentDocument, AutoExpirationJob, PhysicalCount

#### Purchases & Receptions

- Supplier, PurchaseOrder, PurchaseOrderItem

- PurchaseReception, PurchaseReceptionItem

- SupplierReturn, SupplierReturnItem

#### Cash Shift & Sales/POS

- CashShift, ShiftCashCount

- Sale, SaleItem, ClientReturn, Recipe

#### Fiscal DIAN

- FiscalIssuerConfig, TechProviderConfig

- FiscalResolution, FiscalResolutionAllocation

- FiscalDocument

#### Sync, Configuration & Audit

- SyncQueue

- SystemConfig

- AuditLog

---

## Development Setup

### Prerequisites

- Node.js 22 LTS

- pnpm 11

- PostgreSQL 16

- Git

### Installation

```bash
# Clone repository
git clone <repository-url>
cd pharmacy-system

# Install dependencies
pnpm install

# Set up environment variables
cp apps/server/.env.example apps/server/.env
# Edit .env with your database URL and secrets

# Generate Prisma Client
pnpm exec prisma generate

# Run database migrations
pnpm exec prisma migrate deploy

# Seed database (optional)
pnpm exec prisma db seed
```

### Running the Development Server

```bash
# Start all packages in watch mode
pnpm dev

# Or start specific package
pnpm --filter @pharmacy/server dev

# Server runs on http://localhost:3000
```

### TypeScript Type Checking

```bash
# Type check all packages
pnpm typecheck

# Type check specific package
pnpm --filter @pharmacy/server typecheck
```

### Building for Production

```bash
# Build all packages
pnpm build

# Build specific package
pnpm --filter @pharmacy/server build

# Output in dist/ directories
```

---

## Build & Deployment

### Turborepo Pipeline

```json
{
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "outputs": []
    },
    "typecheck": {
      "outputs": []
    }
  }
}
```

### Docker Deployment (Future Phase )

```
FROM node:22-alpine
WORKDIR /app
COPY pnpm-lock.yaml .
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
EXPOSE 3000
CMD ["pnpm", "start"]
```

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/pharmacy_db

# JWT
JWT_SECRET=your-secret-key-here
JWT_EXPIRATION=24h

# Node
NODE_ENV=development|production

# DIAN (Fiscal Integration)
DIAN_TECH_PROVIDER_ID=your-provider-id
DIAN_TECH_PROVIDER_SECRET=your-provider-secret
DIAN_ESTABLISHMENT_NIT=your-establishment-nit
```

---

## Code Standards

### Naming Conventions

- **Files**: kebab-case (e.g., `user-login.dto.ts`)

- **Classes**: PascalCase (e.g., `UserLoginDto`)

- **Functions/Methods**: camelCase (e.g., `getUserById()`)

- **Constants**: UPPER_SNAKE_CASE (e.g., `MAX_LOGIN_ATTEMPTS`)

- **Enums**: PascalCase (e.g., `RoleType`)

### File Organization

```
module/
├── controllers/
│   └── *.controller.ts
├── services/
│   └── *.service.ts
├── dto/
│   ├── *.schema.ts        # Zod schemas
│   └── *.dto.ts           # DTO classes
├── entities/
│   └── *.entity.ts        # Type aliases
├── exceptions/
│   └── *.exception.ts     # Domain exceptions
├── index.ts               # Barrel export
└── *.module.ts            # NestJS module
```

### Code Quality Rules

- **Function length**: Maximum 25 lines

- **Class length**: Maximum 200 lines

- **No generic names**: Avoid `data`, `item`, `handler`, `utils`, `misc`

- **Single responsibility**: One purpose per function/class

- **Error handling**: Throw exceptions, never return error codes

- **Comments**: Only for non-obvious business logic

- **No hardcoded strings**: Use enums and constants

- **No emojis**: Professional code only

### TypeScript Configuration

```json
{
  "compilerOptions": {
    "strict": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitAny": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

### Zod Schema Patterns

```typescript
// Local schema (promotion candidate comment)
export const CreateProductSchema = z.object({
  name: z.string().min(1).max(255),
  price: z.string().regex(/^\d+\.\d{2}$/),
  // ...
});

// DTO implementation
export class CreateProductDto implements z.infer<typeof CreateProductSchema> {
  name!: string;
  price!: string;

  constructor(data?: z.infer<typeof CreateProductSchema>) {
    if (data) {
      this.name = data.name;
      this.price = data.price;
    }
  }
}

// Controller usage
@Post()
async create(
  @Body(new ZodValidationPipe(CreateProductSchema))
  createDto: CreateProductDto,
): Promise<ProductEntity> {
  return this.productService.create(createDto);
}
```

---

## Regulatory Compliance

### Colombian Regulatory Framework

#### 1. **DIAN Fiscal Integration**

- **Resolution 000042 (2020)**: Electronic invoicing requirements

- **Compliance**: XML generation, digital signature, transmission to DIAN

- **Implementation**: `fiscal-dian` module with state machine for document lifecycle

- **Contingency Mode**: Offline invoice generation with later transmission

#### 2. **IVA Reporting**

- **Tax Schemes**: IVA, INC, RETEFUENTE, RETEICA, IMPOCONSUMO, EXENTO

- **Reporting**: `reports/tax-summary` endpoint with breakdown by scheme

- **Audit Trail**: All tax calculations logged for compliance

#### 3. **Habeas Data (Ley 1581/2012)**

- **Data Subject Rights**: Access, rectification, deletion, portability

- **Consent Tracking**: `Client.consentScope` JSON field

- **Data Requests**: `DataSubjectRequest` model with workflow

- **Implementation**: `clients` module with ARCO compliance

#### 4. **Fiscal Document Retention**

- **Retention Period**: 5 years minimum

- **Storage**: XML payloads in PostgreSQL TOAST

- **Archival**: Anonymization of sensitive fields after retention period

- **Implementation**: `FiscalDocument` model with archival lifecycle

#### 5. **Audit Logging**

- **Scope**: All mutations and sensitive reads

- **Fields**: User, action, entity type, timestamp, IP address

- **Immutability**: Append-only audit log

- **Implementation**: `AuditLog` model with interceptor-based capture

---

## Future Phases

### Phase 7: Business Logic Implementation

- Auth: Password hashing, JWT generation, session management

- Catalog: Product CRUD, barcode management, price history

- Clients: Client CRUD, consent management, data subject requests

- Inventory: Stock management, FIFO valuation, expiration tracking

- Purchases: PO workflow, reception processing, supplier returns

- Sales: POS transactions, payment processing, client returns

- Fiscal: Invoice generation, XML signing, DIAN transmission

- Sync: Conflict resolution, batch processing, retry logic

- Reports: Aggregation queries, FIFO calculations, tax summaries

- Configuration: System settings, module-scoped parameters

### Phase 8: Frontend Applications

- **POS Desktop** (`apps/pos-desktop`): Electron-based POS terminal

- **Backoffice Web** (`apps/backoffice`): React admin dashboard

- **Fiscal Engine** (`apps/fiscal-engine`): Microservice for DIAN integration

### Phase 9: Testing & Quality

- Unit tests for services and utilities

- Integration tests for API endpoints

- E2E tests for critical workflows

- Performance testing and optimization

### Phase 10: Deployment & Operations

- Docker containerization

- Kubernetes orchestration

- CI/CD pipeline (GitHub Actions)

- Monitoring and alerting

- Database backup and recovery

---

## Support & Contribution

### Reporting Issues

Please report issues with:

- Clear description of the problem

- Steps to reproduce

- Expected vs. actual behavior

- Environment details (Node version, OS, etc.)

### Contributing

1. Fork the repository

1. Create a feature branch (`git checkout -b feature/your-feature`)

1. Commit changes (`git commit -am 'Add your feature'`)

1. Push to branch (`git push origin feature/your-feature`)

1. Create a Pull Request

### Code Review Checklist

- [ ] TypeScript strict mode passes

- [ ] No function exceeds 25 lines

- [ ] No class exceeds 200 lines

- [ ] All exceptions have `errorCode` and English `message`

- [ ] No hardcoded Spanish strings in code

- [ ] Zod schemas used for validation

- [ ] Audit logging for mutations

- [ ] Role-based access control applied

---

## License

This project is proprietary and confidential. Unauthorized copying or distribution is prohibited.

---

## Contact

For questions or support, contact the development team at [contact-email].

---

**Document Version**: 1.0.0**Last Updated**: July 2, 2026**Maintained By**: Development Team
```
drugstore-project
├─ .opencode
│  ├─ agents
│  │  ├─ backend.md
│  │  ├─ frontend-backoffice.md
│  │  ├─ frontend-pos.md
│  │  ├─ pos-local.md
│  │  ├─ pos-testing.md
│  │  └─ testing.md
│  ├─ package-lock.json
│  ├─ package.json
│  ├─ plugins
│  │  └─ startup
│  └─ README.md
├─ AGENTS.md
├─ apps
│  ├─ fiscal-engine
│  │  ├─ package.json
│  │  ├─ src
│  │  │  ├─ app.module.ts
│  │  │  ├─ common
│  │  │  │  └─ exceptions
│  │  │  │     ├─ domain.exception.ts
│  │  │  │     └─ not-implemented-for-phase.exception.ts
│  │  │  ├─ config
│  │  │  │  └─ env.schema.ts
│  │  │  ├─ infrastructure
│  │  │  │  ├─ prisma
│  │  │  │  │  ├─ prisma.module.ts
│  │  │  │  │  └─ prisma.service.ts
│  │  │  │  └─ queue
│  │  │  │     └─ bullmq.module.ts
│  │  │  ├─ main.ts
│  │  │  └─ modules
│  │  │     └─ fiscal-processing
│  │  │        ├─ adapters
│  │  │        │  ├─ file-system-secret-reader.adapter.ts
│  │  │        │  ├─ index.ts
│  │  │        │  └─ soap-fiscal-transmission.adapter.ts
│  │  │        ├─ builders
│  │  │        │  ├─ cufe.calculator.ts
│  │  │        │  └─ ubl-invoice.builder.ts
│  │  │        ├─ exceptions
│  │  │        │  ├─ fiscal-document-generation-failed.exception.ts
│  │  │        │  ├─ fiscal-document-rejected.exception.ts
│  │  │        │  └─ fiscal-transmission-failed.exception.ts
│  │  │        ├─ fiscal-documents.service.ts
│  │  │        ├─ fiscal-processing.module.ts
│  │  │        ├─ fiscal-processing.processor.ts
│  │  │        ├─ fiscal-transmission.service.ts
│  │  │        ├─ ports
│  │  │        │  ├─ fiscal-transmission.port.ts
│  │  │        │  ├─ index.ts
│  │  │        │  ├─ secret-reader.port.ts
│  │  │        │  └─ transmission-results.type.ts
│  │  │        ├─ signing
│  │  │        │  ├─ certificate.loader.ts
│  │  │        │  ├─ dian-constants.ts
│  │  │        │  └─ xades-signer.ts
│  │  │        └─ soap
│  │  │           ├─ dian-http-client.ts
│  │  │           ├─ soap-envelope.builder.ts
│  │  │           └─ soap-signer.ts
│  │  └─ tsconfig.json
│  ├─ pos-desktop
│  │  ├─ e2e
│  │  │  ├─ admin-flow.spec.ts
│  │  │  ├─ inventory-flow.spec.ts
│  │  │  ├─ offline-flow.spec.ts
│  │  │  ├─ returns-flow.spec.ts
│  │  │  ├─ sales-flow.spec.ts
│  │  │  └─ setup.ts
│  │  ├─ index.html
│  │  ├─ package.json
│  │  ├─ playwright.config.ts
│  │  ├─ src
│  │  │  ├─ assets
│  │  │  │  └─ help
│  │  │  │     ├─ licensing
│  │  │  │     │  ├─ activation.md
│  │  │  │     │  ├─ adding-workstations.md
│  │  │  │     │  ├─ locked.md
│  │  │  │     │  ├─ multiple-locations.md
│  │  │  │     │  └─ renewal.md
│  │  │  │     └─ updates
│  │  │  │        ├─ beta-channel.md
│  │  │  │        ├─ how-it-works.md
│  │  │  │        ├─ installation.md
│  │  │  │        ├─ rollback.md
│  │  │  │        └─ troubleshooting.md
│  │  │  ├─ common
│  │  │  │  ├─ domain-error.test.ts
│  │  │  │  ├─ domain-error.ts
│  │  │  │  ├─ download.test.ts
│  │  │  │  ├─ download.ts
│  │  │  │  ├─ format-age.test.ts
│  │  │  │  ├─ format-age.ts
│  │  │  │  ├─ is-online.test.ts
│  │  │  │  ├─ is-online.ts
│  │  │  │  ├─ sync-metadata.test.ts
│  │  │  │  ├─ sync-metadata.ts
│  │  │  │  ├─ time-format.test.ts
│  │  │  │  └─ time-format.ts
│  │  │  ├─ config
│  │  │  │  ├─ fiscal.test.ts
│  │  │  │  └─ fiscal.ts
│  │  │  ├─ domain
│  │  │  │  ├─ assistant
│  │  │  │  │  ├─ assistant-metrics.service.test.ts
│  │  │  │  │  ├─ assistant-metrics.service.ts
│  │  │  │  │  ├─ assistant-types.ts
│  │  │  │  │  ├─ commands.test.ts
│  │  │  │  │  ├─ commands.ts
│  │  │  │  │  ├─ exceptions.test.ts
│  │  │  │  │  ├─ exceptions.ts
│  │  │  │  │  ├─ form-memory.service.test.ts
│  │  │  │  │  ├─ form-memory.service.ts
│  │  │  │  │  ├─ help-helpers.test.ts
│  │  │  │  │  ├─ help-helpers.ts
│  │  │  │  │  ├─ index.ts
│  │  │  │  │  ├─ markdown-renderer.tsx
│  │  │  │  │  ├─ palette-helpers.test.ts
│  │  │  │  │  ├─ palette-helpers.ts
│  │  │  │  │  ├─ search-index.service.test.ts
│  │  │  │  │  ├─ search-index.service.ts
│  │  │  │  │  ├─ shortcut-helpers.test.ts
│  │  │  │  │  ├─ shortcut-helpers.ts
│  │  │  │  │  ├─ shortcut-manager.test.ts
│  │  │  │  │  ├─ shortcut-manager.ts
│  │  │  │  │  ├─ suggestion-engine.service.test.ts
│  │  │  │  │  ├─ suggestion-engine.service.ts
│  │  │  │  │  ├─ suggestion-rules.test.ts
│  │  │  │  │  └─ suggestion-rules.ts
│  │  │  │  ├─ audit
│  │  │  │  │  ├─ audit.service.inventory-bugs.test.ts
│  │  │  │  │  ├─ audit.service.test.ts
│  │  │  │  │  ├─ audit.service.ts
│  │  │  │  │  ├─ index.ts
│  │  │  │  │  ├─ local-audit-writer.service.test.ts
│  │  │  │  │  └─ local-audit-writer.service.ts
│  │  │  │  ├─ auth
│  │  │  │  │  ├─ auth-guards.test.ts
│  │  │  │  │  ├─ auth-guards.ts
│  │  │  │  │  ├─ auth-http-client.test.ts
│  │  │  │  │  ├─ auth-http-client.ts
│  │  │  │  │  ├─ auth.service.test.ts
│  │  │  │  │  ├─ auth.service.ts
│  │  │  │  │  ├─ exceptions.test.ts
│  │  │  │  │  ├─ exceptions.ts
│  │  │  │  │  ├─ index.ts
│  │  │  │  │  ├─ local-session.store.ts
│  │  │  │  │  ├─ local-user-cache.test.ts
│  │  │  │  │  ├─ local-user-cache.ts
│  │  │  │  │  ├─ local-users.test.ts
│  │  │  │  │  ├─ local-users.ts
│  │  │  │  │  └─ offline
│  │  │  │  │     ├─ exceptions.test.ts
│  │  │  │  │     ├─ exceptions.ts
│  │  │  │  │     ├─ index.ts
│  │  │  │  │     ├─ local-offline-session.store.test.ts
│  │  │  │  │     ├─ local-offline-session.store.ts
│  │  │  │  │     ├─ session.test.ts
│  │  │  │  │     ├─ session.ts
│  │  │  │  │     ├─ storage.test.ts
│  │  │  │  │     ├─ storage.ts
│  │  │  │  │     ├─ types.ts
│  │  │  │  │     ├─ validation.test.ts
│  │  │  │  │     └─ validation.ts
│  │  │  │  ├─ backup
│  │  │  │  │  ├─ backup-export.ts
│  │  │  │  │  ├─ backup.service.test.ts
│  │  │  │  │  ├─ backup.service.ts
│  │  │  │  │  ├─ exceptions.test.ts
│  │  │  │  │  ├─ exceptions.ts
│  │  │  │  │  ├─ index.ts
│  │  │  │  │  ├─ recovery-log.service.test.ts
│  │  │  │  │  └─ recovery-log.service.ts
│  │  │  │  ├─ cash-shift
│  │  │  │  │  ├─ cash-shift.service.pglite.test.ts
│  │  │  │  │  ├─ cash-shift.service.prisma-integration.test.ts
│  │  │  │  │  ├─ cash-shift.service.test.ts
│  │  │  │  │  ├─ cash-shift.service.ts
│  │  │  │  │  ├─ cash-shift.store.ts
│  │  │  │  │  ├─ exceptions.test.ts
│  │  │  │  │  ├─ exceptions.ts
│  │  │  │  │  ├─ index.ts
│  │  │  │  │  ├─ shift-close-html.test.ts
│  │  │  │  │  └─ shift-close-html.ts
│  │  │  │  ├─ catalog
│  │  │  │  │  ├─ catalog-sync.service.test.ts
│  │  │  │  │  ├─ catalog-sync.service.ts
│  │  │  │  │  ├─ exceptions.ts
│  │  │  │  │  ├─ index.ts
│  │  │  │  │  ├─ payment-method-sync.service.test.ts
│  │  │  │  │  ├─ payment-method-sync.service.ts
│  │  │  │  │  └─ product.service.ts
│  │  │  │  ├─ clients
│  │  │  │  │  ├─ client-pull.service.test.ts
│  │  │  │  │  ├─ client-pull.service.ts
│  │  │  │  │  ├─ clients.service.test.ts
│  │  │  │  │  ├─ clients.service.ts
│  │  │  │  │  ├─ index.ts
│  │  │  │  │  └─ sync-payload-contract.test.ts
│  │  │  │  ├─ config
│  │  │  │  │  ├─ config-sync.service.ts
│  │  │  │  │  ├─ config.service.test.ts
│  │  │  │  │  ├─ config.service.ts
│  │  │  │  │  ├─ defaults.ts
│  │  │  │  │  ├─ effective-config.test.ts
│  │  │  │  │  ├─ effective-config.ts
│  │  │  │  │  ├─ field-requirements.test.ts
│  │  │  │  │  ├─ field-requirements.ts
│  │  │  │  │  ├─ index.ts
│  │  │  │  │  ├─ presets.test.ts
│  │  │  │  │  ├─ presets.ts
│  │  │  │  │  ├─ tenant-config.store.test.ts
│  │  │  │  │  ├─ tenant-config.store.ts
│  │  │  │  │  ├─ types.ts
│  │  │  │  │  ├─ use-field-requirement.ts
│  │  │  │  │  ├─ use-tenant-config.ts
│  │  │  │  │  ├─ use-user-preferences.ts
│  │  │  │  │  ├─ validation.test.ts
│  │  │  │  │  └─ validation.ts
│  │  │  │  ├─ configuration
│  │  │  │  │  ├─ config-sync.service.test.ts
│  │  │  │  │  ├─ config-sync.service.ts
│  │  │  │  │  ├─ index.ts
│  │  │  │  │  ├─ local-config.store.test.ts
│  │  │  │  │  ├─ local-config.store.ts
│  │  │  │  │  └─ use-purchases-config.ts
│  │  │  │  ├─ domain-services
│  │  │  │  │  ├─ domain-service.factory.test.ts
│  │  │  │  │  └─ domain-service.factory.ts
│  │  │  │  ├─ fiscal
│  │  │  │  │  ├─ contingency.service.test.ts
│  │  │  │  │  ├─ contingency.service.ts
│  │  │  │  │  ├─ contingency.store.test.ts
│  │  │  │  │  ├─ contingency.store.ts
│  │  │  │  │  ├─ cufe.test.ts
│  │  │  │  │  ├─ cufe.ts
│  │  │  │  │  ├─ exceptions.test.ts
│  │  │  │  │  ├─ exceptions.ts
│  │  │  │  │  ├─ fiscal-scheduler.service.test.ts
│  │  │  │  │  ├─ fiscal-scheduler.service.ts
│  │  │  │  │  ├─ fiscal-service.factory.test.ts
│  │  │  │  │  ├─ fiscal-service.factory.ts
│  │  │  │  │  ├─ fiscal-types.ts
│  │  │  │  │  ├─ fiscal.page.tsx
│  │  │  │  │  ├─ index.ts
│  │  │  │  │  ├─ invoice.service.test.ts
│  │  │  │  │  ├─ invoice.service.ts
│  │  │  │  │  ├─ local-adjustment.exceptions.test.ts
│  │  │  │  │  ├─ local-adjustment.exceptions.ts
│  │  │  │  │  ├─ local-adjustment.service.test.ts
│  │  │  │  │  ├─ local-adjustment.service.ts
│  │  │  │  │  ├─ local-adjustment.types.ts
│  │  │  │  │  ├─ numbering.service.test.ts
│  │  │  │  │  ├─ numbering.service.ts
│  │  │  │  │  ├─ receipt-generator.test.ts
│  │  │  │  │  ├─ receipt-generator.ts
│  │  │  │  │  └─ use-fiscal-services.ts
│  │  │  │  ├─ inventory-adjustments
│  │  │  │  │  ├─ exceptions.test.ts
│  │  │  │  │  ├─ exceptions.ts
│  │  │  │  │  ├─ index.ts
│  │  │  │  │  ├─ inventory-adjustments.service.pglite.test.ts
│  │  │  │  │  ├─ inventory-adjustments.service.prisma-integration.test.ts
│  │  │  │  │  ├─ inventory-adjustments.service.test.ts
│  │  │  │  │  ├─ inventory-adjustments.service.ts
│  │  │  │  │  └─ sync-payload-contract.test.ts
│  │  │  │  ├─ inventory-lots
│  │  │  │  │  ├─ exceptions.test.ts
│  │  │  │  │  ├─ exceptions.ts
│  │  │  │  │  ├─ index.ts
│  │  │  │  │  ├─ inventory-lots.service.test.ts
│  │  │  │  │  ├─ inventory-lots.service.ts
│  │  │  │  │  ├─ lot-sync.service.test.ts
│  │  │  │  │  └─ lot-sync.service.ts
│  │  │  │  ├─ licensing
│  │  │  │  │  ├─ exceptions.test.ts
│  │  │  │  │  ├─ exceptions.ts
│  │  │  │  │  ├─ index.ts
│  │  │  │  │  ├─ license-check-in-scheduler.test.ts
│  │  │  │  │  ├─ license-check-in-scheduler.ts
│  │  │  │  │  ├─ license.service.test.ts
│  │  │  │  │  ├─ license.service.ts
│  │  │  │  │  ├─ license.store.test.ts
│  │  │  │  │  └─ license.store.ts
│  │  │  │  ├─ local-sync
│  │  │  │  │  ├─ hub-election.ts
│  │  │  │  │  ├─ index.ts
│  │  │  │  │  ├─ operation-merge.ts
│  │  │  │  │  ├─ peer-validation.ts
│  │  │  │  │  └─ types.ts
│  │  │  │  ├─ peripherals
│  │  │  │  │  ├─ peripheral-service.factory.test.ts
│  │  │  │  │  └─ peripheral-service.factory.ts
│  │  │  │  ├─ prescriptions
│  │  │  │  │  ├─ exceptions.test.ts
│  │  │  │  │  ├─ exceptions.ts
│  │  │  │  │  ├─ index.ts
│  │  │  │  │  ├─ prescriptions.service.test.ts
│  │  │  │  │  ├─ prescriptions.service.ts
│  │  │  │  │  └─ sync-payload-contract.test.ts
│  │  │  │  ├─ printing
│  │  │  │  │  ├─ cash-drawer.service.test.ts
│  │  │  │  │  ├─ cash-drawer.service.ts
│  │  │  │  │  ├─ config-export.service.test.ts
│  │  │  │  │  ├─ config-export.service.ts
│  │  │  │  │  ├─ customer-display.service.test.ts
│  │  │  │  │  ├─ customer-display.service.ts
│  │  │  │  │  ├─ exceptions.test.ts
│  │  │  │  │  ├─ exceptions.ts
│  │  │  │  │  ├─ formatters
│  │  │  │  │  │  ├─ escpos-formatter.test.ts
│  │  │  │  │  │  ├─ escpos-formatter.ts
│  │  │  │  │  │  ├─ label-formatter.test.ts
│  │  │  │  │  │  ├─ label-formatter.ts
│  │  │  │  │  │  ├─ pdf-formatter.test.ts
│  │  │  │  │  │  ├─ pdf-formatter.ts
│  │  │  │  │  │  ├─ template-engine.test.ts
│  │  │  │  │  │  └─ template-engine.ts
│  │  │  │  │  ├─ index.ts
│  │  │  │  │  ├─ print-payload-writer.test.ts
│  │  │  │  │  ├─ print-payload-writer.ts
│  │  │  │  │  ├─ print-queue.service.test.ts
│  │  │  │  │  ├─ print-queue.service.ts
│  │  │  │  │  ├─ printer-config.service.test.ts
│  │  │  │  │  ├─ printer-config.service.ts
│  │  │  │  │  ├─ printer-health.service.test.ts
│  │  │  │  │  ├─ printer-health.service.ts
│  │  │  │  │  ├─ printing-metrics.service.test.ts
│  │  │  │  │  ├─ printing-metrics.service.ts
│  │  │  │  │  ├─ printing-service.factory.test.ts
│  │  │  │  │  ├─ printing-service.factory.ts
│  │  │  │  │  ├─ printing-types.ts
│  │  │  │  │  ├─ proactive-notifications.test.ts
│  │  │  │  │  └─ proactive-notifications.ts
│  │  │  │  ├─ purchases
│  │  │  │  │  ├─ exceptions.ts
│  │  │  │  │  ├─ index.ts
│  │  │  │  │  ├─ purchase-orders.service.test.ts
│  │  │  │  │  ├─ purchase-orders.service.ts
│  │  │  │  │  ├─ purchase-receptions.service.test.ts
│  │  │  │  │  ├─ purchase-receptions.service.ts
│  │  │  │  │  ├─ supplier-returns.service.test.ts
│  │  │  │  │  ├─ supplier-returns.service.ts
│  │  │  │  │  ├─ suppliers.service.test.ts
│  │  │  │  │  ├─ suppliers.service.ts
│  │  │  │  │  └─ sync-payload-contract.test.ts
│  │  │  │  ├─ returns
│  │  │  │  │  ├─ exceptions.test.ts
│  │  │  │  │  ├─ exceptions.ts
│  │  │  │  │  ├─ index.ts
│  │  │  │  │  ├─ returns.service.test.ts
│  │  │  │  │  ├─ returns.service.ts
│  │  │  │  │  └─ sync-payload-contract.test.ts
│  │  │  │  ├─ sales-pos
│  │  │  │  │  ├─ exceptions.test.ts
│  │  │  │  │  ├─ exceptions.ts
│  │  │  │  │  ├─ index.ts
│  │  │  │  │  ├─ sales-history.page.tsx
│  │  │  │  │  ├─ sales-history.service.test.ts
│  │  │  │  │  ├─ sales-history.service.ts
│  │  │  │  │  ├─ sales-pos.service.pglite.test.ts
│  │  │  │  │  ├─ sales-pos.service.test.ts
│  │  │  │  │  ├─ sales-pos.service.ts
│  │  │  │  │  ├─ sales-pricing-validator.test.ts
│  │  │  │  │  ├─ sales-pricing-validator.ts
│  │  │  │  │  └─ sync-payload-contract.test.ts
│  │  │  │  ├─ sync
│  │  │  │  │  ├─ index.ts
│  │  │  │  │  ├─ sync-auth-status.store.ts
│  │  │  │  │  ├─ sync-metrics.service.test.ts
│  │  │  │  │  ├─ sync-metrics.service.ts
│  │  │  │  │  ├─ sync-push.service.test.ts
│  │  │  │  │  ├─ sync-push.service.ts
│  │  │  │  │  ├─ sync-recovery.service.test.ts
│  │  │  │  │  ├─ sync-recovery.service.ts
│  │  │  │  │  ├─ sync-scheduler.service.test.ts
│  │  │  │  │  ├─ sync-scheduler.service.ts
│  │  │  │  │  ├─ sync-scheduler.update-access-token.test.ts
│  │  │  │  │  └─ sync-types.ts
│  │  │  │  └─ updates
│  │  │  │     ├─ check-strategy.test.ts
│  │  │  │     ├─ check-strategy.ts
│  │  │  │     ├─ download-manager.test.ts
│  │  │  │     ├─ download-manager.ts
│  │  │  │     ├─ exceptions.test.ts
│  │  │  │     ├─ exceptions.ts
│  │  │  │     ├─ index.ts
│  │  │  │     ├─ install-orchestrator.test.ts
│  │  │  │     ├─ install-orchestrator.ts
│  │  │  │     ├─ migration-runner.test.ts
│  │  │  │     ├─ migration-runner.ts
│  │  │  │     ├─ rollback-detector.test.ts
│  │  │  │     ├─ rollback-detector.ts
│  │  │  │     ├─ state-machine.test.ts
│  │  │  │     ├─ state-machine.ts
│  │  │  │     ├─ telemetry.service.test.ts
│  │  │  │     ├─ telemetry.service.ts
│  │  │  │     ├─ update.service.test.ts
│  │  │  │     ├─ update.service.ts
│  │  │  │     ├─ update.store.test.ts
│  │  │  │     └─ update.store.ts
│  │  │  ├─ help-content
│  │  │  │  ├─ auth
│  │  │  │  │  ├─ 2fa-offline.md
│  │  │  │  │  ├─ credentials-cache.md
│  │  │  │  │  ├─ offline-login.md
│  │  │  │  │  └─ pending-blessings.md
│  │  │  │  ├─ index.md
│  │  │  │  ├─ index.ts
│  │  │  │  ├─ local-sync
│  │  │  │  │  ├─ conflictos.md
│  │  │  │  │  ├─ hub.md
│  │  │  │  │  ├─ que-es.md
│  │  │  │  │  ├─ seguridad.md
│  │  │  │  │  └─ troubleshooting.md
│  │  │  │  ├─ procedures
│  │  │  │  │  ├─ close-shift.md
│  │  │  │  │  ├─ process-return.md
│  │  │  │  │  └─ sync-offline.md
│  │  │  │  ├─ screens
│  │  │  │  │  ├─ inventory-adjustments.md
│  │  │  │  │  ├─ returns.md
│  │  │  │  │  ├─ sales.md
│  │  │  │  │  └─ sync-health.md
│  │  │  │  └─ shortcuts.md
│  │  │  ├─ infrastructure
│  │  │  │  ├─ auth-token-provider.test.ts
│  │  │  │  ├─ auth-token-provider.ts
│  │  │  │  ├─ catalog-service-factory.test.ts
│  │  │  │  ├─ catalog-service-factory.ts
│  │  │  │  ├─ config.test.ts
│  │  │  │  ├─ config.ts
│  │  │  │  ├─ http-client.test.ts
│  │  │  │  ├─ http-client.ts
│  │  │  │  ├─ local-database.ts
│  │  │  │  ├─ README.md
│  │  │  │  ├─ secure-storage.ts
│  │  │  │  ├─ startup-health.test.ts
│  │  │  │  ├─ startup-health.ts
│  │  │  │  └─ write-lock.ts
│  │  │  ├─ modules
│  │  │  ├─ renderer
│  │  │  │  ├─ App.sync-scheduler.test.tsx
│  │  │  │  ├─ App.tsx
│  │  │  │  ├─ commands
│  │  │  │  │  ├─ printing-commands.test.ts
│  │  │  │  │  └─ printing-commands.ts
│  │  │  │  ├─ components
│  │  │  │  │  ├─ assistant
│  │  │  │  │  │  ├─ assistant-layer.test.tsx
│  │  │  │  │  │  ├─ assistant-layer.tsx
│  │  │  │  │  │  ├─ command-palette.test.tsx
│  │  │  │  │  │  ├─ command-palette.tsx
│  │  │  │  │  │  ├─ form-memory-autocomplete.test.tsx
│  │  │  │  │  │  ├─ form-memory-autocomplete.tsx
│  │  │  │  │  │  ├─ help-content-area.tsx
│  │  │  │  │  │  ├─ help-not-found-state.tsx
│  │  │  │  │  │  ├─ help-sidebar.tsx
│  │  │  │  │  │  ├─ help-topic-content.tsx
│  │  │  │  │  │  ├─ help-viewer.test.tsx
│  │  │  │  │  │  ├─ help-viewer.tsx
│  │  │  │  │  │  ├─ help-welcome-index.tsx
│  │  │  │  │  │  ├─ palette-footer.tsx
│  │  │  │  │  │  ├─ palette-search-input.tsx
│  │  │  │  │  │  ├─ palette-search-result-group.tsx
│  │  │  │  │  │  ├─ palette-search-result-item.tsx
│  │  │  │  │  │  ├─ palette-states.tsx
│  │  │  │  │  │  ├─ shortcut-cheatsheet.test.tsx
│  │  │  │  │  │  ├─ shortcut-cheatsheet.tsx
│  │  │  │  │  │  ├─ shortcut-footer.tsx
│  │  │  │  │  │  ├─ shortcut-group.tsx
│  │  │  │  │  │  ├─ shortcut-header.tsx
│  │  │  │  │  │  ├─ shortcut-row.tsx
│  │  │  │  │  │  ├─ shortcut-search-input.tsx
│  │  │  │  │  │  ├─ shortcut-states.tsx
│  │  │  │  │  │  ├─ suggestion-banner.test.tsx
│  │  │  │  │  │  └─ suggestion-banner.tsx
│  │  │  │  │  ├─ audit
│  │  │  │  │  │  ├─ audit-event-card.tsx
│  │  │  │  │  │  ├─ audit-event-registry.test.ts
│  │  │  │  │  │  ├─ audit-event-registry.ts
│  │  │  │  │  │  ├─ audit-log-view.test.tsx
│  │  │  │  │  │  └─ audit-log-view.tsx
│  │  │  │  │  ├─ auth
│  │  │  │  │  │  ├─ activation-redirect.test.tsx
│  │  │  │  │  │  ├─ activation-redirect.tsx
│  │  │  │  │  │  ├─ audit-log-view.test.tsx
│  │  │  │  │  │  ├─ audit-log-view.tsx
│  │  │  │  │  │  ├─ auth-redirect.test.tsx
│  │  │  │  │  │  ├─ auth-redirect.tsx
│  │  │  │  │  │  ├─ avatar-grid.test.tsx
│  │  │  │  │  │  ├─ avatar-grid.tsx
│  │  │  │  │  │  ├─ avatar.component.test.tsx
│  │  │  │  │  │  ├─ avatar.component.tsx
│  │  │  │  │  │  ├─ create-user-modal.tsx
│  │  │  │  │  │  ├─ delete-user-dialog.tsx
│  │  │  │  │  │  ├─ edit-user-modal.tsx
│  │  │  │  │  │  ├─ error-banner.test.tsx
│  │  │  │  │  │  ├─ error-banner.tsx
│  │  │  │  │  │  ├─ forgot-password.page.test.tsx
│  │  │  │  │  │  ├─ forgot-password.page.tsx
│  │  │  │  │  │  ├─ index.ts
│  │  │  │  │  │  ├─ license-redirect.test.tsx
│  │  │  │  │  │  ├─ license-redirect.tsx
│  │  │  │  │  │  ├─ login-header.test.tsx
│  │  │  │  │  │  ├─ login-header.tsx
│  │  │  │  │  │  ├─ login.page.test.tsx
│  │  │  │  │  │  ├─ login.page.tsx
│  │  │  │  │  │  ├─ manual-login-form.test.tsx
│  │  │  │  │  │  ├─ manual-login-form.tsx
│  │  │  │  │  │  ├─ offline
│  │  │  │  │  │  │  ├─ offline-mode-banner.test.tsx
│  │  │  │  │  │  │  ├─ offline-mode-banner.tsx
│  │  │  │  │  │  │  ├─ pending-blessing-modal.test.tsx
│  │  │  │  │  │  │  └─ pending-blessing-modal.tsx
│  │  │  │  │  │  ├─ pin-keypad.component.test.tsx
│  │  │  │  │  │  ├─ pin-keypad.component.tsx
│  │  │  │  │  │  ├─ quick-switch.component.test.tsx
│  │  │  │  │  │  ├─ quick-switch.component.tsx
│  │  │  │  │  │  ├─ reset-password.page.test.tsx
│  │  │  │  │  │  ├─ reset-password.page.tsx
│  │  │  │  │  │  ├─ role-guard.test.tsx
│  │  │  │  │  │  ├─ role-guard.tsx
│  │  │  │  │  │  ├─ selected-user-credential.test.tsx
│  │  │  │  │  │  ├─ selected-user-credential.tsx
│  │  │  │  │  │  ├─ sessions
│  │  │  │  │  │  │  ├─ session-view.test.tsx
│  │  │  │  │  │  │  └─ session-view.tsx
│  │  │  │  │  │  ├─ set-pin-dialog.tsx
│  │  │  │  │  │  ├─ step-up-modal.test.tsx
│  │  │  │  │  │  ├─ step-up-modal.tsx
│  │  │  │  │  │  ├─ two-factor-modal.test.tsx
│  │  │  │  │  │  ├─ two-factor-modal.tsx
│  │  │  │  │  │  ├─ user-management.helpers.ts
│  │  │  │  │  │  ├─ user-management.page.test.tsx
│  │  │  │  │  │  ├─ user-management.page.tsx
│  │  │  │  │  │  ├─ user-management.types.ts
│  │  │  │  │  │  └─ user-table.tsx
│  │  │  │  │  ├─ cash-shift
│  │  │  │  │  │  ├─ active-shift-view.tsx
│  │  │  │  │  │  ├─ cash-shift.page.tsx
│  │  │  │  │  │  ├─ confirm-step.tsx
│  │  │  │  │  │  ├─ count-step.tsx
│  │  │  │  │  │  ├─ index.ts
│  │  │  │  │  │  ├─ open-shift-form.tsx
│  │  │  │  │  │  ├─ operational-drift-banner.test.tsx
│  │  │  │  │  │  ├─ operational-drift-banner.tsx
│  │  │  │  │  │  ├─ reconciliation-view.test.tsx
│  │  │  │  │  │  ├─ reconciliation-view.tsx
│  │  │  │  │  │  ├─ shift-history-section.tsx
│  │  │  │  │  │  ├─ summary-step.tsx
│  │  │  │  │  │  └─ types.ts
│  │  │  │  │  ├─ clients
│  │  │  │  │  │  ├─ client-form.tsx
│  │  │  │  │  │  ├─ client-table.tsx
│  │  │  │  │  │  ├─ clients.page.tsx
│  │  │  │  │  │  └─ delete-confirm-dialog.tsx
│  │  │  │  │  ├─ common
│  │  │  │  │  │  ├─ app-shell.test.tsx
│  │  │  │  │  │  ├─ app-shell.tsx
│  │  │  │  │  │  ├─ cash-shift-header.tsx
│  │  │  │  │  │  ├─ currency-input.test.tsx
│  │  │  │  │  │  ├─ currency-input.tsx
│  │  │  │  │  │  ├─ error-boundary.test.tsx
│  │  │  │  │  │  ├─ error-boundary.tsx
│  │  │  │  │  │  ├─ operation-queued-toast.test.tsx
│  │  │  │  │  │  ├─ operation-queued-toast.tsx
│  │  │  │  │  │  ├─ service-context.sync-scheduler.test.tsx
│  │  │  │  │  │  ├─ service-context.test.tsx
│  │  │  │  │  │  ├─ service-context.tsx
│  │  │  │  │  │  ├─ service-error-panel.test.tsx
│  │  │  │  │  │  ├─ service-error-panel.tsx
│  │  │  │  │  │  ├─ service-loading.test.tsx
│  │  │  │  │  │  ├─ service-loading.tsx
│  │  │  │  │  │  ├─ shift-required-overlay.tsx
│  │  │  │  │  │  ├─ sync-attention-banner.tsx
│  │  │  │  │  │  ├─ sync-pulse.test.tsx
│  │  │  │  │  │  └─ sync-pulse.tsx
│  │  │  │  │  ├─ config
│  │  │  │  │  │  ├─ active-mode-indicator.tsx
│  │  │  │  │  │  ├─ company-config-tab.tsx
│  │  │  │  │  │  ├─ config-form-fields.tsx
│  │  │  │  │  │  ├─ config-history.section.tsx
│  │  │  │  │  │  ├─ config-preview-modal.tsx
│  │  │  │  │  │  ├─ custom-field-editor.tsx
│  │  │  │  │  │  ├─ field-requirement-indicator.tsx
│  │  │  │  │  │  ├─ fiscal-config-tab.tsx
│  │  │  │  │  │  ├─ named-presets.section.tsx
│  │  │  │  │  │  ├─ preset-card.tsx
│  │  │  │  │  │  ├─ purchases-config-tab.tsx
│  │  │  │  │  │  ├─ sales-config-tab.tsx
│  │  │  │  │  │  ├─ strictness.section.tsx
│  │  │  │  │  │  ├─ system-preferences-tab.tsx
│  │  │  │  │  │  ├─ tenant-config.page.tsx
│  │  │  │  │  │  └─ user-preferences.section.tsx
│  │  │  │  │  ├─ DatabaseProof
│  │  │  │  │  │  ├─ database-proof.test.tsx
│  │  │  │  │  │  └─ database-proof.tsx
│  │  │  │  │  ├─ fiscal
│  │  │  │  │  │  ├─ adjustment-creation-modal.test.tsx
│  │  │  │  │  │  ├─ adjustment-creation-modal.tsx
│  │  │  │  │  │  ├─ adjustment-history-panel.test.tsx
│  │  │  │  │  │  ├─ adjustment-history-panel.tsx
│  │  │  │  │  │  ├─ cashier-operational-view.test.tsx
│  │  │  │  │  │  ├─ cashier-operational-view.tsx
│  │  │  │  │  │  ├─ contingency-history-view.test.tsx
│  │  │  │  │  │  ├─ contingency-history-view.tsx
│  │  │  │  │  │  ├─ fiscal-header.tsx
│  │  │  │  │  │  ├─ fiscal-invoice-detail-panel.test.tsx
│  │  │  │  │  │  ├─ fiscal-invoice-detail-panel.tsx
│  │  │  │  │  │  ├─ index.ts
│  │  │  │  │  │  ├─ invoice-list-view.test.tsx
│  │  │  │  │  │  ├─ invoice-list-view.tsx
│  │  │  │  │  │  ├─ operational-invoice-detail-panel.test.tsx
│  │  │  │  │  │  └─ operational-invoice-detail-panel.tsx
│  │  │  │  │  ├─ Home
│  │  │  │  │  │  ├─ home.test.tsx
│  │  │  │  │  │  ├─ home.tsx
│  │  │  │  │  │  ├─ quick-actions-card.test.tsx
│  │  │  │  │  │  ├─ quick-actions-card.tsx
│  │  │  │  │  │  ├─ stats-card.test.tsx
│  │  │  │  │  │  └─ stats-card.tsx
│  │  │  │  │  ├─ inventory-adjustments
│  │  │  │  │  │  ├─ adjustment-form.tsx
│  │  │  │  │  │  ├─ error-banner.tsx
│  │  │  │  │  │  ├─ inventory-adjustments-header.tsx
│  │  │  │  │  │  ├─ inventory-adjustments.page.test.tsx
│  │  │  │  │  │  ├─ inventory-adjustments.page.tsx
│  │  │  │  │  │  ├─ inventory-adjustments.types.ts
│  │  │  │  │  │  ├─ lot-search-panel.test.tsx
│  │  │  │  │  │  └─ lot-search-panel.tsx
│  │  │  │  │  ├─ inventory-lots
│  │  │  │  │  │  ├─ inventory-lots.page.tsx
│  │  │  │  │  │  └─ lot-movement-history.tsx
│  │  │  │  │  ├─ licensing
│  │  │  │  │  │  ├─ activation-form.tsx
│  │  │  │  │  │  ├─ activation.helpers.ts
│  │  │  │  │  │  ├─ activation.page.test.tsx
│  │  │  │  │  │  ├─ activation.page.tsx
│  │  │  │  │  │  ├─ license-assignment-panel.tsx
│  │  │  │  │  │  ├─ license-banner.test.tsx
│  │  │  │  │  │  ├─ license-banner.tsx
│  │  │  │  │  │  ├─ license-checkin-panel.tsx
│  │  │  │  │  │  ├─ license-plan-panel.tsx
│  │  │  │  │  │  ├─ license-status-badge.tsx
│  │  │  │  │  │  ├─ license-status.helpers.ts
│  │  │  │  │  │  ├─ license-status.page.test.tsx
│  │  │  │  │  │  └─ license-status.page.tsx
│  │  │  │  │  ├─ local-sync
│  │  │  │  │  │  ├─ hub-election-info.tsx
│  │  │  │  │  │  ├─ hub-status-icon.tsx
│  │  │  │  │  │  ├─ local-network.page.tsx
│  │  │  │  │  │  ├─ local-sync-banner.tsx
│  │  │  │  │  │  └─ peer-status-card.tsx
│  │  │  │  │  ├─ Navigation
│  │  │  │  │  │  ├─ navigation-sidebar.test.tsx
│  │  │  │  │  │  └─ navigation-sidebar.tsx
│  │  │  │  │  ├─ PaymentProcessing
│  │  │  │  │  │  ├─ payment-method-row.tsx
│  │  │  │  │  │  ├─ payment-processing.test.tsx
│  │  │  │  │  │  ├─ payment-processing.tsx
│  │  │  │  │  │  └─ payment-status-badge.tsx
│  │  │  │  │  ├─ prescriptions
│  │  │  │  │  │  ├─ prescription-form.tsx
│  │  │  │  │  │  ├─ prescription-item-info.tsx
│  │  │  │  │  │  ├─ prescriptions-header.tsx
│  │  │  │  │  │  ├─ prescriptions-no-pending.tsx
│  │  │  │  │  │  ├─ prescriptions-toast.tsx
│  │  │  │  │  │  ├─ prescriptions.page.test.tsx
│  │  │  │  │  │  └─ prescriptions.page.tsx
│  │  │  │  │  ├─ printing
│  │  │  │  │  │  ├─ index.ts
│  │  │  │  │  │  ├─ print-health-tile.test.tsx
│  │  │  │  │  │  ├─ print-health-tile.tsx
│  │  │  │  │  │  ├─ print-job-row.test.tsx
│  │  │  │  │  │  ├─ print-job-row.tsx
│  │  │  │  │  │  ├─ print-queue.page.test.tsx
│  │  │  │  │  │  ├─ print-queue.page.tsx
│  │  │  │  │  │  ├─ printer-card.test.tsx
│  │  │  │  │  │  ├─ printer-card.tsx
│  │  │  │  │  │  ├─ printer-status-badge.test.tsx
│  │  │  │  │  │  ├─ printer-status-badge.tsx
│  │  │  │  │  │  ├─ printers.page.test.tsx
│  │  │  │  │  │  ├─ printers.page.tsx
│  │  │  │  │  │  ├─ printing-container.tsx
│  │  │  │  │  │  ├─ queue-summary-bar.test.tsx
│  │  │  │  │  │  ├─ queue-summary-bar.tsx
│  │  │  │  │  │  ├─ setup-wizard-step-discovery.test.tsx
│  │  │  │  │  │  ├─ setup-wizard-step-discovery.tsx
│  │  │  │  │  │  ├─ setup-wizard-step-fallback-config.test.tsx
│  │  │  │  │  │  ├─ setup-wizard-step-fallback-config.tsx
│  │  │  │  │  │  ├─ setup-wizard-step-found-printers.test.tsx
│  │  │  │  │  │  ├─ setup-wizard-step-found-printers.tsx
│  │  │  │  │  │  ├─ setup-wizard-step-job-assignment.test.tsx
│  │  │  │  │  │  ├─ setup-wizard-step-job-assignment.tsx
│  │  │  │  │  │  ├─ setup-wizard-step-summary.test.tsx
│  │  │  │  │  │  ├─ setup-wizard-step-summary.tsx
│  │  │  │  │  │  ├─ setup-wizard-step-test-prints.test.tsx
│  │  │  │  │  │  ├─ setup-wizard-step-test-prints.tsx
│  │  │  │  │  │  ├─ setup-wizard-step-welcome.test.tsx
│  │  │  │  │  │  ├─ setup-wizard-step-welcome.tsx
│  │  │  │  │  │  ├─ setup-wizard.page.test.tsx
│  │  │  │  │  │  └─ setup-wizard.page.tsx
│  │  │  │  │  ├─ productos
│  │  │  │  │  │  └─ productos-main.page.tsx
│  │  │  │  │  ├─ products
│  │  │  │  │  │  ├─ product-form.tsx
│  │  │  │  │  │  ├─ product-header.tsx
│  │  │  │  │  │  ├─ product-list.tsx
│  │  │  │  │  │  ├─ products.page.tsx
│  │  │  │  │  │  ├─ products.types.ts
│  │  │  │  │  │  └─ use-product-form-data.ts
│  │  │  │  │  ├─ purchases
│  │  │  │  │  │  ├─ purchase-order-detail.tsx
│  │  │  │  │  │  ├─ purchase-order-form.tsx
│  │  │  │  │  │  ├─ purchase-order-list.tsx
│  │  │  │  │  │  ├─ purchase-orders.page.tsx
│  │  │  │  │  │  ├─ purchase-receptions.page.tsx
│  │  │  │  │  │  ├─ purchases-helpers.tsx
│  │  │  │  │  │  ├─ purchases-main.page.tsx
│  │  │  │  │  │  ├─ reception-detail.tsx
│  │  │  │  │  │  ├─ reception-form.tsx
│  │  │  │  │  │  ├─ reception-list.tsx
│  │  │  │  │  │  ├─ searchable-select.tsx
│  │  │  │  │  │  ├─ supplier-form.tsx
│  │  │  │  │  │  ├─ supplier-list.tsx
│  │  │  │  │  │  ├─ supplier-return-detail.tsx
│  │  │  │  │  │  ├─ supplier-return-form.tsx
│  │  │  │  │  │  ├─ supplier-return-list.tsx
│  │  │  │  │  │  ├─ supplier-returns.page.tsx
│  │  │  │  │  │  ├─ supplier-search-bar.tsx
│  │  │  │  │  │  └─ suppliers.page.tsx
│  │  │  │  │  ├─ Receipt
│  │  │  │  │  │  ├─ receipt.test.tsx
│  │  │  │  │  │  └─ receipt.tsx
│  │  │  │  │  ├─ recovery
│  │  │  │  │  │  ├─ index.ts
│  │  │  │  │  │  ├─ recovery-page-view.test.tsx
│  │  │  │  │  │  ├─ recovery-page-view.tsx
│  │  │  │  │  │  ├─ recovery.page.test.tsx
│  │  │  │  │  │  └─ recovery.page.tsx
│  │  │  │  │  ├─ returns
│  │  │  │  │  │  ├─ return-tabs.tsx
│  │  │  │  │  │  ├─ returns-header.tsx
│  │  │  │  │  │  ├─ returns-toast.tsx
│  │  │  │  │  │  ├─ returns.page.test.tsx
│  │  │  │  │  │  ├─ returns.page.tsx
│  │  │  │  │  │  ├─ returns.types.ts
│  │  │  │  │  │  ├─ unverified-return-flow.tsx
│  │  │  │  │  │  └─ verified-return-flow.tsx
│  │  │  │  │  ├─ sales-history
│  │  │  │  │  │  ├─ index.ts
│  │  │  │  │  │  ├─ sales-history-adjustment-modal.test.tsx
│  │  │  │  │  │  ├─ sales-history-adjustment-modal.tsx
│  │  │  │  │  │  ├─ sales-history-detail.test.tsx
│  │  │  │  │  │  ├─ sales-history-detail.tsx
│  │  │  │  │  │  ├─ sales-history-empty.test.tsx
│  │  │  │  │  │  ├─ sales-history-empty.tsx
│  │  │  │  │  │  ├─ sales-history-list.test.tsx
│  │  │  │  │  │  └─ sales-history-list.tsx
│  │  │  │  │  ├─ SalesTransaction
│  │  │  │  │  │  ├─ cart-line-item.tsx
│  │  │  │  │  │  ├─ cart-panel.test.tsx
│  │  │  │  │  │  ├─ cart-panel.tsx
│  │  │  │  │  │  ├─ client-selector.tsx
│  │  │  │  │  │  ├─ help-bar.tsx
│  │  │  │  │  │  ├─ product-search-results.tsx
│  │  │  │  │  │  ├─ product-search.test.tsx
│  │  │  │  │  │  ├─ product-search.tsx
│  │  │  │  │  │  ├─ quick-client-form.tsx
│  │  │  │  │  │  ├─ restricted-confirmation-dialog.test.tsx
│  │  │  │  │  │  ├─ restricted-confirmation-dialog.tsx
│  │  │  │  │  │  ├─ sales-transaction.test.tsx
│  │  │  │  │  │  ├─ sales-transaction.tsx
│  │  │  │  │  │  ├─ totals-summary.test.tsx
│  │  │  │  │  │  └─ totals-summary.tsx
│  │  │  │  │  ├─ sync
│  │  │  │  │  │  ├─ action-bar.test.tsx
│  │  │  │  │  │  ├─ action-bar.tsx
│  │  │  │  │  │  ├─ all-clear-banner.tsx
│  │  │  │  │  │  ├─ auth-status-badge.test.tsx
│  │  │  │  │  │  ├─ auth-status-badge.tsx
│  │  │  │  │  │  ├─ discard-entry-modal.test.tsx
│  │  │  │  │  │  ├─ discard-entry-modal.tsx
│  │  │  │  │  │  ├─ entries-section.test.tsx
│  │  │  │  │  │  ├─ entries-section.tsx
│  │  │  │  │  │  ├─ entry-detail-drawer.test.tsx
│  │  │  │  │  │  ├─ entry-detail-drawer.tsx
│  │  │  │  │  │  ├─ failure-breakdown-panel.test.tsx
│  │  │  │  │  │  ├─ failure-breakdown-panel.tsx
│  │  │  │  │  │  ├─ kpi-grid.tsx
│  │  │  │  │  │  ├─ no-sync-data-placeholder.tsx
│  │  │  │  │  │  ├─ sync-health-error.tsx
│  │  │  │  │  │  ├─ sync-health-loading.tsx
│  │  │  │  │  │  ├─ sync-health-toast.tsx
│  │  │  │  │  │  ├─ sync-health.page.test.tsx
│  │  │  │  │  │  ├─ sync-health.page.tsx
│  │  │  │  │  │  ├─ sync-health.types.ts
│  │  │  │  │  │  ├─ timeline-chart.test.tsx
│  │  │  │  │  │  └─ timeline-chart.tsx
│  │  │  │  │  ├─ ui
│  │  │  │  │  │  ├─ icons
│  │  │  │  │  │  │  └─ index.tsx
│  │  │  │  │  │  └─ tooltip.tsx
│  │  │  │  │  └─ update
│  │  │  │  │     ├─ update-check-interceptor.test.tsx
│  │  │  │  │     ├─ update-check-interceptor.tsx
│  │  │  │  │     ├─ update-modal.test.tsx
│  │  │  │  │     ├─ update-modal.tsx
│  │  │  │  │     ├─ update-progress.test.tsx
│  │  │  │  │     ├─ update-progress.tsx
│  │  │  │  │     ├─ update-settings.section.test.tsx
│  │  │  │  │     └─ update-settings.section.tsx
│  │  │  │  ├─ design-system.md
│  │  │  │  ├─ dev
│  │  │  │  │  ├─ buffer-polyfill.ts
│  │  │  │  │  ├─ design-tokens.tsx
│  │  │  │  │  ├─ empty-crypto-polyfill.ts
│  │  │  │  │  ├─ empty-url-polyfill.ts
│  │  │  │  │  ├─ fs-polyfill.ts
│  │  │  │  │  ├─ fs-promises-polyfill.ts
│  │  │  │  │  ├─ node-polyfills.ts
│  │  │  │  │  ├─ path-polyfill.ts
│  │  │  │  │  └─ postgres-array-polyfill.ts
│  │  │  │  ├─ hooks
│  │  │  │  │  ├─ use-async-action.ts
│  │  │  │  │  ├─ use-command-palette.test.tsx
│  │  │  │  │  ├─ use-command-palette.ts
│  │  │  │  │  ├─ use-elapsed-time.test.tsx
│  │  │  │  │  ├─ use-elapsed-time.ts
│  │  │  │  │  ├─ use-global-shortcuts.test.tsx
│  │  │  │  │  ├─ use-global-shortcuts.ts
│  │  │  │  │  ├─ use-help-viewer.test.tsx
│  │  │  │  │  ├─ use-help-viewer.ts
│  │  │  │  │  ├─ use-local-sync.ts
│  │  │  │  │  ├─ use-login-page.test.tsx
│  │  │  │  │  ├─ use-login-page.ts
│  │  │  │  │  ├─ use-offline-auth.test.tsx
│  │  │  │  │  ├─ use-offline-auth.ts
│  │  │  │  │  ├─ use-online-status.test.tsx
│  │  │  │  │  ├─ use-online-status.ts
│  │  │  │  │  ├─ use-pagination.ts
│  │  │  │  │  ├─ use-recovery-page.test.tsx
│  │  │  │  │  ├─ use-recovery-page.ts
│  │  │  │  │  ├─ use-require-active-shift.ts
│  │  │  │  │  ├─ use-sales-transaction.test.tsx
│  │  │  │  │  ├─ use-sales-transaction.ts
│  │  │  │  │  ├─ use-service-init.sync-scheduler.test.ts
│  │  │  │  │  ├─ use-service-init.test.tsx
│  │  │  │  │  ├─ use-service-init.ts
│  │  │  │  │  ├─ use-shortcut-cheatsheet.test.tsx
│  │  │  │  │  └─ use-shortcut-cheatsheet.ts
│  │  │  │  ├─ i18n
│  │  │  │  │  ├─ index.ts
│  │  │  │  │  └─ locales
│  │  │  │  │     ├─ en.json
│  │  │  │  │     └─ es.json
│  │  │  │  ├─ main.tsx
│  │  │  │  ├─ services
│  │  │  │  │  ├─ auth
│  │  │  │  │  │  └─ offline
│  │  │  │  │  │     ├─ offline-auth-service.test.ts
│  │  │  │  │  │     └─ offline-auth-service.ts
│  │  │  │  │  ├─ catalog-service.http.test.ts
│  │  │  │  │  ├─ catalog-service.http.ts
│  │  │  │  │  ├─ catalog-service.local.ts
│  │  │  │  │  ├─ catalog-service.test.ts
│  │  │  │  │  ├─ catalog-service.ts
│  │  │  │  │  ├─ local-sync
│  │  │  │  │  │  ├─ index.ts
│  │  │  │  │  │  ├─ local-network-key.service.ts
│  │  │  │  │  │  └─ local-sync.service.ts
│  │  │  │  │  ├─ payment-gateway-service.mock.ts
│  │  │  │  │  ├─ payment-gateway-service.test.ts
│  │  │  │  │  └─ payment-gateway-service.ts
│  │  │  │  ├─ store
│  │  │  │  │  ├─ hooks.test.tsx
│  │  │  │  │  ├─ hooks.ts
│  │  │  │  │  ├─ local-sync
│  │  │  │  │  │  ├─ index.ts
│  │  │  │  │  │  └─ local-sync.store.ts
│  │  │  │  │  ├─ slices
│  │  │  │  │  │  ├─ offline-auth-slice.ts
│  │  │  │  │  │  ├─ payment-slice.test.ts
│  │  │  │  │  │  ├─ payment-slice.ts
│  │  │  │  │  │  ├─ payment-types.ts
│  │  │  │  │  │  ├─ sales-slice.test.ts
│  │  │  │  │  │  ├─ sales-slice.ts
│  │  │  │  │  │  ├─ sales-types.ts
│  │  │  │  │  │  ├─ ui-slice.test.ts
│  │  │  │  │  │  ├─ ui-slice.ts
│  │  │  │  │  │  └─ ui-types.ts
│  │  │  │  │  ├─ store.test.ts
│  │  │  │  │  └─ store.ts
│  │  │  │  ├─ styles
│  │  │  │  │  └─ global.css
│  │  │  │  └─ utils
│  │  │  │     ├─ format-currency.test.ts
│  │  │  │     ├─ format-currency.ts
│  │  │  │     ├─ format-date.test.ts
│  │  │  │     ├─ format-date.ts
│  │  │  │     └─ notify.ts
│  │  │  └─ stores
│  │  │     ├─ assistant.store.test.ts
│  │  │     ├─ assistant.store.ts
│  │  │     ├─ user-preferences.store.test.ts
│  │  │     └─ user-preferences.store.ts
│  │  ├─ src-tauri
│  │  │  ├─ build.rs
│  │  │  ├─ capabilities
│  │  │  │  └─ default.json
│  │  │  ├─ Cargo.lock
│  │  │  ├─ Cargo.toml
│  │  │  ├─ gen
│  │  │  │  └─ schemas
│  │  │  │     ├─ acl-manifests.json
│  │  │  │     ├─ capabilities.json
│  │  │  │     ├─ desktop-schema.json
│  │  │  │     └─ windows-schema.json
│  │  │  ├─ icons
│  │  │  │  └─ icon.ico
│  │  │  ├─ src
│  │  │  │  ├─ backup.rs
│  │  │  │  ├─ commands
│  │  │  │  │  ├─ backup.rs
│  │  │  │  │  ├─ local_sync.rs
│  │  │  │  │  ├─ mod.rs
│  │  │  │  │  └─ printer_discovery.rs
│  │  │  │  ├─ hardware_fingerprint.rs
│  │  │  │  ├─ hub_election.rs
│  │  │  │  ├─ lib.rs
│  │  │  │  ├─ local_sync_client.rs
│  │  │  │  ├─ local_sync_server.rs
│  │  │  │  ├─ main.rs
│  │  │  │  ├─ mdns_discovery.rs
│  │  │  │  └─ printer_discovery.rs
│  │  │  └─ tauri.conf.json
│  │  ├─ test
│  │  │  └─ integration
│  │  │     ├─ flows
│  │  │     │  ├─ auth.flow.test.ts
│  │  │     │  ├─ inventory-flow.flow.test.ts
│  │  │     │  ├─ multi-workstation.flow.test.ts
│  │  │     │  ├─ offline-flow.flow.test.ts
│  │  │     │  ├─ sale-annulment.flow.test.ts
│  │  │     │  ├─ sale-lifecycle.flow.test.ts
│  │  │     │  └─ sync-retry.flow.test.ts
│  │  │     ├─ global-setup.ts
│  │  │     └─ harness
│  │  │        ├─ test-client.ts
│  │  │        ├─ test-database.ts
│  │  │        └─ test-server.ts
│  │  ├─ tsconfig.json
│  │  ├─ tsconfig.node.json
│  │  ├─ vite.config.d.ts
│  │  ├─ vite.config.d.ts.map
│  │  ├─ vite.config.ts
│  │  ├─ vitest.config.ts
│  │  ├─ vitest.integration.config.ts
│  │  └─ vitest.setup.ts
│  └─ server
│     ├─ jest.config.ts
│     ├─ jest.e2e.config.ts
│     ├─ package.json
│     ├─ scripts
│     │  └─ recover-stuck-sync.ts
│     ├─ seed
│     │  ├─ constants
│     │  │  ├─ dates.ts
│     │  │  └─ ids.ts
│     │  ├─ helpers
│     │  │  ├─ auth.ts
│     │  │  ├─ db.ts
│     │  │  └─ upsert.ts
│     │  ├─ main.ts
│     │  └─ seed
│     │     ├─ audit-log.ts
│     │     ├─ cash-shifts.ts
│     │     ├─ client-returns.ts
│     │     ├─ clients.ts
│     │     ├─ fiscal-config.ts
│     │     ├─ inventory-lots.ts
│     │     ├─ physical-counts.ts
│     │     ├─ prescriptions.ts
│     │     ├─ products.ts
│     │     ├─ purchases.ts
│     │     ├─ reference-data.ts
│     │     ├─ sales.ts
│     │     ├─ suppliers.ts
│     │     ├─ sync-queue.ts
│     │     ├─ system-config.ts
│     │     ├─ users.ts
│     │     └─ workstation.ts
│     ├─ src
│     │  ├─ app.module.ts
│     │  ├─ common
│     │  │  ├─ decorators
│     │  │  │  ├─ auditable.decorator.ts
│     │  │  │  ├─ current-user.decorator.ts
│     │  │  │  ├─ public.decorator.ts
│     │  │  │  └─ roles.decorator.ts
│     │  │  ├─ exceptions
│     │  │  │  ├─ domain.exception.ts
│     │  │  │  └─ not-implemented-for-phase.exception.ts
│     │  │  ├─ filters
│     │  │  │  ├─ http-exception.filter.spec.ts
│     │  │  │  └─ http-exception.filter.ts
│     │  │  ├─ guards
│     │  │  │  ├─ jwt-auth.guard.ts
│     │  │  │  ├─ roles.guard.spec.ts
│     │  │  │  └─ roles.guard.ts
│     │  │  ├─ interceptors
│     │  │  │  ├─ audit-log.interceptor.spec.ts
│     │  │  │  └─ audit-log.interceptor.ts
│     │  │  ├─ pipes
│     │  │  │  ├─ zod-validation.pipe.spec.ts
│     │  │  │  └─ zod-validation.pipe.ts
│     │  │  ├─ to-decimal.spec.ts
│     │  │  └─ to-decimal.ts
│     │  ├─ config
│     │  │  ├─ env.schema.spec.ts
│     │  │  └─ env.schema.ts
│     │  ├─ infrastructure
│     │  │  ├─ prisma
│     │  │  │  ├─ prisma.module.ts
│     │  │  │  ├─ prisma.service.spec.ts
│     │  │  │  └─ prisma.service.ts
│     │  │  └─ queue
│     │  │     └─ bullmq.module.ts
│     │  ├─ main.ts
│     │  ├─ modules
│     │  │  ├─ auth
│     │  │  │  ├─ audit.controller.ts
│     │  │  │  ├─ auth.controller.spec.ts
│     │  │  │  ├─ auth.controller.ts
│     │  │  │  ├─ auth.module.ts
│     │  │  │  ├─ auth.service.spec.ts
│     │  │  │  ├─ auth.service.ts
│     │  │  │  ├─ constants
│     │  │  │  │  └─ auth.constants.ts
│     │  │  │  ├─ dto
│     │  │  │  │  ├─ auth-response.dto.ts
│     │  │  │  │  ├─ change-password.dto.ts
│     │  │  │  │  ├─ change-pin.dto.ts
│     │  │  │  │  ├─ create-user.dto.ts
│     │  │  │  │  ├─ login.dto.ts
│     │  │  │  │  ├─ password-reset.dto.ts
│     │  │  │  │  └─ reset-pin.dto.ts
│     │  │  │  ├─ exceptions
│     │  │  │  │  ├─ account-inactive.exception.ts
│     │  │  │  │  ├─ account-locked.exception.ts
│     │  │  │  │  ├─ invalid-credentials.exception.ts
│     │  │  │  │  ├─ session-expired.exception.ts
│     │  │  │  │  └─ session-revoked.exception.ts
│     │  │  │  ├─ guards
│     │  │  │  │  ├─ permission.guard.ts
│     │  │  │  │  └─ step-up.guard.ts
│     │  │  │  ├─ index.ts
│     │  │  │  ├─ offline
│     │  │  │  │  ├─ blessing.controller.ts
│     │  │  │  │  ├─ blessing.service.spec.ts
│     │  │  │  │  ├─ blessing.service.ts
│     │  │  │  │  ├─ credential-cache.service.spec.ts
│     │  │  │  │  ├─ credential-cache.service.ts
│     │  │  │  │  ├─ dto
│     │  │  │  │  │  ├─ blessing.dto.ts
│     │  │  │  │  │  └─ revocation-list.dto.ts
│     │  │  │  │  ├─ index.ts
│     │  │  │  │  ├─ offline-token.service.spec.ts
│     │  │  │  │  ├─ offline-token.service.ts
│     │  │  │  │  ├─ revocation-list.service.spec.ts
│     │  │  │  │  └─ revocation-list.service.ts
│     │  │  │  ├─ services
│     │  │  │  │  ├─ audit.service.ts
│     │  │  │  │  ├─ backup-codes.service.ts
│     │  │  │  │  ├─ password-hasher.service.spec.ts
│     │  │  │  │  ├─ password-hasher.service.ts
│     │  │  │  │  ├─ pin.service.ts
│     │  │  │  │  ├─ session.service.spec.ts
│     │  │  │  │  ├─ session.service.ts
│     │  │  │  │  ├─ step-up.service.ts
│     │  │  │  │  └─ totp.service.ts
│     │  │  │  ├─ step-up.controller.ts
│     │  │  │  ├─ strategies
│     │  │  │  │  ├─ jwt.strategy.spec.ts
│     │  │  │  │  ├─ jwt.strategy.ts
│     │  │  │  │  ├─ local.strategy.spec.ts
│     │  │  │  │  └─ local.strategy.ts
│     │  │  │  ├─ totp.controller.ts
│     │  │  │  └─ users.controller.ts
│     │  │  ├─ backoffice
│     │  │  │  ├─ backoffice.module.ts
│     │  │  │  ├─ controllers
│     │  │  │  │  ├─ sync-health.controller.spec.ts
│     │  │  │  │  └─ sync-health.controller.ts
│     │  │  │  └─ index.ts
│     │  │  ├─ cash-shift
│     │  │  │  ├─ cash-shift.controller.spec.ts
│     │  │  │  ├─ cash-shift.controller.ts
│     │  │  │  ├─ cash-shift.module.ts
│     │  │  │  ├─ cash-shift.service.spec.ts
│     │  │  │  ├─ cash-shift.service.ts
│     │  │  │  ├─ dto
│     │  │  │  │  ├─ close-cash-shift.dto.ts
│     │  │  │  │  ├─ create-cash-shift.dto.ts
│     │  │  │  │  ├─ create-cash-shift.schema.ts
│     │  │  │  │  ├─ force-close-cash-shift.dto.ts
│     │  │  │  │  ├─ open-cash-shift.dto.ts
│     │  │  │  │  ├─ query-cash-shift.dto.ts
│     │  │  │  │  ├─ register-cash-count.dto.ts
│     │  │  │  │  └─ update-cash-shift.dto.ts
│     │  │  │  ├─ entities
│     │  │  │  │  └─ cash-shift.entity.ts
│     │  │  │  ├─ exceptions
│     │  │  │  │  ├─ invalid-cash-count-for-non-cash-method.exception.ts
│     │  │  │  │  ├─ missing-closing-cash-counts.exception.ts
│     │  │  │  │  ├─ payment-method-not-found.exception.ts
│     │  │  │  │  ├─ shift-already-open.exception.ts
│     │  │  │  │  └─ shift-not-open.exception.ts
│     │  │  │  ├─ index.ts
│     │  │  │  └─ jobs
│     │  │  │     └─ extended-shift-alert.job.ts
│     │  │  ├─ catalog
│     │  │  │  ├─ catalog.controller.spec.ts
│     │  │  │  ├─ catalog.controller.ts
│     │  │  │  ├─ catalog.module.ts
│     │  │  │  ├─ catalog.service.spec.ts
│     │  │  │  ├─ catalog.service.ts
│     │  │  │  ├─ categories.controller.spec.ts
│     │  │  │  ├─ categories.controller.ts
│     │  │  │  ├─ categories.service.spec.ts
│     │  │  │  ├─ categories.service.ts
│     │  │  │  ├─ dto
│     │  │  │  │  ├─ add-product-barcode.dto.ts
│     │  │  │  │  ├─ assign-product-tax-scheme.dto.ts
│     │  │  │  │  ├─ create-category.dto.ts
│     │  │  │  │  ├─ create-pharmaceutical-form.dto.ts
│     │  │  │  │  ├─ create-product.dto.ts
│     │  │  │  │  ├─ create-tax-scheme.dto.ts
│     │  │  │  │  ├─ query-product.dto.ts
│     │  │  │  │  ├─ register-product-price.dto.ts
│     │  │  │  │  ├─ update-category.dto.ts
│     │  │  │  │  ├─ update-pharmaceutical-form.dto.ts
│     │  │  │  │  └─ update-product.dto.ts
│     │  │  │  ├─ entities
│     │  │  │  │  └─ product.entity.ts
│     │  │  │  ├─ exceptions
│     │  │  │  │  ├─ discount-reason-required.exception.ts
│     │  │  │  │  ├─ duplicate-active-tax-scheme.exception.ts
│     │  │  │  │  ├─ duplicate-barcode.exception.ts
│     │  │  │  │  └─ product-not-found.exception.ts
│     │  │  │  ├─ index.ts
│     │  │  │  ├─ pharmaceutical-forms.controller.spec.ts
│     │  │  │  ├─ pharmaceutical-forms.controller.ts
│     │  │  │  ├─ pharmaceutical-forms.service.spec.ts
│     │  │  │  ├─ pharmaceutical-forms.service.ts
│     │  │  │  ├─ products.controller.spec.ts
│     │  │  │  ├─ products.controller.ts
│     │  │  │  ├─ products.service.spec.ts
│     │  │  │  ├─ products.service.ts
│     │  │  │  ├─ tax-schemes.controller.spec.ts
│     │  │  │  ├─ tax-schemes.controller.ts
│     │  │  │  ├─ tax-schemes.service.spec.ts
│     │  │  │  └─ tax-schemes.service.ts
│     │  │  ├─ clients
│     │  │  │  ├─ clients.controller.spec.ts
│     │  │  │  ├─ clients.controller.ts
│     │  │  │  ├─ clients.module.ts
│     │  │  │  ├─ clients.service.spec.ts
│     │  │  │  ├─ clients.service.ts
│     │  │  │  ├─ dto
│     │  │  │  │  ├─ create-client.dto.ts
│     │  │  │  │  ├─ query-client.dto.ts
│     │  │  │  │  ├─ register-consent.dto.ts
│     │  │  │  │  ├─ request-data-subject-action.dto.ts
│     │  │  │  │  ├─ resolve-data-subject-request.dto.ts
│     │  │  │  │  ├─ set-classification.dto.ts
│     │  │  │  │  └─ update-client.dto.ts
│     │  │  │  ├─ entities
│     │  │  │  │  └─ client.entity.ts
│     │  │  │  ├─ exceptions
│     │  │  │  │  ├─ client-already-inactive.exception.ts
│     │  │  │  │  ├─ client-not-found.exception.ts
│     │  │  │  │  ├─ data-subject-request-already-pending.exception.ts
│     │  │  │  │  ├─ duplicate-client-identification.exception.ts
│     │  │  │  │  └─ no-pending-data-subject-request.exception.ts
│     │  │  │  └─ index.ts
│     │  │  ├─ configuration
│     │  │  │  ├─ configuration.module.ts
│     │  │  │  ├─ controllers
│     │  │  │  │  ├─ configuration.controller.spec.ts
│     │  │  │  │  └─ configuration.controller.ts
│     │  │  │  ├─ dto
│     │  │  │  │  ├─ pos-settings-response.dto.ts
│     │  │  │  │  ├─ system-config-value.schema.ts
│     │  │  │  │  └─ upsert-system-config.dto.ts
│     │  │  │  ├─ entities
│     │  │  │  │  └─ system-config.entity.ts
│     │  │  │  ├─ exceptions
│     │  │  │  │  ├─ config-value-type-mismatch.exception.ts
│     │  │  │  │  └─ immutable-config-field.exception.ts
│     │  │  │  ├─ index.ts
│     │  │  │  └─ services
│     │  │  │     ├─ configuration.service.spec.ts
│     │  │  │     ├─ configuration.service.ts
│     │  │  │     ├─ pos-settings.service.spec.ts
│     │  │  │     └─ pos-settings.service.ts
│     │  │  ├─ fiscal-dian
│     │  │  │  ├─ constants
│     │  │  │  │  └─ fiscal-singleton-ids.ts
│     │  │  │  ├─ controllers
│     │  │  │  │  ├─ fiscal-documents.controller.spec.ts
│     │  │  │  │  ├─ fiscal-documents.controller.ts
│     │  │  │  │  ├─ fiscal-resolutions.controller.spec.ts
│     │  │  │  │  └─ fiscal-resolutions.controller.ts
│     │  │  │  ├─ dto
│     │  │  │  │  ├─ create-fiscal-resolution-allocation.dto.ts
│     │  │  │  │  ├─ create-fiscal-resolution.dto.ts
│     │  │  │  │  ├─ create-fiscal-resolution.schema.ts
│     │  │  │  │  ├─ query-fiscal-documents.dto.ts
│     │  │  │  │  ├─ query-fiscal-resolutions.dto.ts
│     │  │  │  │  ├─ upsert-fiscal-issuer-config.dto.ts
│     │  │  │  │  └─ upsert-tech-provider-config.dto.ts
│     │  │  │  ├─ entities
│     │  │  │  │  ├─ fiscal-document.entity.ts
│     │  │  │  │  └─ fiscal-resolution.entity.ts
│     │  │  │  ├─ exceptions
│     │  │  │  │  ├─ allocation-range-invalid.exception.ts
│     │  │  │  │  ├─ document-not-retryable.exception.ts
│     │  │  │  │  ├─ duplicate-fiscal-document.exception.ts
│     │  │  │  │  ├─ fiscal-document-not-found.exception.spec.ts
│     │  │  │  │  ├─ fiscal-document-not-found.exception.ts
│     │  │  │  │  ├─ fiscal-issuer-config-not-set.exception.ts
│     │  │  │  │  ├─ invalid-resolution-range.exception.ts
│     │  │  │  │  ├─ no-active-resolution-for-workstation.exception.ts
│     │  │  │  │  ├─ no-validated-invoice-for-credit-note.exception.ts
│     │  │  │  │  ├─ overlapping-active-resolution.exception.ts
│     │  │  │  │  ├─ resolution-exhausted.exception.ts
│     │  │  │  │  └─ tech-provider-config-not-set.exception.ts
│     │  │  │  ├─ fiscal-dian.module.ts
│     │  │  │  ├─ fiscal-issuer-config.controller.spec.ts
│     │  │  │  ├─ fiscal-issuer-config.controller.ts
│     │  │  │  ├─ fiscal-issuer-config.service.spec.ts
│     │  │  │  ├─ fiscal-issuer-config.service.ts
│     │  │  │  ├─ fiscal-resolution-allocations.controller.spec.ts
│     │  │  │  ├─ fiscal-resolution-allocations.controller.ts
│     │  │  │  ├─ fiscal-resolution-allocations.service.spec.ts
│     │  │  │  ├─ fiscal-resolution-allocations.service.ts
│     │  │  │  ├─ index.ts
│     │  │  │  ├─ jobs
│     │  │  │  │  └─ resolution-expiration-alert.job.ts
│     │  │  │  ├─ services
│     │  │  │  │  ├─ fiscal-documents.service.spec.ts
│     │  │  │  │  ├─ fiscal-documents.service.ts
│     │  │  │  │  ├─ fiscal-resolutions.service.spec.ts
│     │  │  │  │  └─ fiscal-resolutions.service.ts
│     │  │  │  ├─ tech-provider-config.controller.spec.ts
│     │  │  │  ├─ tech-provider-config.controller.ts
│     │  │  │  ├─ tech-provider-config.service.spec.ts
│     │  │  │  └─ tech-provider-config.service.ts
│     │  │  ├─ inventory-lots
│     │  │  │  ├─ controllers
│     │  │  │  │  ├─ inventory-adjustments.controller.spec.ts
│     │  │  │  │  ├─ inventory-adjustments.controller.ts
│     │  │  │  │  ├─ inventory-movements.controller.spec.ts
│     │  │  │  │  ├─ inventory-movements.controller.ts
│     │  │  │  │  ├─ lots.controller.spec.ts
│     │  │  │  │  ├─ lots.controller.ts
│     │  │  │  │  ├─ physical-counts.controller.spec.ts
│     │  │  │  │  └─ physical-counts.controller.ts
│     │  │  │  ├─ dto
│     │  │  │  │  ├─ annul-inventory-adjustment.dto.ts
│     │  │  │  │  ├─ approve-inventory-adjustment.dto.ts
│     │  │  │  │  ├─ block-lot.dto.ts
│     │  │  │  │  ├─ create-inventory-adjustment.dto.ts
│     │  │  │  │  ├─ create-inventory-adjustment.schema.ts
│     │  │  │  │  ├─ query-inventory-adjustment.dto.ts
│     │  │  │  │  ├─ query-inventory-movement.dto.ts
│     │  │  │  │  ├─ query-lot.dto.ts
│     │  │  │  │  ├─ register-physical-count-line.dto.ts
│     │  │  │  │  ├─ reject-inventory-adjustment.dto.ts
│     │  │  │  │  └─ start-physical-count.dto.ts
│     │  │  │  ├─ entities
│     │  │  │  │  ├─ inventory-adjustment-document.entity.ts
│     │  │  │  │  ├─ inventory-movement.entity.ts
│     │  │  │  │  └─ lot.entity.ts
│     │  │  │  ├─ exceptions
│     │  │  │  │  ├─ adjustment-not-annullable.exception.ts
│     │  │  │  │  ├─ adjustment-not-approved.exception.ts
│     │  │  │  │  ├─ adjustment-not-draft.exception.ts
│     │  │  │  │  ├─ adjustment-not-found.exception.ts
│     │  │  │  │  ├─ adjustment-not-pending-approval.exception.ts
│     │  │  │  │  ├─ concurrent-stock-modification.exception.ts
│     │  │  │  │  ├─ insufficient-stock-for-adjustment.exception.ts
│     │  │  │  │  ├─ insufficient-stock.exception.ts
│     │  │  │  │  ├─ lot-cost-unavailable.exception.ts
│     │  │  │  │  ├─ lot-not-active.exception.ts
│     │  │  │  │  ├─ lot-not-blocked.exception.ts
│     │  │  │  │  ├─ lot-not-eligible-for-return.exception.ts
│     │  │  │  │  ├─ lot-not-found.exception.ts
│     │  │  │  │  ├─ lot-state-changed-since-sale.exception.ts
│     │  │  │  │  ├─ physical-count-cannot-be-annulled.exception.ts
│     │  │  │  │  ├─ physical-count-not-approved.exception.ts
│     │  │  │  │  ├─ physical-count-not-counted.exception.ts
│     │  │  │  │  ├─ physical-count-not-found.exception.ts
│     │  │  │  │  ├─ physical-count-not-open.exception.ts
│     │  │  │  │  ├─ physical-count-not-reviewed.exception.ts
│     │  │  │  │  └─ stale-adjustment.exception.ts
│     │  │  │  ├─ index.ts
│     │  │  │  ├─ inventory-lots.module.ts
│     │  │  │  ├─ services
│     │  │  │  │  ├─ inventory-adjustments.service.spec.ts
│     │  │  │  │  ├─ inventory-adjustments.service.ts
│     │  │  │  │  ├─ inventory-movements.service.spec.ts
│     │  │  │  │  ├─ inventory-movements.service.ts
│     │  │  │  │  ├─ lots.service.spec.ts
│     │  │  │  │  ├─ lots.service.ts
│     │  │  │  │  ├─ physical-counts.service.spec.ts
│     │  │  │  │  └─ physical-counts.service.ts
│     │  │  │  └─ types
│     │  │  │     ├─ consume-stock-for-supplier-return.types.ts
│     │  │  │     ├─ consume-stock.types.ts
│     │  │  │     ├─ receive-stock-from-client-return.types.ts
│     │  │  │     ├─ receive-stock.types.ts
│     │  │  │     └─ reverse-stock-for-sale.types.ts
│     │  │  ├─ licensing
│     │  │  │  ├─ activations
│     │  │  │  │  ├─ activations.controller.ts
│     │  │  │  │  ├─ activations.service.spec.ts
│     │  │  │  │  ├─ activations.service.ts
│     │  │  │  │  └─ dto
│     │  │  │  │     └─ activation.dto.ts
│     │  │  │  ├─ check-ins
│     │  │  │  │  ├─ check-ins.controller.ts
│     │  │  │  │  ├─ check-ins.service.spec.ts
│     │  │  │  │  ├─ check-ins.service.ts
│     │  │  │  │  └─ dto
│     │  │  │  │     └─ check-in.dto.ts
│     │  │  │  ├─ fraud
│     │  │  │  │  ├─ fraud-alerts.controller.ts
│     │  │  │  │  ├─ fraud-detection.service.spec.ts
│     │  │  │  │  └─ fraud-detection.service.ts
│     │  │  │  ├─ guards
│     │  │  │  │  ├─ license-required.guard.spec.ts
│     │  │  │  │  └─ license-required.guard.ts
│     │  │  │  ├─ index.ts
│     │  │  │  ├─ licensing.module.ts
│     │  │  │  ├─ locations
│     │  │  │  │  ├─ dto
│     │  │  │  │  │  └─ location.dto.ts
│     │  │  │  │  ├─ locations.controller.ts
│     │  │  │  │  ├─ locations.service.spec.ts
│     │  │  │  │  └─ locations.service.ts
│     │  │  │  ├─ payments
│     │  │  │  │  ├─ dto
│     │  │  │  │  ├─ wompi-config.service.ts
│     │  │  │  │  ├─ wompi-webhook.controller.ts
│     │  │  │  │  └─ wompi.service.ts
│     │  │  │  ├─ plans
│     │  │  │  │  ├─ dto
│     │  │  │  │  │  └─ plan.dto.ts
│     │  │  │  │  ├─ plans.controller.spec.ts
│     │  │  │  │  ├─ plans.controller.ts
│     │  │  │  │  ├─ plans.service.spec.ts
│     │  │  │  │  └─ plans.service.ts
│     │  │  │  ├─ subscriptions
│     │  │  │  │  ├─ dto
│     │  │  │  │  │  └─ subscription.dto.ts
│     │  │  │  │  ├─ subscriptions.controller.ts
│     │  │  │  │  ├─ subscriptions.service.spec.ts
│     │  │  │  │  └─ subscriptions.service.ts
│     │  │  │  └─ tokens
│     │  │  │     ├─ license-token.service.spec.ts
│     │  │  │     └─ license-token.service.ts
│     │  │  ├─ print
│     │  │  │  ├─ controllers
│     │  │  │  │  └─ print.controller.ts
│     │  │  │  ├─ dto
│     │  │  │  │  └─ print-fallback.dto.ts
│     │  │  │  ├─ index.ts
│     │  │  │  ├─ print.module.ts
│     │  │  │  └─ services
│     │  │  │     └─ print.service.ts
│     │  │  ├─ purchases
│     │  │  │  ├─ controllers
│     │  │  │  │  ├─ purchase-orders.controller.spec.ts
│     │  │  │  │  ├─ purchase-orders.controller.ts
│     │  │  │  │  ├─ purchase-receptions.controller.spec.ts
│     │  │  │  │  ├─ purchase-receptions.controller.ts
│     │  │  │  │  ├─ supplier-returns.controller.spec.ts
│     │  │  │  │  ├─ supplier-returns.controller.ts
│     │  │  │  │  ├─ suppliers.controller.spec.ts
│     │  │  │  │  └─ suppliers.controller.ts
│     │  │  │  ├─ dto
│     │  │  │  │  ├─ create-purchase-order.dto.ts
│     │  │  │  │  ├─ create-purchase-order.schema.ts
│     │  │  │  │  ├─ create-purchase-reception.dto.ts
│     │  │  │  │  ├─ create-supplier-return.dto.ts
│     │  │  │  │  ├─ create-supplier.dto.ts
│     │  │  │  │  ├─ query-purchase-order.dto.ts
│     │  │  │  │  ├─ query-purchase-reception.dto.ts
│     │  │  │  │  ├─ query-supplier-return.dto.ts
│     │  │  │  │  ├─ query-supplier.dto.ts
│     │  │  │  │  ├─ supplier.schema.ts
│     │  │  │  │  └─ update-supplier.dto.ts
│     │  │  │  ├─ entities
│     │  │  │  │  ├─ purchase-order.entity.ts
│     │  │  │  │  └─ supplier.entity.ts
│     │  │  │  ├─ exceptions
│     │  │  │  │  ├─ duplicate-supplier-identification.exception.ts
│     │  │  │  │  ├─ over-reception.exception.ts
│     │  │  │  │  ├─ purchase-order-item-mismatch.exception.ts
│     │  │  │  │  ├─ purchase-order-item-not-found.exception.ts
│     │  │  │  │  ├─ purchase-order-not-draft.exception.ts
│     │  │  │  │  ├─ purchase-order-not-found.exception.ts
│     │  │  │  │  ├─ purchase-reception-not-confirmed.exception.spec.ts
│     │  │  │  │  ├─ purchase-reception-not-confirmed.exception.ts
│     │  │  │  │  ├─ purchase-reception-not-draft.exception.ts
│     │  │  │  │  ├─ purchase-reception-not-found.exception.ts
│     │  │  │  │  ├─ supplier-not-found.exception.ts
│     │  │  │  │  ├─ supplier-return-cannot-be-annulled.exception.ts
│     │  │  │  │  ├─ supplier-return-lot-cost-unavailable.exception.ts
│     │  │  │  │  ├─ supplier-return-not-draft.exception.ts
│     │  │  │  │  └─ supplier-return-not-found.exception.ts
│     │  │  │  ├─ index.ts
│     │  │  │  ├─ purchases.module.ts
│     │  │  │  └─ services
│     │  │  │     ├─ purchase-orders.service.spec.ts
│     │  │  │     ├─ purchase-orders.service.ts
│     │  │  │     ├─ purchase-receptions.service.spec.ts
│     │  │  │     ├─ purchase-receptions.service.ts
│     │  │  │     ├─ supplier-returns.service.spec.ts
│     │  │  │     ├─ supplier-returns.service.ts
│     │  │  │     ├─ suppliers.service.spec.ts
│     │  │  │     └─ suppliers.service.ts
│     │  │  ├─ reports
│     │  │  │  ├─ controllers
│     │  │  │  │  ├─ reports.controller.spec.ts
│     │  │  │  │  └─ reports.controller.ts
│     │  │  │  ├─ dto
│     │  │  │  │  ├─ cash-shift-summary.response.dto.ts
│     │  │  │  │  ├─ daily-report.response.dto.ts
│     │  │  │  │  ├─ fiscal-report.response.dto.ts
│     │  │  │  │  ├─ inventory-valuation.response.dto.ts
│     │  │  │  │  ├─ report-date-range.query.dto.ts
│     │  │  │  │  ├─ report-date-range.schema.ts
│     │  │  │  │  ├─ sales-summary.response.dto.ts
│     │  │  │  │  └─ tax-summary.response.dto.ts
│     │  │  │  ├─ exceptions
│     │  │  │  │  └─ report-invalid-date-range.exception.ts
│     │  │  │  ├─ index.ts
│     │  │  │  ├─ reports.module.ts
│     │  │  │  └─ services
│     │  │  │     ├─ reports.service.spec.ts
│     │  │  │     └─ reports.service.ts
│     │  │  ├─ sales-pos
│     │  │  │  ├─ controllers
│     │  │  │  │  ├─ client-returns.controller.spec.ts
│     │  │  │  │  ├─ client-returns.controller.ts
│     │  │  │  │  ├─ sales.controller.spec.ts
│     │  │  │  │  └─ sales.controller.ts
│     │  │  │  ├─ dto
│     │  │  │  │  ├─ annul-client-return.dto.ts
│     │  │  │  │  ├─ annul-sale.dto.ts
│     │  │  │  │  ├─ confirm-sale.dto.ts
│     │  │  │  │  ├─ create-client-return.dto.ts
│     │  │  │  │  ├─ create-sale.dto.ts
│     │  │  │  │  ├─ query-sale.dto.ts
│     │  │  │  │  └─ reject-client-return.dto.ts
│     │  │  │  ├─ entities
│     │  │  │  │  └─ sale.entity.ts
│     │  │  │  ├─ exceptions
│     │  │  │  │  ├─ cash-shift-not-open-for-workstation.exception.ts
│     │  │  │  │  ├─ change-requires-cash-payment.exception.ts
│     │  │  │  │  ├─ client-return-cannot-be-annulled.exception.ts
│     │  │  │  │  ├─ client-return-not-draft.exception.ts
│     │  │  │  │  ├─ client-return-not-found.exception.ts
│     │  │  │  │  ├─ payment-amount-mismatch.exception.ts
│     │  │  │  │  ├─ prescription-required-not-supported.exception.ts
│     │  │  │  │  ├─ return-quantity-exceeds-available.exception.ts
│     │  │  │  │  ├─ sale-item-not-found.exception.ts
│     │  │  │  │  ├─ sale-not-confirmed.exception.ts
│     │  │  │  │  ├─ sale-not-found.exception.ts
│     │  │  │  │  └─ sale-not-in-progress.exception.ts
│     │  │  │  ├─ index.ts
│     │  │  │  ├─ sales-pos.module.ts
│     │  │  │  └─ services
│     │  │  │     ├─ client-return-calculator.service.spec.ts
│     │  │  │     ├─ client-return-calculator.service.ts
│     │  │  │     ├─ client-returns.service.spec.ts
│     │  │  │     ├─ client-returns.service.ts
│     │  │  │     ├─ sales.service.spec.ts
│     │  │  │     └─ sales.service.ts
│     │  │  ├─ sync
│     │  │  │  ├─ controllers
│     │  │  │  │  ├─ sync.controller.spec.ts
│     │  │  │  │  ├─ sync.controller.ts
│     │  │  │  │  ├─ terminals.controller.spec.ts
│     │  │  │  │  └─ terminals.controller.ts
│     │  │  │  ├─ dto
│     │  │  │  │  ├─ backup-upload.schema.ts
│     │  │  │  │  ├─ invoice-results-query.dto.ts
│     │  │  │  │  ├─ local-number-hint-query.dto.ts
│     │  │  │  │  ├─ purchase-sync-payloads.schema.ts
│     │  │  │  │  ├─ purchase-sync-payloads.ts
│     │  │  │  │  ├─ query-sync-queue.dto.ts
│     │  │  │  │  ├─ sync-batch.dto.ts
│     │  │  │  │  ├─ sync-operation.schema.spec.ts
│     │  │  │  │  └─ sync-operation.schema.ts
│     │  │  │  ├─ entities
│     │  │  │  │  └─ sync-queue-entry.entity.ts
│     │  │  │  ├─ exceptions
│     │  │  │  │  ├─ payload-hash-mismatch.exception.ts
│     │  │  │  │  └─ sync-payload-validation.exception.ts
│     │  │  │  ├─ index.ts
│     │  │  │  ├─ jobs
│     │  │  │  │  ├─ sync-processing.job.spec.ts
│     │  │  │  │  └─ sync-processing.job.ts
│     │  │  │  ├─ services
│     │  │  │  │  ├─ invoice-transmission-result.service.spec.ts
│     │  │  │  │  ├─ invoice-transmission-result.service.ts
│     │  │  │  │  ├─ sync-health.service.spec.ts
│     │  │  │  │  ├─ sync-health.service.ts
│     │  │  │  │  ├─ sync.service.spec.ts
│     │  │  │  │  ├─ sync.service.ts
│     │  │  │  │  ├─ terminal-backup.service.spec.ts
│     │  │  │  │  └─ terminal-backup.service.ts
│     │  │  │  ├─ sync-operation-dispatcher.service.spec.ts
│     │  │  │  ├─ sync-operation-dispatcher.service.ts
│     │  │  │  └─ sync.module.ts
│     │  │  ├─ tenant-config
│     │  │  │  ├─ controllers
│     │  │  │  │  ├─ admin-config.controller.ts
│     │  │  │  │  ├─ named-presets.controller.ts
│     │  │  │  │  ├─ tenant-config.controller.ts
│     │  │  │  │  ├─ workstation-config.controller.spec.ts
│     │  │  │  │  └─ workstation-config.controller.ts
│     │  │  │  ├─ dto
│     │  │  │  │  ├─ apply-preset.dto.ts
│     │  │  │  │  ├─ custom-field.dto.ts
│     │  │  │  │  ├─ custom-toggle.dto.ts
│     │  │  │  │  ├─ named-preset.dto.ts
│     │  │  │  │  ├─ update-tenant-config.dto.ts
│     │  │  │  │  └─ update-tenant-config.schema.ts
│     │  │  │  ├─ entities
│     │  │  │  │  └─ tenant-config.entity.ts
│     │  │  │  ├─ exceptions
│     │  │  │  │  ├─ config-validation.exception.ts
│     │  │  │  │  ├─ config-version-conflict.exception.ts
│     │  │  │  │  └─ preset-not-found.exception.ts
│     │  │  │  ├─ index.ts
│     │  │  │  ├─ services
│     │  │  │  │  ├─ config-sync.service.ts
│     │  │  │  │  ├─ config-validation.service.ts
│     │  │  │  │  ├─ tenant-config.service.spec.ts
│     │  │  │  │  ├─ tenant-config.service.ts
│     │  │  │  │  ├─ workstation-config.service.spec.ts
│     │  │  │  │  └─ workstation-config.service.ts
│     │  │  │  └─ tenant-config.module.ts
│     │  │  └─ updates
│     │  │     ├─ admin
│     │  │     │  └─ admin-updates.controller.ts
│     │  │     ├─ binary-storage.service.ts
│     │  │     ├─ dto
│     │  │     │  ├─ index.ts
│     │  │     │  ├─ publish-version.schema.ts
│     │  │     │  ├─ update-channel-opt-in.schema.ts
│     │  │     │  ├─ update-check.schema.ts
│     │  │     │  └─ update-telemetry.schema.ts
│     │  │     ├─ entities
│     │  │     │  ├─ update-attempt-log.entity.ts
│     │  │     │  ├─ update-channel-config.entity.ts
│     │  │     │  └─ update-version.entity.ts
│     │  │     ├─ exceptions
│     │  │     │  ├─ index.ts
│     │  │     │  ├─ invalid-signature.exception.ts
│     │  │     │  ├─ version-already-exists.exception.ts
│     │  │     │  ├─ version-not-active.exception.ts
│     │  │     │  └─ version-not-found.exception.ts
│     │  │     ├─ index.ts
│     │  │     ├─ jobs
│     │  │     ├─ signature.service.ts
│     │  │     ├─ telemetry.service.ts
│     │  │     ├─ updates.controller.ts
│     │  │     ├─ updates.module.ts
│     │  │     └─ updates.service.ts
│     │  └─ types
│     ├─ stderr.txt
│     ├─ storage
│     │  └─ updates
│     ├─ test
│     │  ├─ auth.e2e-spec.ts
│     │  ├─ cash-shift.e2e-spec.ts
│     │  ├─ catalog.e2e-spec.ts
│     │  ├─ client-return.e2e-spec.ts
│     │  ├─ fifo-stock.e2e-spec.ts
│     │  ├─ habeas-data.e2e-spec.ts
│     │  ├─ health.e2e-spec.ts
│     │  ├─ sale-lifecycle.e2e-spec.ts
│     │  └─ set-env.ts
│     ├─ tsconfig.e2e.json
│     ├─ tsconfig.json
│     └─ tsconfig.spec.json
├─ docker-compose.dev.yml
├─ docker-compose.test.yml
├─ docs
│  ├─ Anexo-Tecnico-Factura-Electronica-de-Venta-vr-1-9.md
│  ├─ DEV.md
│  ├─ dian-anexo-v1.9-referencia.md
│  ├─ main.md
│  ├─ MIGRACION-LOCAL-FIRST.md
│  ├─ REFACTORING-PLAN-POS-DESKTOP.md
│  ├─ TESTING-PLAN-POS-DESKTOP.md
│  ├─ TESTING-PLAN.md
│  └─ update-signing-key-rotation.md
├─ opencode.json
├─ package.json
├─ packages
│  ├─ database
│  │  ├─ package.json
│  │  ├─ prisma
│  │  │  ├─ migrations
│  │  │  │  ├─ 20260720000001_add_sync_source
│  │  │  │  │  ├─ migration.json
│  │  │  │  │  └─ migration.sql
│  │  │  │  ├─ 20260721000001_add_client_sync_ops
│  │  │  │  │  ├─ migration.json
│  │  │  │  │  └─ migration.sql
│  │  │  │  ├─ 20260722000001_add_deleted_at_to_user
│  │  │  │  │  └─ migration.sql
│  │  │  │  ├─ 20260723110330_add_product_cost
│  │  │  │  │  ├─ migration.sql
│  │  │  │  │  └─ migration_lock.toml
│  │  │  │  ├─ 20260724000001_add_purchases_config
│  │  │  │  │  └─ migration.sql
│  │  │  │  └─ migration_lock.toml
│  │  │  ├─ schema-source
│  │  │  │  ├─ local-only
│  │  │  │  │  ├─ fiscal.prisma
│  │  │  │  │  ├─ inventory-adjustment.prisma
│  │  │  │  │  ├─ local-audit-log.prisma
│  │  │  │  │  ├─ printing.prisma
│  │  │  │  │  ├─ recovery-log.prisma
│  │  │  │  │  ├─ sale-item.prisma
│  │  │  │  │  ├─ sync-queue.prisma
│  │  │  │  │  └─ updates.prisma
│  │  │  │  ├─ server-only
│  │  │  │  │  ├─ audit-log.prisma
│  │  │  │  │  ├─ auth.prisma
│  │  │  │  │  ├─ auto-expiration-job.prisma
│  │  │  │  │  ├─ client-return.prisma
│  │  │  │  │  ├─ fiscal-config.prisma
│  │  │  │  │  ├─ fiscal-document.prisma
│  │  │  │  │  ├─ fiscal-resolution.prisma
│  │  │  │  │  ├─ licensing.prisma
│  │  │  │  │  ├─ offline-auth.prisma
│  │  │  │  │  ├─ physical-count.prisma
│  │  │  │  │  ├─ prescription.prisma
│  │  │  │  │  ├─ sync-invoice-result.prisma
│  │  │  │  │  ├─ system-config.prisma
│  │  │  │  │  ├─ tenant-config.prisma
│  │  │  │  │  ├─ updates.prisma
│  │  │  │  │  └─ _server-only-enums.prisma
│  │  │  │  └─ shared
│  │  │  │     ├─ cash-shift.prisma
│  │  │  │     ├─ catalog-base.prisma
│  │  │  │     ├─ client.prisma
│  │  │  │     ├─ inventory-adjustment.prisma
│  │  │  │     ├─ inventory-movement.prisma
│  │  │  │     ├─ lot.prisma
│  │  │  │     ├─ payment-method.prisma
│  │  │  │     ├─ product-barcode.prisma
│  │  │  │     ├─ product-cost-history.prisma
│  │  │  │     ├─ product-price-history.prisma
│  │  │  │     ├─ product-tax-history.prisma
│  │  │  │     ├─ product.prisma
│  │  │  │     ├─ purchase-order.prisma
│  │  │  │     ├─ purchase-reception.prisma
│  │  │  │     ├─ sale-item-lot.prisma
│  │  │  │     ├─ sale-item.prisma
│  │  │  │     ├─ sale-payment.prisma
│  │  │  │     ├─ sale.prisma
│  │  │  │     ├─ shift-cash-count.prisma
│  │  │  │     ├─ supplier-return.prisma
│  │  │  │     ├─ supplier.prisma
│  │  │  │     ├─ sync-queue.prisma
│  │  │  │     ├─ tax-scheme.prisma
│  │  │  │     └─ _shared-enums.prisma
│  │  │  ├─ schema.prisma
│  │  │  └─ test-schema
│  │  │     └─ schema.prisma
│  │  ├─ prisma.config.ts
│  │  ├─ prisma.full.config.ts
│  │  ├─ prisma.local.config.ts
│  │  ├─ scripts
│  │  │  ├─ assemble-schema.mjs
│  │  │  ├─ check-enum.ts
│  │  │  ├─ fix-esm-imports.ps1
│  │  │  ├─ fix-generated-imports.ps1
│  │  │  ├─ fix-imports.mjs
│  │  │  ├─ generate-local-sql.mjs
│  │  │  └─ split-schema.mjs
│  │  ├─ src
│  │  │  ├─ full.ts
│  │  │  ├─ index.d.ts
│  │  │  ├─ index.d.ts.map
│  │  │  ├─ index.js
│  │  │  ├─ index.js.map
│  │  │  ├─ index.ts
│  │  │  ├─ local-schema.ts
│  │  │  └─ local.ts
│  │  └─ tsconfig.json
│  ├─ shared-types
│  │  ├─ jest.config.ts
│  │  ├─ package.json
│  │  ├─ src
│  │  │  ├─ auth-types.ts
│  │  │  ├─ cash-shift.ts
│  │  │  ├─ client.ts
│  │  │  ├─ enums.spec.ts
│  │  │  ├─ enums.ts
│  │  │  ├─ fiscal-document.ts
│  │  │  ├─ index.ts
│  │  │  ├─ licensing-enums.ts
│  │  │  ├─ licensing.ts
│  │  │  ├─ local-sync.ts
│  │  │  ├─ plan-seeds.ts
│  │  │  ├─ product.ts
│  │  │  ├─ report.ts
│  │  │  ├─ sale-item.ts
│  │  │  ├─ sale.ts
│  │  │  ├─ sync-queue-entry.ts
│  │  │  ├─ tenant-config.ts
│  │  │  ├─ update-enums.ts
│  │  │  ├─ update-types.ts
│  │  │  ├─ user.ts
│  │  │  └─ wompi.ts
│  │  └─ tsconfig.json
│  └─ shared-validation
│     ├─ jest.config.ts
│     ├─ package.json
│     ├─ src
│     │  ├─ client-schema.spec.ts
│     │  ├─ client-schema.ts
│     │  ├─ create-sale-schema.spec.ts
│     │  ├─ create-sale-schema.ts
│     │  ├─ index.ts
│     │  ├─ invoice-transmission-schema.ts
│     │  ├─ product-schema.spec.ts
│     │  ├─ product-schema.ts
│     │  ├─ user-login-schema.spec.ts
│     │  └─ user-login-schema.ts
│     └─ tsconfig.json
├─ pnpm-lock.yaml
├─ pnpm-workspace.yaml
├─ README.md
├─ scripts
│  ├─ seed-db.ps1
│  ├─ setup-dev.ps1
│  └─ test-e2e.ps1
├─ skills-lock.json
├─ tsconfig.base.json
└─ turbo.json

```