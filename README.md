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