# Plan de Testing — Pharmacy System (Droguería)

**Versión:** 1.4  
**Última actualización:** Julio 2026  
**Estado:** Fase 3B completa — Catalog module testeado, ~215 tests existentes y pasando

---

## Tabla de Contenidos

1. [Estado Actual y Diagnóstico](#1-estado-actual-y-diagnóstico)
2. [Tecnologías de Testing Recomendadas](#2-tecnologías-de-testing-recomendadas)
3. [Configuración de Infraestructura de Testing](#3-configuración-de-infraestructura-de-testing)
   - [3.1 Dependencias a instalar](#31-dependencias-a-instalar)
   - [3.2 Configuración de Jest (apps/server)](#32-configuración-de-jest-appsserver)
   - [3.3 Scripts en package.json](#33-scripts-en-packagejson)
   - [3.4 Configuración de Turborepo](#34-configuración-de-turborepo)
   - [3.5 Configuración de paquetes compartidos](#35-configuración-de-paquetes-compartidos)
4. [Plan de Ejecución por Fases](#4-plan-de-ejecución-por-fases)
5. [Fase 1: Tests Unitarios — Paquetes Compartidos](#5-fase-1-tests-unitarios--paquetes-compartidos)
   - [5.1 shared-validation — Schemas Zod](#51-shared-validation--schemas-zod)
   - [5.2 shared-types — Enums e Interfaces](#52-shared-types--enums-e-interfaces)
6. [Fase 2: Tests Unitarios — Capa Common / Infraestructura](#6-fase-2-tests-unitarios--capa-common--infraestructura)
   - [6.1 ZodValidationPipe](#61-zodvalidationpipe)
   - [6.2 RolesGuard](#62-rolesguard)
   - [6.3 JwtAuthGuard](#63-jwtauthguard)
   - [6.4 HttpExceptionFilter](#64-httpexceptionfilter)
   - [6.5 AuditLogInterceptor](#65-auditloginterceptor)
   - [6.6 env.schema.ts](#66-envschemats)
   - [6.7 PrismaService](#67-prismaservice)
7. [Fase 3: Tests Unitarios — Servicios Core](#7-fase-3-tests-unitarios--servicios-core)
   - [7.1 AuthService](#71-authservice)
   - [7.2 SessionService](#72-sessionservice)
   - [7.3 PasswordHasherService](#73-passwordhasherservice)
   - [7.4 JwtStrategy](#74-jwtstrategy)
   - [7.5 LocalStrategy](#75-localstrategy)
   - [7.6 ProductsService](#76-productsservice)
   - [7.7 CategoriesService](#77-categoriesservice)
   - [7.8 TaxSchemesService](#78-taxschemesservice)
   - [7.9 SalesService](#79-salesservice)
   - [7.10 ClientReturnsService](#710-clientreturnsservice)
   - [7.11 ClientReturnCalculatorService](#711-clientreturncalculatorservice)
   - [7.12 CashShiftService](#712-cashshiftservice)
   - [7.13 ClientsService](#713-clientsservice)
   - [7.14 LotsService](#714-lotsservice)
   - [7.15 ClientReturnCalculatorService](#715-clientreturncalculatorservice)
8. [Fase 4: Tests de Integración — Controladores](#8-fase-4-tests-de-integración--controladores)
   - [8.1 Estructura base de un test de integración](#81-estructura-base-de-un-test-de-integración)
   - [8.2 Controladores a testear](#82-controladores-a-testear)
9. [Fase 5: Tests E2E — Flujos Críticos](#9-fase-5-tests-e2e--flujos-críticos)
   - [9.1 Setup de E2E](#91-setup-de-e2e)
   - [9.2 Flujos E2E](#92-flujos-e2e)
10. [Fase 6: Cobertura, CI/CD y Frontends (Futuro)](#10-fase-6-cobertura-cicd-y-frontends-futuro)
    - [10.1 Thresholds de cobertura](#101-thresholds-de-cobertura)
    - [10.2 Integración CI/CD (GitHub Actions)](#102-integración-cicd-github-actions)
    - [10.3 Tests de Frontends (Futuro)](#103-tests-de-frontends-futuro)
    - [10.4 Tests de apps/fiscal-engine (Futuro)](#104-tests-de-appsfiscal-engine-futuro)
    - [10.5 Utilidades de testing a crear](#105-utilidades-de-testing-a-crear)
11. [Resumen de Estimaciones](#11-resumen-de-estimaciones)
12. [Riesgos Identificados](#12-riesgos-identificados)

---

## 1. Estado Actual y Diagnóstico

| Aspecto | Estado |
|---------|--------|
| Archivos de test (`*.spec.ts`) | **19 archivos, ~215 tests** — todos pasando |
| Configuraciones de test (jest.config) | **LISTO** — `apps/server`, `shared-types`, `shared-validation` tienen jest.config.ts |
| Dependencias de testing instaladas | **LISTO** — `jest`, `ts-jest`, `@nestjs/testing`, `jest-mock-extended`, `supertest` instalados |
| Scripts `test` en sub-packages | **LISTO** — `test`, `test:cov`, `test:watch`, `test:e2e` configurados |
| Cobertura actual | **~20%** (shared-validation + shared-types + common/infra + auth cubiertos) — Meta: ≥80% |
| Servicios con lógica real (testeables) | **~15 servicios** (auth, products, categories, tax-schemes, sales, client-returns, cash-shift, clients, lots, etc.) |
| Servicios con lógica real | **~22 servicios** (incluyendo configuration, fiscal-dian, purchases, reports, sync) |
| Archivos TypeScript en apps/server | **~140 archivos**, ~15,000+ líneas de código |
| Modelos Prisma | **60+ modelos**, **28 enums** |
| Tests existentes (shared-validation) | **43 tests** — client-schema, product-schema, create-sale-schema, user-login-schema |
| Tests existentes (shared-types) | **11 tests** — enums.spec (consistencia contra Prisma) |
| Tests existentes (apps/server) | **~160 tests** — env.schema, ZodValidationPipe, RolesGuard, HttpExceptionFilter, AuditLogInterceptor, PrismaService, AuthService, SessionService, PasswordHasherService, JwtStrategy, LocalStrategy, ProductsService, CategoriesService, TaxSchemesService |
| `PrismaService` typing | **CORREGIDO** — `extends PrismaClient` directamente, acceso tipado completo. Ya no usa `(as any)` |

### Arquitectura del proyecto

```
pharmacy-system/
├── apps/
│   ├── server/          — NestJS 11 backend (11 módulos, ~140 archivos)
│   └── fiscal-engine/   — Microservicio DIAN (scaffold inicial)
├── packages/
│   ├── shared-types/    — Interfaces y enums TypeScript
│   └── shared-validation/ — Schemas Zod
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.base.json
```

### Módulos del backend (apps/server)

| Módulo | Estado de implementación | Archivos |
|--------|-------------------------|----------|
| `auth/` | **FULL** — Autenticación, sesiones, JWT, bloqueo de cuenta | 12 archivos |
| `catalog/` | **MIXTO** — Products/Categories/TaxSchemes: FULL. Facade CatalogService: STUB | 20+ archivos |
| `sales-pos/` | **FULL** — Venta, confirmación, anulación, devoluciones | 12 archivos |
| `cash-shift/` | **FULL** — Apertura, cierre, conteo, force close | 8 archivos |
| `clients/` | **FULL** — CRUD, consentimiento, Habeas Data, clasificación | 8 archivos |
| `inventory-lots/` | **MIXTO** — Core de stock: FULL. Ajustes/Physical Count: STUB | 10 archivos |
| `configuration/` | **FULL** — CRUD con sensitive mask, validación de tipos | 6 archivos |
| `fiscal-dian/` | **FULL** — Documentos fiscales, resoluciones, issuer/tech-provider config | 10 archivos |
| `purchases/` | **FULL** — Órdenes de compra, recepciones, devoluciones a proveedor, proveedores | 10 archivos |
| `reports/` | **FULL** — Reportes de ventas, inventario, análisis por fechas | 6 archivos |
| `sync/` | **FULL** — Sincronización offline con batches, hash validation, dispatcher | 8 archivos |

### Issues encontrados durante el diagnóstico

1. ~~**`PrismaService` no tipado**~~ → **RESUELTO**: `PrismaService` ahora extiende `PrismaClient` directamente. Todos los modelos tienen typing completo. Ya no hay casts `(as any)` en los servicios.
2. ~~**Divergencia shared-validation vs local DTOs**~~ → **RESUELTO**: `catalog.controller.ts` ahora usa `CreateProductSchema` del DTO local en lugar de `ProductSchema` de shared-validation, alineándose con `products.controller.ts`. El schema obsoleto `ProductSchema` en shared-validation queda como candidato a deprecación.
3. ~~**Divergencia de enums**~~ → **RESUELTO**: `shared-types` `PaymentMethodCategory` actualizado: `TRANSFER→BANK_TRANSFER`, `ELECTRONIC_WALLET→DIGITAL_WALLET`, `CREDIT_LINE→CREDIT`. Coincide exactamente con Prisma.
4. ~~**`LoginDto` tiene campo `email`**~~ → **RESUELTO**: `UserLoginSchema` y `LoginDto` ahora usan `username` (no `email`), alineados con `local.strategy.ts` (que usa `usernameField: 'username'` por defecto) y con el campo único `username` en el modelo Prisma `User`.
5. ~~**`noImplicitAny` deshabilitado**~~ → **RESUELTO**: Corregido a `true` en `apps/server/tsconfig.json`, cumpliendo con el strict mode documentado.

---

## 2. Tecnologías de Testing Recomendadas

Según los archivos `.opencode/agents/*.md`, `AGENTS.md` y `README.md`, las tecnologías especificadas son:

### Backend (`apps/server`, `apps/fiscal-engine`)

| Herramienta | Propósito | Versión recomendada |
|-------------|-----------|---------------------|
| **Jest** | Test runner + assertions + mocks | v30+ (con soporte ESM nativo) |
| **ts-jest** | Transform TypeScript ESM para Jest | v29.3+ (compatible con TypeScript 6) |
| **@types/jest** | Tipos TypeScript para Jest | v30+ |
| **@nestjs/testing** | `Test.createTestingModule` para NestJS DI | v11+ |
| **jest-mock-extended** | Mocks tipados (`mockDeep`, `mockReset`) — esencial dado el uso de `any` en `PrismaService` | v4+ |
| **supertest** | HTTP assertions para tests E2E | v7+ |
| **@types/supertest** | Tipos para supertest | v6+ |
| **Istanbul** (built-in en Jest) | Cobertura de código | Integrado en Jest |

### Por qué Jest y no Vitest para el backend

- NestJS tiene integración oficial con Jest (`@nestjs/testing` + `jest`)
- El ecosistema NestJS (schematics, CLI) genera tests con Jest por defecto
- `ts-jest` tiene soporte maduro para decoradores y metadatos (`emitDecoratorMetadata`)
- La documentación del proyecto (`AGENTS.md`, `backend.md`) especifica explícitamente Jest

### Frontends (futuro — no existen aún)

| Herramienta | Propósito |
|-------------|-----------|
| **Vitest** | Test runner (más rápido que Jest para Vite, mismo API) |
| **@testing-library/react** | Tests de componentes React |
| **@testing-library/user-event** | Simulación de interacciones de usuario |
| **@testing-library/jest-dom** | Matchers adicionales (toBeInTheDocument, etc.) |
| **Playwright** | Tests E2E multi-navegador |
| **msw** (Mock Service Worker) | Mock de API para tests de integración de frontend |

---

## 3. Configuración de Infraestructura de Testing

### 3.1 Dependencias a instalar

#### Root (`package.json`)

No requiere dependencias de testing. Solo orquestación vía Turborepo.

#### `apps/server/package.json` — devDependencies

```json
"jest": "^30.2.0",
"ts-jest": "^29.3.4",
"@types/jest": "^30.0.0",
"@nestjs/testing": "^11.1.27",
"jest-mock-extended": "^4.0.1",
"supertest": "^7.1.0",
"@types/supertest": "^6.0.3"
```

#### `packages/shared-validation/package.json` — devDependencies

```json
"jest": "^30.2.0",
"ts-jest": "^29.3.4",
"@types/jest": "^30.0.0"
```

#### `packages/shared-types/package.json` — devDependencies

```json
"jest": "^30.2.0",
"ts-jest": "^29.3.4",
"@types/jest": "^30.0.0"
```

#### `apps/fiscal-engine/package.json` — devDependencies (futuro)

```json
"jest": "^30.2.0",
"ts-jest": "^29.3.4",
"@types/jest": "^30.0.0",
"@nestjs/testing": "^11.1.27",
"jest-mock-extended": "^4.0.1"
```

### 3.2 Configuración de Jest (`apps/server/jest.config.ts`)

```typescript
import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
      useESM: true,
    }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@pharmacy/shared-types$':
      '<rootDir>/../../packages/shared-types/src/index.ts',
    '^@pharmacy/shared-validation$':
      '<rootDir>/../../packages/shared-validation/src/index.ts',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    // Excluir archivos sin lógica ejecutable
    '!src/**/index.ts',
    '!src/**/*.module.ts',
    '!src/**/*.schema.ts',
    '!src/**/*.exception.ts',
    '!src/**/*.entity.ts',
    '!src/**/*.constants.ts',
    '!src/**/*.dto.ts',
    '!src/main.ts',
    '!src/app.module.ts',
  ],
  coverageDirectory: './coverage',
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};

export default config;
```

**Notas sobre la configuración:**

- `useESM: true` — Necesario porque el proyecto usa `"type": "module"` implícito con ES modules.
- `moduleNameMapper` — Resuelve los path aliases `@/*` y `@pharmacy/*` que usa el código fuente.
- `collectCoverageFrom` — Solo archivos con lógica ejecutable. Se excluyen barrel exports, módulos NestJS (pura configuración DI), schemas Zod (declarativos), excepciones (constructores vacíos), type aliases, constantes y entry points.
- `coverageThreshold` — **80% global** como exige `backend.md:58`.

### 3.3 Scripts en package.json

#### `apps/server/package.json`

```json
{
  "scripts": {
    "build": "nest build",
    "dev": "nest start --watch",
    "start": "node dist/main.js",
    "test": "jest --forceExit --detectOpenHandles",
    "test:cov": "jest --coverage --forceExit --detectOpenHandles",
    "test:watch": "jest --watch",
    "test:e2e": "jest --config jest.e2e.config.ts --forceExit --detectOpenHandles",
    "lint": "eslint src --ext .ts",
    "typecheck": "tsc --noEmit",
    "prisma:generate": "prisma generate",
    "prisma:migrate:dev": "prisma migrate dev",
    "prisma:migrate:deploy": "prisma migrate deploy",
    "prisma:studio": "prisma studio"
  }
}
```

- `--forceExit` — Evita que Jest quede colgado por handles abiertos (conexiones de BD, timers).
- `--detectOpenHandles` — Diagnostica qué recurso mantiene el proceso abierto.

#### `packages/shared-validation/package.json`

```json
{
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "jest --forceExit",
    "test:watch": "jest --watch"
  }
}
```

#### `packages/shared-types/package.json`

```json
{
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "jest --forceExit",
    "test:watch": "jest --watch"
  }
}
```

### 3.4 Configuración de Turborepo

Agregar las tareas de test en `turbo.json`:

```json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^build"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "test:cov": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "test:watch": {
      "cache": false,
      "persistent": true
    },
    "test:e2e": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    }
  }
}
```

### 3.5 Configuración de paquetes compartidos

#### `packages/shared-types/jest.config.ts`

```typescript
import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/index.ts',
  ],
};

export default config;
```

#### `packages/shared-validation/jest.config.ts`

```typescript
import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/index.ts',
  ],
};

export default config;
```

---

## 4. Plan de Ejecución por Fases

El plan se ejecuta en **6 fases**, priorizando lo que ya tiene lógica de negocio implementada.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Fase 1: Paquetes Compartidos  ████████████████████  1-2 días   ~55  │ ✅ COMPLETO
│ Fase 2: Capa Infraestructura  ████████████████████  2-3 días   ~44  │ ✅ COMPLETO
│ Fase 3A: Auth                 ████████████████████  2-3 días   ~58  │ ✅ COMPLETO
│ Fase 3B: Catalog              ████████████████████  2 días     ~58  │ ✅ COMPLETO
│ Fase 3C: Resto servicios      ░░░░░░░░░░░░░░░░░░░░  3-4 días   ~35  │ 🔴 PENDIENTE
│ Fase 4: Controladores         ░░░░░░░░░░░░░░░░░░░░  3-4 días   ~72  │ 🔴 PENDIENTE
│ Fase 5: Tests E2E             ░░░░░░░░░░░░░░░░░░░░  3-4 días   ~24  │ 🔴 PENDIENTE
│ Fase 6: CI/CD + Utilidades    ░░░░░░░░░░░░░░░░░░░░  2-3 días    --  │ 🔴 PENDIENTE
├──────────────────────────────────────────────────────────────────────┤
│ TOTAL IMPLEMENTADO: ~215 tests / ~300+ estimados (10-13 días restantes)│
└──────────────────────────────────────────────────────────────────────┘
```

### Orden cronológico recomendado (actualizado)

```
Día 1:     Instalar dependencias + jest config + shared-validation tests          ← COMPLETADO
Día 2:     enums.spec.ts + Fase 2 (ZodValidationPipe, RolesGuard)                ← COMPLETADO
Día 3-4:   Fase 2 (HttpExceptionFilter, AuditLogInterceptor, PrismaService)      ← COMPLETADO
Día 5-6:   Fase 3A: Auth (AuthService + SessionService + PasswordHasher + JwtStrategy + LocalStrategy)   ← COMPLETADO
Día 7-8:   Fase 3B: Catalog (ProductsService + CategoriesService + TaxSchemesService)                     ← COMPLETADO
Día 9-11:  Fase 3C: Sales + Cash + Clients + Inventory (servicios principales)
Día 12-13: Fase 3C (continuación: LotsService, ClientReturnCalculatorService)
Día 14-16: Fase 4: Controladores de integración
Día 17-20: Fase 5: E2E flujos críticos
Día 21-22: Fase 6: CI/CD, threshold de cobertura, documentación
```

---

## 5. Fase 1: Tests Unitarios — Paquetes Compartidos

**Objetivo:** Validar schemas Zod y consistencia de enums. Establecer la base de testing antes de abordar el backend.

### 5.1 shared-validation — Schemas Zod

**Estado:** ✅ **IMPLEMENTADO** — 4 spec files, 44 tests pasando.

Cada schema tiene reglas de validación específicas. Ubicación de tests: al lado del fuente.

```
packages/shared-validation/src/
├── product-schema.ts
├── product-schema.spec.ts        ← EXISTE (94 líneas, 10 escenarios)
├── client-schema.ts
├── client-schema.spec.ts         ← EXISTE (104 líneas, 9 escenarios)
├── create-sale-schema.ts
├── create-sale-schema.spec.ts    ← EXISTE (212 líneas, 16 escenarios)
├── user-login-schema.ts
├── user-login-schema.spec.ts     ← EXISTE (80 líneas, 9 escenarios)
└── index.ts
```

> **Nota:** Las tablas siguientes reflejan los tests **realmente implementados**, que pueden diferir del diseño original del plan. Los schemas reales tienen prioridad.

#### ProductSchema — Casos de test implementados

| ID | Escenario | Entrada | Esperado |
|----|-----------|---------|----------|
| SHV-P01 | Datos completos válidos | `{ name, genericName, barcode, invimaCertificate, saleType: "FREE_SALE", requiresPrescription, currentStock, minimumStock, purchasePrice, sellingPrice, taxPercentage, expirationDate }` | Parse exitoso |
| SHV-P02 | `name` vacío | `name: ""` | `ZodError` (min 1) |
| SHV-P03 | `name` excede 255 chars | `name: "x".repeat(256)` | `ZodError` (max 255) |
| SHV-P04 | `genericName` vacío | `genericName: ""` | `ZodError` |
| SHV-P05 | `currentStock` negativo | `currentStock: -1` | `ZodError` (nonnegative) |
| SHV-P06 | `currentStock` no entero | `currentStock: 10.5` | `ZodError` (int) |
| SHV-P07 | `purchasePrice` sin decimales | `purchasePrice: "800"` | Parse exitoso (regex permite decimales opcionales) |
| SHV-P08 | `sellingPrice` con letras | `sellingPrice: "abc"` | `ZodError` |
| SHV-P09 | `saleType` inválido | `saleType: "INVALID"` | `ZodError` |
| SHV-P10 | `expirationDate` no datetime | `expirationDate: "not-a-date"` | `ZodError` |

#### ClientSchema — Casos de test implementados

| ID | Escenario | Entrada | Esperado |
|----|-----------|---------|----------|
| SHV-C01 | Datos completos válidos | `{ firstName: "Juan", lastName: "Pérez", identificationType: "CC", identificationNumber: "1234567890", email: "juan@email.com", phone: "3101234567", address: "Calle 123" }` | Parse exitoso |
| SHV-C02 | `identificationType` inválido | `identificationType: "XX"` | `ZodError` |
| SHV-C03 | `firstName` vacío | `firstName: ""` | `ZodError` |
| SHV-C04 | `firstName` > 100 chars | `firstName: "x".repeat(101)` | `ZodError` (max 100) |
| SHV-C05 | `lastName` vacío | `lastName: ""` | `ZodError` |
| SHV-C06 | `identificationNumber` vacío | `identificationNumber: ""` | `ZodError` |
| SHV-C07 | `identificationNumber` > 20 chars | `identificationNumber: "1".repeat(21)` | `ZodError` (max 20) |
| SHV-C08 | `email` formato inválido | `email: "notanemail"` | `ZodError` |
| SHV-C09 | `phone` > 20 chars | `phone: "x".repeat(21)` | `ZodError` (max 20) |
| SHV-C10 | Campos opcionales omitidos | Solo `firstName`, `lastName`, `identificationType`, `identificationNumber` | Parse exitoso, `email` y `phone` son `undefined` |

> **Nota:** El schema real usa `firstName`/`lastName` (no `fullName` como en el diseño original).

#### CreateSaleSchema — Casos de test implementados

| ID | Escenario | Entrada | Esperado |
|----|-----------|---------|----------|
| SHV-S01 | Venta con 1 item válido | `{ saleType: "FREE_SALE", cashShiftId: "<uuid>", items: [{ productId: "<uuid>", quantity: 2, unitPrice: "5000.00" }] }` | Parse exitoso |
| SHV-S02 | Venta con múltiples items | `items: [item1, item2]` con 2 items | Parse exitoso, `items.length === 2` |
| SHV-S03 | `clientId` opcional incluido | `clientId: "<uuid>"` | Parse exitoso |
| SHV-S04 | `prescriptionNumber` opcional | `prescriptionNumber: "RX-2024-001"` | Parse exitoso |
| SHV-S05 | Item con `discount` | `discount: "500.00"` | Parse exitoso |
| SHV-S06 | Sin items (`items: []`) | `items: []` | `ZodError` (min 1) |
| SHV-S07 | `quantity` negativo | `quantity: -1` | `ZodError` (positive) |
| SHV-S08 | `quantity` cero | `quantity: 0` | `ZodError` (positive) |
| SHV-S09 | `quantity` no entero | `quantity: 1.5` | `ZodError` (int) |
| SHV-S10 | `unitPrice` no numérico | `unitPrice: "abc"` | `ZodError` (regex) |
| SHV-S11 | `productId` no UUID | `productId: "not-a-uuid"` | `ZodError` (uuid) |
| SHV-S12 | `cashShiftId` no UUID | `cashShiftId: "not-a-uuid"` | `ZodError` (uuid) |
| SHV-S13 | `saleType` inválido | `saleType: "INVALID"` | `ZodError` |
| SHV-S14 | `discount` no numérico | `discount: "abc"` | `ZodError` (regex) |
| SHV-S15 | `clientId` no UUID | `clientId: "not-a-uuid"` | `ZodError` (uuid) |

> **Nota:** El schema real usa `saleType`, `cashShiftId` y `discount` (no `workstationId` ni `discountPercentage` como en el diseño original).

#### UserLoginSchema — Casos de test implementados

| ID | Escenario | Entrada | Esperado |
|----|-----------|---------|----------|
| SHV-L01 | Credenciales válidas | `{ username: "admin", password: "secret123" }` | Parse exitoso |
| SHV-L02 | `username` vacío | `username: ""` | `ZodError` |
| SHV-L03 | `password` < 8 caracteres | `password: "1234567"` | `ZodError` (min 8) |
| SHV-L04 | `password` vacío | `password: ""` | `ZodError` |
| SHV-L05 | `password` mínimo exacto | `password: "12345678"` | Parse exitoso |
| SHV-L06 | `username` ausente | Solo `password` | `ZodError` |
| SHV-L07 | `password` ausente | Solo `username` | `ZodError` |
| SHV-L08 | Objeto vacío | `{}` | `ZodError` |

> **Nota:** El schema real exige password `min(8)` (no `min(1)` como en el diseño original). El campo `username` reemplazó a `email` para alinearse con el modelo Prisma (`username` es único) y con passport-local (usa `usernameField: 'username'` por defecto).

### 5.2 shared-types — Enums e Interfaces

**Estado:** ✅ **IMPLEMENTADO** — 1 spec file, 11 tests pasando.

Las interfaces TypeScript puras no requieren tests unitarios (el compilador las verifica). Los enums se verifican contra Prisma para detectar divergencias temprano.

**Tests de consistencia de enums:**

```
packages/shared-types/src/
├── enums.spec.ts    ← EXISTE (11 escenarios)
└── enums.ts
```

| ID | Escenario | Verificación | Estado |
|----|-----------|-------------|--------|
| SHT-E01 | `RoleType` coincide con Prisma | Todos los valores de `RoleType` existen en el enum Prisma `RoleType` | ✅ Pasa |
| SHT-E02 | `SaleOperationalState` coincide con Prisma | Subconjunto de Prisma `SaleOperationalState` | ✅ Pasa |
| SHT-E03 | `FiscalDocumentType` coincide con Prisma | Subconjunto de Prisma `FiscalDocumentType` | ✅ Pasa |
| SHT-E04 | `PaymentMethodCategory` coincide con Prisma | Mapeo 1:1 | ✅ Pasa — `TRANSFER→BANK_TRANSFER`, `ELECTRONIC_WALLET→DIGITAL_WALLET`, `CREDIT_LINE→CREDIT` |
| SHT-E05 | `SaleType` coincide con Prisma | Subconjunto de Prisma `SaleType` | ✅ Pasa |
| SHT-E06 | `IdentificationType` coincide con Prisma | Subconjunto de Prisma `IdentificationType` | ✅ Pasa |
| SHT-E07 | `FiscalDocumentState` coincide con Prisma | Subconjunto de Prisma `FiscalDocumentState` | ✅ Pasa |
| SHT-E08 | `SystemModule` coincide con Prisma | Subconjunto de Prisma `SystemModule` | ✅ Pasa |
| SHT-E09 | `AuditAction` coincide con Prisma | Subconjunto de Prisma `AuditAction` | ✅ Pasa |
| SHT-E10 | `TaxSchemeType` coincide con Prisma | Subconjunto de Prisma `TaxSchemeType` | ✅ Pasa |
| SHT-E11 | `PaymentMethodCategory` no tiene valores duplicados | Set de valores | ✅ Pasa |

**Nota:** Estos tests **no requieren** acceso a Prisma client. Se implementan comparando strings de los valores de los enums directamente. Se agregó un test adicional de unicidad (SHT-E11) para prevenir valores duplicados en `PaymentMethodCategory`.

---

## 6. Fase 2: Tests Unitarios — Capa Common / Infraestructura

**Objetivo:** Probar pipes, guards, filters, interceptors y validación de configuración. Son componentes reutilizables por todos los módulos.

**Estado:** ✅ **IMPLEMENTADO** — 6 spec files, ~44 tests pasando.

Ubicación de tests: al lado del fuente.

```
apps/server/src/common/
├── pipes/
│   ├── zod-validation.pipe.ts
│   └── zod-validation.pipe.spec.ts          ← EXISTE
├── guards/
│   ├── jwt-auth.guard.ts
│   ├── roles.guard.ts
│   └── roles.guard.spec.ts                  ← EXISTE
├── filters/
│   ├── http-exception.filter.ts
│   └── http-exception.filter.spec.ts        ← EXISTE
├── interceptors/
│   ├── audit-log.interceptor.ts
│   └── audit-log.interceptor.spec.ts        ← EXISTE
├── exceptions/
│   ├── domain.exception.ts
│   └── domain.exception.spec.ts             ← (no requiere — excepciones sin lógica ejecutable)
└── decorators/
    (decoradores no requieren tests unitarios — son setters de metadata)

apps/server/src/config/
├── env.schema.ts
└── env.schema.spec.ts                       ← EXISTE
```

### 6.1 ZodValidationPipe

**Estado:** ✅ **IMPLEMENTADO** — 9 tests pasando.
**Archivo:** `apps/server/src/common/pipes/zod-validation.pipe.spec.ts`

El pipe recibe un `ZodSchema` en el constructor y valida/transforma el body de las peticiones.

| ID | Escenario | Entrada | Esperado |
|----|-----------|---------|----------|
| ZVP-01 | Input válido — objeto completo | `{ username: "test", password: "12345678" }` con `UserLoginSchema` | Retorna el objeto sin cambios |
| ZVP-02 | Input inválido — campo faltante | `{ email: "test@test.com" }` con `UserLoginSchema` (falta password) | Lanza `BadRequestException` con `{ message: 'Validation failed', errors: [...] }` |
| ZVP-03 | Input inválido — tipo incorrecto | `{ email: 123, password: "abc" }` | Lanza `BadRequestException` con errores estructurados |
| ZVP-04 | Input inválido — string vacío | `{ email: "", password: "123" }` | Lanza `BadRequestException` |
| ZVP-05 | String simple válido | `"hello"` con `z.string()` | Retorna el string |
| ZVP-06 | Valor no-string | `123` con `z.string()` | Lanza `BadRequestException` |
| ZVP-07 | Número válido | `42` con `z.number()` | Retorna el número |
| ZVP-08 | Transformación Zod aplicada | `"123"` con `z.string().transform(s => parseInt(s, 10))` | Retorna `123` (número) |
| ZVP-09 | Metadatos correctos en pipe | Verificar que el pipe implementa `PipeTransform` | Tiene método `transform(value, metadata)` |

**Setup del test:**

```typescript
import { ZodValidationPipe } from './zod-validation.pipe';
import { z } from 'zod';
import { BadRequestException } from '@nestjs/common';

describe('ZodValidationPipe', () => {
  it('should return the value when validation passes', () => {
    const schema = z.object({ name: z.string() });
    const pipe = new ZodValidationPipe(schema);
    const result = pipe.transform({ name: 'test' }, { type: 'body' });
    expect(result).toEqual({ name: 'test' });
  });
  // ... resto de tests
});
```

### 6.2 RolesGuard

**Estado:** ✅ **IMPLEMENTADO** — 7 tests pasando.
**Archivo:** `apps/server/src/common/guards/roles.guard.spec.ts`

36 líneas de lógica real. Lee los roles requeridos del decorador `@Roles()` y compara contra `request.user.role`.

| ID | Escenario | Setup | Esperado |
|----|-----------|-------|----------|
| RG-01 | Sin decorador `@Roles` en el handler | `reflector.getAllAndOverride` → `undefined` | Retorna `true` (permite acceso — no hay restricción) |
| RG-02 | Rol del usuario coincide | `requiredRoles = ['ADMIN']`, `user.role = 'ADMIN'` | Retorna `true` |
| RG-03 | Rol del usuario NO coincide | `requiredRoles = ['ADMIN']`, `user.role = 'CASHIER'` | Lanza `ForbiddenException` |
| RG-04 | Sin usuario en request | `requiredRoles = ['ADMIN']`, `request.user = undefined` | Lanza `ForbiddenException` |
| RG-05 | Múltiples roles, uno coincide | `requiredRoles = ['ADMIN', 'INVENTORY_ASSISTANT']`, `user.role = 'INVENTORY_ASSISTANT'` | Retorna `true` |
| RG-06 | Usuario con `role` pero sin roles requeridos | `requiredRoles = []` | Retorna `true` (sin restricción) |
| RG-07 | Metadata obtenida de class + handler | `reflector.getAllAndOverride` une roles de clase y método | Prioridad del handler sobre la clase |

**Setup del test:**

```typescript
import { RolesGuard } from './roles.guard';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  function createMockContext(user?: { role?: string }): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  it('should return true when no roles are required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const ctx = createMockContext({ role: 'CASHIER' });
    expect(guard.canActivate(ctx)).toBe(true);
  });
  // ... resto de tests
});
```

### 6.3 JwtAuthGuard

5 líneas — extiende `AuthGuard('jwt')` de Passport sin lógica adicional. No requiere test unitario. Se prueba indirectamente en los tests de integración de controladores y en E2E.

### 6.4 HttpExceptionFilter

**Estado:** ✅ **IMPLEMENTADO** — 12 tests pasando.
**Archivo:** `apps/server/src/common/filters/http-exception.filter.spec.ts`

86 líneas. Formatea todas las excepciones HTTP en una respuesta estandarizada.

| ID | Escenario | Excepción lanzada | Esperado en respuesta |
|----|-----------|-------------------|----------------------|
| HEF-01 | `DomainException` con errorCode | `new ProductNotFoundException('abc-123')` con `statusCode=404` | `{ errorCode: 'PRODUCT_NOT_FOUND', message: 'Product abc-123 not found', statusCode: 404, timestamp: '<ISO>', path: '/products/abc-123' }` |
| HEF-02 | `DomainException` sin errorCode (genérico) | `new DomainException({ message: 'Error genérico', statusCode: 400 })` | `{ errorCode: 'DOMAIN_ERROR', message: 'Error genérico', statusCode: 400, ... }` |
| HEF-03 | `BadRequestException` de NestJS | `new BadRequestException('Datos inválidos')` | `{ errorCode: 'BAD_REQUEST', message: 'Datos inválidos', statusCode: 400, ... }` |
| HEF-04 | `ForbiddenException` de NestJS | `new ForbiddenException()` | `{ errorCode: 'FORBIDDEN', message: 'Forbidden', statusCode: 403, ... }` |
| HEF-05 | `NotFoundException` de NestJS | `new NotFoundException('Recurso no hallado')` | `{ errorCode: 'NOT_FOUND', message: 'Recurso no hallado', statusCode: 404, ... }` |
| HEF-06 | `UnauthorizedException` de NestJS | `new UnauthorizedException('Token inválido')` | `{ errorCode: 'UNAUTHORIZED', message: 'Token inválido', statusCode: 401, ... }` |
| HEF-07 | `HttpException` con string como response | `new HttpException('plain string error', 400)` | `{ errorCode: 'BAD_REQUEST', message: 'plain string error', statusCode: 400, ... }` |
| HEF-08 | `HttpException` con objeto como response | `new HttpException({ custom: 'error' }, 422)` | `{ errorCode: 'UNPROCESSABLE_ENTITY', message: '{"custom":"error"}', statusCode: 422, ... }` |
| HEF-09 | Código HTTP no mapeado explícitamente | `new HttpException('error', 418)` | `{ errorCode: 'INTERNAL_SERVER_ERROR', statusCode: 418, ... }` — usa el fallback genérico |
| HEF-10 | Timestamp presente en respuesta | Cualquier excepción | `response.timestamp` es string ISO 8601 |
| HEF-11 | Path extraído correctamente | Request a `/api/products/123` | `response.path = '/api/products/123'` |
| HEF-12 | Log de error en consola | Cualquier excepción | `console.error` fue llamado con stack trace |

**Setup del test:**

```typescript
import { HttpExceptionFilter } from './http-exception.filter';
import { HttpException, ArgumentsHost } from '@nestjs/common';

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
  });

  function createMockArgumentsHost(
    exception: HttpException,
    url = '/test',
  ): ArgumentsHost {
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    const request = { url };
    return {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    } as unknown as ArgumentsHost;
  }

  it('should format DomainException correctly', () => {
    const exception = new ProductNotFoundException('abc');
    const host = createMockArgumentsHost(exception);
    filter.catch(exception, host);

    const response = host.switchToHttp().getResponse();
    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: 'PRODUCT_NOT_FOUND',
        statusCode: 404,
      }),
    );
  });
  // ... resto de tests
});
```

### 6.5 AuditLogInterceptor

**Estado:** ✅ **IMPLEMENTADO** — 21 tests pasando.
**Archivo:** `apps/server/src/common/interceptors/audit-log.interceptor.spec.ts`

108 líneas. Intercepta mutaciones (POST/PATCH/PUT/DELETE) y crea registros de auditoría vía PrismaService. Patrón fire-and-forget.

| ID | Escenario | Método HTTP | Setup | Esperado |
|----|-----------|-------------|-------|----------|
| ALI-01 | Mutación con `@Auditable` | POST | `@Auditable({ action: CREATE, module: CATALOG, entityType: 'Product' })` | `prismaService.auditLog.create` fue llamado con los datos correctos. La request continúa normalmente. |
| ALI-02 | Mutación sin `@Auditable` | POST | Sin decorador en handler ni clase | `prismaService.auditLog.create` NO fue llamado. La request continúa. |
| ALI-03 | GET (no mutación) | GET | `@Auditable(...)` presente | `prismaService.auditLog.create` NO fue llamado (solo métodos mutantes). |
| ALI-04 | HEAD (no mutación) | HEAD | `@Auditable(...)` presente | `prismaService.auditLog.create` NO fue llamado. |
| ALI-05 | Error en creación de audit log | POST | `prismaService.auditLog.create` lanza error | La request original continúa sin error (fire-and-forget). El error se loguea pero no se propaga. |
| ALI-06 | Extrae entityId de URL | POST a `/products/uuid-123` | `@Auditable({ entityType: 'Product' })` | `auditLog.entityId = 'uuid-123'` |
| ALI-07 | Extrae IP y User-Agent | POST | Headers: `x-forwarded-for`, `user-agent` | `auditLog.ipAddress` e `ipAddress` y `userAgent` incluidos |
| ALI-08 | Rol de usuario denormalizado | POST | `request.user.role = 'ADMIN'` | `auditLog.userRole = 'ADMIN'` |
| ALI-09 | DELETE registra correctamente | DELETE | `@Auditable({ action: DELETE, module: CATALOG })` | `auditLog.action = 'DELETE'` |
| ALI-10 | PATCH registra correctamente | PATCH | `@Auditable({ action: UPDATE, module: CATALOG })` | `auditLog.action = 'UPDATE'` |
| ALI-11 | correlationId incluido | POST | — | `auditLog.correlationId` es un string no vacío |
| ALI-12 | userId extraído correctamente | POST | `request.user.id = 'user-99'` | `auditLog.userId = 'user-99'` |

**Setup del test:**

```typescript
import { AuditLogInterceptor } from './audit-log.interceptor';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';

describe('AuditLogInterceptor', () => {
  let interceptor: AuditLogInterceptor;
  let prismaService: jest.Mocked<PrismaService>;
  let reflector: Reflector;

  beforeEach(() => {
    prismaService = { auditLog: { create: jest.fn() } } as any;
    reflector = new Reflector();
    interceptor = new AuditLogInterceptor(prismaService, reflector);
  });

  function createMockContext(method: string, url: string, user?: any) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          url,
          user: user || { id: 'u1', role: 'ADMIN' },
          headers: { 'x-forwarded-for': '192.168.1.1', 'user-agent': 'test' },
        }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as any;
  }

  it('should create audit log for POST with @Auditable', async () => {
    const ctx = createMockContext('POST', '/products/123');
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
      action: 'CREATE',
      module: 'CATALOG',
      entityType: 'Product',
    });

    await interceptor.intercept(ctx, { handle: () => of({}) }).toPromise();

    expect(prismaService.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE', entityId: '123' }),
    );
  });
  // ... resto de tests
});
```

### 6.6 env.schema.ts

**Estado:** ✅ **IMPLEMENTADO** — 10 tests pasando.
**Archivo:** `apps/server/src/config/env.schema.spec.ts`

| ID | Escenario | Entrada | Esperado |
|----|-----------|---------|----------|
| ENV-01 | Todas las variables requeridas presentes | `{ DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, PORT, NODE_ENV, REDIS_URL }` | Parse exitoso |
| ENV-02 | `DATABASE_URL` faltante | Sin `DATABASE_URL` | `ZodError` |
| ENV-03 | `JWT_ACCESS_SECRET` faltante | Sin `JWT_ACCESS_SECRET` | `ZodError` |
| ENV-04 | `JWT_REFRESH_SECRET` faltante | Sin `JWT_REFRESH_SECRET` | `ZodError` |
| ENV-05 | `NODE_ENV` inválido | `NODE_ENV=invalid` | `ZodError` (solo `development` / `production` / `test`) |
| ENV-06 | `PORT` no numérico | `PORT=abc` | `ZodError` |
| ENV-07 | `PORT` fuera de rango | `PORT=0` | `ZodError` (mínimo 1) |
| ENV-08 | Valores por defecto aplicados | Solo `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | `PORT=3000`, `NODE_ENV=development`, `REDIS_URL=redis://localhost:6379`, `JWT_ACCESS_TTL_SECONDS=900`, `JWT_REFRESH_TTL_SECONDS=604800` |
| ENV-09 | `REDIS_URL` inválido (no URL) | `REDIS_URL=not_a_url` | `ZodError` |
| ENV-10 | `JWT_ACCESS_TTL_SECONDS` no numérico | `JWT_ACCESS_TTL_SECONDS=abc` | `ZodError` |

### 6.7 PrismaService

**Estado:** ✅ **IMPLEMENTADO** — 3 tests pasando.
**Archivo:** `apps/server/src/infrastructure/prisma/prisma.service.spec.ts`

| ID | Escenario | Esperado |
|----|-----------|----------|
| PRIS-01 | `onModuleInit` llama `$connect()` | `prisma.$connect` fue invocado |
| PRIS-02 | `onModuleDestroy` llama `$disconnect()` en BEFORE_EXIT | `prisma.$disconnect` fue invocado |
| PRIS-03 | Getters exponen modelos correctamente | `service.user` no es undefined, `service.userSession` no es undefined, `service.auditLog` no es undefined |
| PRIS-04 | PrismaClient se crea lazy | Antes de `onModuleInit`, `$connect` no fue llamado aún |

---

## 7. Fase 3: Tests Unitarios — Servicios Core

**Objetivo:** Probar la lógica de negocio de cada servicio de forma aislada. Es la fase más grande y la que más cobertura aportará.

**Estrategia de mocking:**
- `PrismaService` se mockea con `jest-mock-extended` (`mockDeep<PrismaClient>`)
- `JwtService` se mockea para `signAsync`, `verifyAsync`
- `ConfigService` se mockea para `get()`
- `Queue` (BullMQ) se mockea para `add()`
- Servicios dependientes (ej. `LotsService` dentro de `SalesService`) se mockean con `jest-mock-extended`

**Ubicación de tests:**

```
apps/server/src/modules/<module>/services/
├── <service>.service.ts
└── <service>.service.spec.ts    ← nuevo (al lado del fuente)
```

### 7.1 AuthService

**Estado:** ✅ **IMPLEMENTADO** — 30 tests pasando.
**Archivo:** `apps/server/src/modules/auth/auth.service.spec.ts`

198 líneas. El servicio más completo y crítico. Requiere la mayor cantidad de tests.

**Dependencias a mockear:** `PrismaService` (user, userSession), `PasswordHasherService`, `SessionService`, `JwtService`, `ConfigService`

#### Grupo A: `validateCredentials(email, password)`

| ID | Escenario | Setup | Esperado |
|----|-----------|-------|----------|
| AUTH-01 | Login exitoso | Usuario existe, `isActive=true`, password correcto, `lockedUntil=null` | Retorna `UserSessionDto` con datos del usuario (sin `passwordHash`) |
| AUTH-02 | Usuario no encontrado | `prismaService.user.findUnique` → `null` | Lanza `InvalidCredentialsException` |
| AUTH-03 | Password incorrecto | `passwordHasher.verify` → `false` | Lanza `InvalidCredentialsException` |
| AUTH-04 | Cuenta inactiva | `user.isActive = false` | Lanza `AccountInactiveException` |
| AUTH-05 | Cuenta bloqueada (lock activo) | `user.lockedUntil` > ahora | Lanza `AccountLockedException` |
| AUTH-06 | Login fallido incrementa contador | Password incorrecto, `failedLoginAttempts` previo = 2 | `failedLoginAttempts` se actualiza a 3 |
| AUTH-07 | 5 intentos fallidos → bloqueo | `failedLoginAttempts` llega a 5 | `lockedUntil = now + 15 min` (según `ACCOUNT_LOCK_DURATION_MINUTES`) |
| AUTH-08 | Lock temporal expira | `lockedUntil` en el pasado, password correcto | No lanza `AccountLockedException`, permite login |
| AUTH-09 | Login exitoso resetea contador | `failedLoginAttempts = 3` antes del login correcto | `failedLoginAttempts = 0`, `lockedUntil = null` |
| AUTH-10 | 4 intentos fallidos, no bloquea aún | `failedLoginAttempts` llega a 4 | `lockedUntil` sigue `null` (solo bloquea al 5to) |

#### Grupo B: `issueSession(user)`

| ID | Escenario | Setup | Esperado |
|----|-----------|-------|----------|
| AUTH-11 | Sesión creada con JWT válido | Usuario `{ id: 'u1', role: 'ADMIN', username: 'admin' }` | Retorna `AuthResponseDto` con `accessToken`, `refreshToken`, `expiresAt`, `user` |
| AUTH-12 | Token contiene claims correctos | Mismo setup | `jwtService.signAsync` fue llamado con payload `{ sub: 'u1', role: 'ADMIN', username: 'admin' }` |
| AUTH-13 | `accessToken` TTL según config | `configService.get('JWT_ACCESS_TTL_SECONDS')` → `'900'` | `expiresAt` ≈ `now + 900s` |
| AUTH-14 | `refreshToken` TTL diferente | `configService.get('JWT_REFRESH_TTL_SECONDS')` → `'604800'` | `jwtService.signAsync` para refresh usa `expiresIn: '604800s'` |
| AUTH-15 | `SessionService.create` llamado | — | `sessionService.create` llamado con `userId`, `tokenHash`, `refreshTokenHash`, `expiresAt`, `workstationId` |
| AUTH-16 | `lastLoginAt` actualizado | — | `prismaService.user.update` llamado con `{ where: { id: 'u1' }, data: { lastLoginAt: expect.any(Date) } }` |

#### Grupo C: `validateActiveSession(payload)`

| ID | Escenario | Setup | Esperado |
|----|-----------|-------|----------|
| AUTH-17 | Sesión activa válida | `sessionService.findActiveByTokenHash` retorna sesión con `user` populado | Retorna el usuario |
| AUTH-18 | Sesión no encontrada | `sessionService.findActiveByTokenHash` → `null` | Lanza `UnauthorizedException` (o `SessionExpiredException`) |
| AUTH-19 | Sesión expirada | `session.expiresAt < now`, `session.revokedAt = null` | `SessionExpiredException` |
| AUTH-20 | Sesión revocada | `session.revokedAt != null` | `SessionRevokedException` |

#### Grupo D: `revokeSession(tokenHash)`

| ID | Escenario | Setup | Esperado |
|----|-----------|-------|----------|
| AUTH-21 | Revocación exitosa | Token hash válido | `sessionService.revoke` llamado con `tokenHash` y `reason: LOGOUT` |

### 7.2 SessionService

**Estado:** ✅ **IMPLEMENTADO** — 16 tests pasando.
**Archivo:** `apps/server/src/modules/auth/services/session.service.spec.ts`

76 líneas. CRUD de sesiones.

| ID | Escenario | Esperado |
|----|-----------|----------|
| SESS-01 | `create(data)` crea sesión | `prismaService.userSession.create` llamado con `tokenHash`, `refreshTokenHash`, `userId`, `workstationId`, `expiresAt`, `issuedAt` |
| SESS-02 | `findActiveByTokenHash()` excluye revocadas | Query incluye `revokedAt: null` |
| SESS-03 | `findActiveByTokenHash()` excluye expiradas | Query incluye `expiresAt: { gt: now }` |
| SESS-04 | `findActiveByTokenHash()` incluye usuario populado | Query usa `include: { user: true }` |
| SESS-05 | `revoke(tokenHash, reason, revokedBy?)` actualiza | `updateMany` con `{ revokedAt, revocationReason, revokedByUserId }` |
| SESS-06 | `touchLastActivity(tokenHash)` actualiza timestamp | `updateMany` con `{ lastActivityAt }` y `where: { tokenHash }` |

### 7.3 PasswordHasherService

**Estado:** ✅ **IMPLEMENTADO** — 7 tests pasando.
**Archivo:** `apps/server/src/modules/auth/services/password-hasher.service.spec.ts`

29 líneas. Usa argon2id.

| ID | Escenario | Esperado |
|----|-----------|----------|
| PH-01 | `hash()` retorna string | El resultado no es vacío, no es igual al input |
| PH-02 | `hash()` usa argon2id con parámetros correctos | `memoryCost=19456`, `timeCost=2`, `parallelism=1` |
| PH-03 | `verify()` con contraseña correcta | Retorna `true` |
| PH-04 | `verify()` con contraseña incorrecta | Retorna `false` |
| PH-05 | Dos hashes de la misma contraseña son diferentes | Salt aleatorio — `hash('abc') !== hash('abc')` |

### 7.4 JwtStrategy

**Estado:** ✅ **IMPLEMENTADO** — 3 tests pasando.
**Archivo:** `apps/server/src/modules/auth/strategies/jwt.strategy.spec.ts`

34 líneas. Estrategia Passport JWT con doble validación: firma JWT + sesión activa.

| ID | Escenario | Setup | Esperado |
|----|-----------|-------|----------|
| JWT-01 | Validación exitosa | `payload = { sub: 'u1', role: 'ADMIN' }`, sesión activa | Retorna `{ id: 'u1', role: 'ADMIN' }` |
| JWT-02 | Payload sin `sub` | `payload = { role: 'ADMIN' }` | Lanza `UnauthorizedException` |
| JWT-03 | Sesión revocada | `authService.validateActiveSession` lanza `SessionRevokedException` | Lanza `UnauthorizedException` |
| JWT-04 | Token JWT inválido (expirado) | `secretOrKeyProvider` falla | Lanza error de Passport (manejado por NestJS) |
| JWT-05 | Extractor de token desde header | `Authorization: Bearer <token>` | El token se extrae correctamente |

### 7.5 LocalStrategy

**Estado:** ✅ **IMPLEMENTADO** — 2 tests pasando.
**Archivo:** `apps/server/src/modules/auth/strategies/local.strategy.spec.ts`

16 líneas. Delega en `authService.validateCredentials`.

| ID | Escenario | Setup | Esperado |
|----|-----------|-------|----------|
| LOC-01 | Validación exitosa | `username: 'admin'`, `password: 'secret'` | Retorna resultado de `authService.validateCredentials('admin', 'secret')` |
| LOC-02 | Credenciales inválidas | `authService.validateCredentials` lanza `InvalidCredentialsException` | Propaga la excepción |
| LOC-03 | `usernameField` configurado como `username` | `super({ usernameField: 'username', passwordField: 'password' })` | El campo esperado es `username`, alineado con `UserLoginSchema` y `LoginDto` que ahora usan `username` |

### 7.6 ProductsService

**Estado:** ✅ **IMPLEMENTADO** — 32 tests pasando.
**Archivo:** `apps/server/src/modules/catalog/services/products.service.spec.ts`

284 líneas. CRUD completo con transacciones, histórico de precios/impuestos y códigos de barras.

#### Grupo A: `createProduct(dto, userId)`

| ID | Escenario | Esperado |
|----|-----------|----------|
| PROD-01 | Creación exitosa | Transacción: crea `Product` → crea `ProductPriceHistory` → crea `ProductTaxHistory` → actualiza `currentPriceId` + `currentTaxHistoryId` |
| PROD-02 | Rollback si falla price history | Si `create` de `ProductPriceHistory` falla, no se crea producto ni tax history (transacción atómica) |
| PROD-03 | Rollback si falla tax history | Mismo comportamiento: toda la transacción se revierte |
| PROD-04 | `internalCode` duplicado (P2002) | Mapea error de Prisma a excepción de dominio |
| PROD-05 | Campos obligatorios mapeados correctamente | `internalCode`, `commercialName`, `genericName`, etc. se pasan al `create` de Prisma |
| PROD-06 | `createdById` se asigna | `product.createdById = userId` |
| PROD-07 | ID generado con `crypto.randomUUID()` | El producto creado tiene un ID UUIDv4 |

#### Grupo B: `updateProduct(id, dto)`

| ID | Escenario | Esperado |
|----|-----------|----------|
| PROD-08 | Actualización parcial | Solo campos provistos en DTO se incluyen en `data` del `update` de Prisma |
| PROD-09 | Producto no encontrado | `findUnique` retorna `null` → `ProductNotFoundException` |
| PROD-10 | Mapeo field-by-field manual | Cada campo del DTO se mapea individualmente, no se usa spread |
| PROD-11 | `updatedAt` se actualiza | Prisma lo maneja automáticamente con `@updatedAt` |

#### Grupo C: `registerPrice(productId, priceData, userId)`

| ID | Escenario | Esperado |
|----|-----------|----------|
| PROD-12 | Registro de nuevo precio (con precio previo activo) | `updateMany` cierra precio actual (`effectiveTo = now`), crea nuevo registro, actualiza `currentPriceId` |
| PROD-13 | Primer precio del producto | No hay precio previo que cerrar, solo crea nuevo y setea `currentPriceId` |
| PROD-14 | `changeReason` registrado | Se incluye en el `ProductPriceHistory` creado |
| PROD-15 | `effectiveFrom` automático | El nuevo registro tiene `effectiveFrom = new Date()` |

#### Grupo D: `assignTaxScheme(productId, taxSchemeId, userId)`

| ID | Escenario | Esperado |
|----|-----------|----------|
| PROD-16 | Asignación de nuevo tax scheme | Cierra tax actual, crea nuevo `ProductTaxHistory`, actualiza `currentTaxHistoryId` |
| PROD-17 | Producto sin tax previo | Solo crea nuevo y setea `currentTaxHistoryId` |

#### Grupo E: `addBarcode(productId, barcode, type)`

| ID | Escenario | Esperado |
|----|-----------|----------|
| PROD-18 | Barcode nuevo como primario | Crea barcode con `isPrimary = true` |
| PROD-19 | Barcode duplicado (P2002) | `DuplicateBarcodeException` |
| PROD-20 | Cambio de barcode primario | `updateMany` desmarca anterior (`isPrimary = false`), crea nuevo con `isPrimary = true` |
| PROD-21 | `barcodeType` por defecto | Si no se especifica, usa `INTERNAL` |

### 7.7 CategoriesService

**Estado:** ✅ **IMPLEMENTADO** — 13 tests pasando.
**Archivo:** `apps/server/src/modules/catalog/services/categories.service.spec.ts`

54 líneas. CRUD básico.

| ID | Escenario | Esperado |
|----|-----------|----------|
| CAT-01 | `findAll()` | `prismaService.category.findMany` con `orderBy: { sortOrder: 'asc' }` |
| CAT-02 | `findById(id)` existe | Retorna la categoría |
| CAT-03 | `findById(id)` no existe | `findUnique` → `null`, lanza `CategoryNotFoundException` |
| CAT-04 | `create(dto)` | `prismaService.category.create` con datos del DTO |
| CAT-05 | `create(dto)` nombre duplicado | P2002 → excepción de dominio |
| CAT-06 | `update(id, dto)` | `update` con `where: { id }` y datos parciales |

### 7.8 TaxSchemesService

**Estado:** ✅ **IMPLEMENTADO** — 13 tests pasando.
**Archivo:** `apps/server/src/modules/catalog/services/tax-schemes.service.spec.ts`

69 líneas. CRUD + desactivación.

| ID | Escenario | Esperado |
|----|-----------|----------|
| TAX-01 | `findAll()` | `findMany` con filtro opcional `isActive` |
| TAX-02 | `findById(id)` | `findUnique` |
| TAX-03 | `create(dto)` | `create` con `code`, `name`, `taxType`, `rate` |
| TAX-04 | `update(id, dto)` | `update` parcial |
| TAX-05 | `deactivate(id)` | `update({ where: { id }, data: { isActive: false } })` |
| TAX-06 | `deactivate(id)` ya inactivo | Puede lanzar error específico o ser idempotente (depende de implementación) |
| TAX-07 | Tax scheme duplicado activo | Al crear, verifica que no exista otro activo con mismo `taxType` → lanza `DuplicateActiveTaxSchemeException` |

### 7.9 SalesService

**Archivo:** `apps/server/src/modules/sales-pos/services/sales.service.spec.ts`

351 líneas. El servicio más complejo. Ciclo completo: create → confirm → annul.

**Dependencias mockeadas:** `PrismaService`, `LotsService`, `FiscalDocumentsService` (o el que maneje documentos fiscales), `Queue` (BullMQ), `ConfigService`

#### Grupo A: `create(dto, userId, workstationId)`

| ID | Escenario | Esperado |
|----|-----------|----------|
| SALE-01 | Creación con cash shift abierto | `findFirst` de `CashShift` con `state: OPEN` y `workstationId` correcto. Crea `Sale` con `IN_PROGRESS`, items, snapshots. |
| SALE-02 | Sin cash shift abierto | `findFirst` → `null`. Lanza error: no hay turno activo. |
| SALE-03 | Snapshot de cliente guardado | `identificationType`, `identificationNumber`, `fullName`, `clientType` del cliente se copian a `Sale`. |
| SALE-04 | Cálculo de totales con Decimal | `subtotal`, `totalDiscount`, `totalTax`, `totalAmount` calculados con `Decimal` (precisión 15,2). |
| SALE-05 | Producto snapshot en `SaleItem` | `internalCode`, `commercialName`, `genericName`, `concentration` del producto se copian al `SaleItem`. |
| SALE-06 | Retry lógico en conflicto de `localNumber` | Si `create` falla con P2002 en `localNumber`, reintenta con `localNumber + 1` (máximo N reintentos). |
| SALE-07 | Items con descuento porcentual | `discountPercentage = 10` en un item de `$1000` → `discountAmount = $100`, `subtotal = $900`. |
| SALE-08 | Items con impuesto | `taxRate = 0.19` en item de `$1000` → `taxAmount = $190`. |
| SALE-09 | `requiresPrescription` detectado | Si `product.saleType = PRESCRIPTION` → `saleItem.requiresPrescription = true`. |
| SALE-10 | ID de items generados | Cada `SaleItem` y `SaleItemLot` tiene ID UUIDv4 único. |
| SALE-11 | Precio + impuesto + descuento en un mismo item | `unitPrice: $1000`, `discountPercentage: 5%`, `taxRate: 19%` → `discountAmount: $50`, `subtotal: $950`, `taxAmount: $180.50`, `total: $1130.50` |
| SALE-12 | Items sin descuento ni impuesto | `discountAmount = 0`, `taxAmount = 0`, `subtotal = quantity × unitPrice` |

#### Grupo B: `confirm(saleId, payments, userId)`

| ID | Escenario | Esperado |
|----|-----------|----------|
| SALE-13 | Confirmación exitosa | `operationalState: CONFIRMED`, `confirmedAt` seteado. `LotsService.consumeStockForSale` llamado por cada item. `SalePayment` creados. `FiscalDocument` creado. Job encolado. |
| SALE-14 | Venta ya confirmada | `operationalState = CONFIRMED` → lanza excepción de estado inválido. |
| SALE-15 | Venta anulada | `operationalState = ANNULLED` → lanza excepción. |
| SALE-16 | Pagos no cubren el total | `sum(payments.amount) !== sale.totalAmount` → lanza error de validación. |
| SALE-17 | Stock insuficiente | `LotsService.consumeStockForSale` lanza `InsufficientStockException` → la confirmación falla, transacción hace rollback. |
| SALE-18 | Todo en transacción atómica | Stock consumption + payment creation + fiscal document creation en `prisma.$transaction`. |
| SALE-19 | Enqueue post-commit | `queue.add('fiscal-documents', { documentId })` se llama DESPUÉS del commit. Si falla el enqueue, la venta queda confirmada igual (el documento fiscal queda en `PENDING_GENERATION`). |
| SALE-20 | Múltiples métodos de pago | `payments = [{ method: CASH, amount: 5000 }, { method: DEBIT_CARD, amount: 5000 }]` → dos `SalePayment` creados. |
| SALE-21 | Confirmación actualiza `confirmedAt` | `confirmedAt` se setea a timestamp actual. |

#### Grupo C: `annul(saleId, reason, userId)`

| ID | Escenario | Esperado |
|----|-----------|----------|
| SALE-22 | Anulación exitosa | `operationalState: ANNULLED`, `annulmentReason` guardado, `annulledAt` seteado, `annulledById = userId`. Stock revertido vía `LotsService.reverseStockForSale`. |
| SALE-23 | Venta no confirmada | `operationalState = IN_PROGRESS` → lanza error (solo CONFIRMED se puede anular). |
| SALE-24 | Venta ya anulada | `operationalState = ANNULLED` → lanza error (idempotencia no permitida). |

### 7.10 ClientReturnsService

**Archivo:** `apps/server/src/modules/sales-pos/services/client-returns.service.spec.ts`

163 líneas. Ciclo completo de devolución.

| ID | Escenario | Esperado |
|----|-----------|----------|
| CR-01 | `create()` con items válidos | `ClientReturn` creado con `state: DRAFT`, items con lotes asignados, `refundAmount` calculado. |
| CR-02 | `create()` venta original no encontrada | Lanza excepción. |
| CR-03 | `create()` item no pertenece a la venta | Lanza error de validación. |
| CR-04 | `create()` cantidad a devolver > cantidad comprada | Lanza error de validación. |
| CR-05 | `confirm()` exitoso | `state: CONFIRMED`. Stock recibido vía `LotsService.receiveStockFromClientReturn`. Nota crédito fiscal creada. Job encolado. |
| CR-06 | `confirm()` estado no DRAFT | Solo DRAFT → CONFIRMED. Otros estados lanzan error. |
| CR-07 | `reject()` | `state: REJECTED`, sin modificar stock. |
| CR-08 | `annul()` de retorno confirmado | `state: ANNULLED`, stock revertido. |
| CR-09 | `annul()` de retorno en DRAFT | `state: ANNULLED`, sin modificar stock (nunca se confirmó). |

### 7.11 ClientReturnCalculatorService

**Archivo:** `apps/server/src/modules/sales-pos/services/client-return-calculator.service.spec.ts`

119 líneas. Cálculos auxiliares para devoluciones.

| ID | Escenario | Esperado |
|----|-----------|----------|
| CRC-01 | `prepareReturnItem()` calcula precios | Retorna item con `unitPriceAtSale`, `unitPriceAtReturn`, `taxAmount`, `totalAmount`. |
| CRC-02 | `validateAvailableQuantity()` suficiente | Retorna `true`. |
| CRC-03 | `validateAvailableQuantity()` insuficiente | Lanza error. |
| CRC-04 | `computePrices()` con impuesto | Calcula `taxAmount` proporcional a la cantidad devuelta. |
| CRC-05 | `resolveLotAssignments()` con un solo lote | Asigna todo al lote único. |
| CRC-06 | `resolveLotAssignments()` con múltiples lotes | Distribuye cantidades entre lotes según el histórico del `SaleItemLot`. |

### 7.12 CashShiftService

**Archivo:** `apps/server/src/modules/cash-shift/services/cash-shift.service.spec.ts`

238 líneas. Ciclo de vida de turno de caja.

| ID | Escenario | Esperado |
|----|-----------|----------|
| CS-01 | `openShift()` sin shift abierto previo | Crea `CashShift` con `state: OPEN`, `openingBalance`. |
| CS-02 | `openShift()` con shift ya abierto en misma workstation | Lanza error (solo un turno abierto por workstation). |
| CS-03 | `registerCashCount(shiftId, counts)` | Crea `ShiftCashCount` por cada payment method declarado. |
| CS-04 | `registerCashCount()` método de pago duplicado | Lanza error. |
| CS-05 | `registerCashCount()` denominaciones solo para efectivo | Si `paymentMethod.category !== CASH`, `denominations` no se acepta. |
| CS-06 | `closeShift(shiftId, closingCounts)` | `state: CLOSED`. `actualClosingAmount` calculado. `closingDifference` calculado (`expectedClosingAmount - actualClosingAmount`). |
| CS-07 | `closeShift()` esperado vs declarado | `expectedClosingAmount` = suma de ventas confirmadas en el turno. `actualClosingAmount` = suma de `declaredAmount` del conteo. |
| CS-08 | `closeShift()` shift ya cerrado | Lanza error. |
| CS-09 | `forceCloseShift(shiftId, reason, userId)` | `state: FORCED_CLOSE`, `forcedClose = true`, `forcedCloseReason` y `closerId` registrados. |
| CS-10 | `flagExtendedShifts()` | Detecta turnos abiertos > N horas y setea `hasExtendedAlert = true`. |

### 7.13 ClientsService

**Archivo:** `apps/server/src/modules/clients/services/clients.service.spec.ts`

145 líneas. CRUD + consentimiento + Habeas Data.

| ID | Escenario | Esperado |
|----|-----------|----------|
| CL-01 | `findAll()` paginado | `findMany` con `skip`, `take`, filtros opcionales. |
| CL-02 | `findById(id)` | `findUnique` con cliente. |
| CL-03 | `create(dto)` | `create` con todos los campos del DTO. |
| CL-04 | `create(dto)` identificación duplicada | P2002 en campos `identificationType + identificationNumber` → `DuplicateClientIdentificationException`. |
| CL-05 | `update(id, dto)` | `update` parcial con `where: { id }`. |
| CL-06 | `registerConsent(id, consentData)` | Actualiza `consentGivenAt`, `consentVersion`, `consentScope`. |
| CL-07 | `updateClassification(id, classificationId)` | Actualiza `clientClassificationId`. |
| CL-08 | `requestRectification(id)` | `dataSubjectRequestStatus: PENDING_RECTIFICATION`. |
| CL-09 | `requestErasure(id)` | `dataSubjectRequestStatus: PENDING_ERASURE`. |
| CL-10 | `executeErasure(id)` (Habeas Data) | `fullName → 'ANONYMIZED'`, `email → null`, `phone → null`, `address → null`, `identificationNumber → 'ANONYMIZED'`. `dataSubjectRequestStatus → ERASURED`. |
| CL-11 | `executeErasure()` estado no PENDING_ERASURE | Lanza error (debe pasar por el flujo de solicitud primero). |
| CL-12 | `executeErasure()` conserva Sales previas | Las `Sale` asociadas conservan los snapshots originales (no se modifican). Solo se anonimiza el `Client`. |

### 7.14 LotsService

**Archivo:** `apps/server/src/modules/inventory-lots/services/lots.service.spec.ts`

444 líneas (solo métodos implementados).

#### Grupo A: `consumeStockForSale(items, tx?)`

| ID | Escenario | Esperado |
|----|-----------|----------|
| LOT-01 | Consumo FIFO de un solo lote | `findMany({ orderBy: { entryDate: 'asc' }, where: { state: ACTIVE, currentStock: { gt: 0 } } })`. Consume del más antiguo. |
| LOT-02 | Consumo FIFO con múltiples lotes | Si lote 1 no cubre la cantidad total, consume resto del lote 2. |
| LOT-03 | Stock insuficiente | Suma de `currentStock` < cantidad requerida → `InsufficientStockException`. |
| LOT-04 | Optimistic locking — sin conflicto | `updateMany({ where: { id, version }, data: { currentStock: newStock, version: version + 1 } })` afecta 1 fila. |
| LOT-05 | Optimistic locking — conflicto | `updateMany` afecta 0 filas → `ConcurrentStockModificationException`. |
| LOT-06 | `InventoryMovement` creado por consumo | `movementType: SALE`, `quantity` negativa, `previousStock` y `resultingStock` registrados. |
| LOT-07 | Lote en estado BLOQUED no se consume | `where: { state: ACTIVE }` excluye `BLOCKED`, `EXPIRED`, `EXHAUSTED`. |
| LOT-08 | Lote EXPIRED no se consume | Mismo filtro. |

#### Grupo B: `receiveStock(data)`

| ID | Escenario | Esperado |
|----|-----------|----------|
| LOT-09 | Recepción crea nuevo lote | `Lot.create` con `batchNumber`, `expirationDate`, `currentStock` inicial. |
| LOT-10 | `InventoryMovement` creado por recepción | `movementType: PURCHASE_RECEIPT`, `quantity` positiva. |

#### Grupo C: `reverseStockForSale(saleId)`

| ID | Escenario | Esperado |
|----|-----------|----------|
| LOT-11 | Reversión exitosa | `currentStock` incrementado en cada lote afectado. `InventoryMovement` con `movementType: SALE` (reversión). |
| LOT-12 | Verificación pre-flight de estado | Si el lote está `BLOCKED` o `EXPIRED`, la reversión falla. |

#### Grupo D: `consumeStockForSupplierReturn(data)`

| ID | Escenario | Esperado |
|----|-----------|----------|
| LOT-13 | Consumo para devolución a proveedor | Similar a `consumeStockForSale` pero con `movementType: SUPPLIER_RETURN`. |

#### Grupo E: `receiveStockFromClientReturn(data)`

| ID | Escenario | Esperado |
|----|-----------|----------|
| LOT-14 | Recepción de devolución de cliente | Similar a `receiveStock` pero con `movementType: CLIENT_RETURN`. |

---

## 8. Fase 4: Tests de Integración — Controladores

**Objetivo:** Verificar que el pipeline NestJS completo funciona: request → guards → pipes → controller → service → response. Sin levantar servidor HTTP real.

**Estrategia:** `Test.createTestingModule` con providers reales (o mockeados selectivamente). Se instancia el controlador y se llama a sus métodos directamente.

### 8.1 Estructura base de un test de integración

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ProductsController } from './products.controller';
import { ProductsService } from '../services/products.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

describe('ProductsController (integration)', () => {
  let controller: ProductsController;
  let service: ProductsService;

  const mockPrismaService = {
    product: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    // ... resto de modelos necesarios
  };

  const mockJwtService = {
    signAsync: jest.fn(),
    verifyAsync: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config: Record<string, string> = {
        JWT_ACCESS_SECRET: 'test-secret',
        JWT_ACCESS_TTL_SECONDS: '900',
      };
      return config[key];
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        // ... otros providers que ProductsService inyecta
      ],
    }).compile();

    controller = module.get<ProductsController>(ProductsController);
    service = module.get<ProductsService>(ProductsService);
  });

  describe('GET /catalog/products', () => {
    it('should return paginated products', async () => {
      const mockProducts = [
        { id: '1', commercialName: 'Acetaminofén' },
        { id: '2', commercialName: 'Ibuprofeno' },
      ];
      mockPrismaService.product.findMany.mockResolvedValue(mockProducts);

      const result = await controller.findAll({ page: 1, limit: 10 });

      expect(result).toEqual(mockProducts);
      expect(mockPrismaService.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10 }),
      );
    });
  });
});
```

### 8.2 Controladores a testear

| Controlador | Endpoints | # Tests estimado | Qué verificar |
|-------------|-----------|-----------------|---------------|
| `auth.controller.ts` | `POST /login`, `POST /refresh`, `POST /logout`, `GET /me` | ~8 | Login exitoso/fallido, JWT en respuesta, `/me` retorna usuario, refresh token, logout |
| `products.controller.ts` | `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `POST /:id/prices`, `POST /:id/tax-schemes`, `POST /:id/barcodes`, `PATCH /:id/barcodes/:bid/primary` | ~12 | Guards aplicados, pipes Zod, respuestas formateadas, errores de dominio |
| `categories.controller.ts` | `GET /`, `GET /:id`, `POST /`, `PATCH /:id` | ~6 | CRUD, guards, validación |
| `tax-schemes.controller.ts` | `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `POST /:id/deactivate` | ~6 | CRUD + deactivate, duplicate active detection |
| `sales.controller.ts` | `GET /`, `GET /:id`, `POST /`, `POST /:id/confirm`, `POST /:id/annul` | ~10 | Crear venta, confirmar con pagos, anular, estados inválidos |
| `cash-shift.controller.ts` | `GET /`, `GET /:id`, `POST /`, `POST /:id/close`, `POST /:id/force-close`, `POST /:id/cash-counts` | ~8 | Apertura obligatoria antes de ventas, cierre con diferencias |
| `clients.controller.ts` | `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `POST /:id/consent`, `PATCH /:id/classification`, `POST /:id/data-request`, `POST /:id/erase` | ~10 | CRUD + consent + Habeas Data completo |
| `lots.controller.ts` | `GET /`, `GET /:id`, `POST /:id/block`, `POST /:id/unblock` | ~6 | Listado con filtros, bloqueo/desbloqueo |
| `client-returns.controller.ts` | `GET /`, `GET /:id`, `POST /`, `POST /:id/confirm`, `POST /:id/reject`, `POST /:id/annul` | ~6 | Ciclo completo de devolución |

**Total tests de integración estimados: ~72**

### 8.3 Verificaciones clave para CADA endpoint

Para cada endpoint marcado con `@UseGuards` y `@Roles`:

1. **Request sin JWT**: Verificar que `JwtAuthGuard` rechaza con 401.
2. **Request con rol incorrecto**: Verificar que `RolesGuard` rechaza con 403.
3. **Body inválido (Zod)**: Verificar que `ZodValidationPipe` retorna 400 con `{ message: 'Validation failed', errors: [...] }`.
4. **Body válido, service retorna éxito**: Verificar status code (201/200), formato de respuesta.
5. **Service lanza `DomainException`**: Verificar que se propaga correctamente (status code, errorCode en body).
6. **`@Auditable()` en mutaciones**: Verificar que el metadata está presente (no se prueba el interceptor en esta fase — eso es Fase 2).

---

## 9. Fase 5: Tests E2E — Flujos Críticos

**Objetivo:** Probar flujos de negocio completos con el servidor NestJS corriendo y base de datos PostgreSQL real.

**Herramientas:**
- `supertest` para HTTP requests al servidor
- `@testcontainers/postgresql` (o Docker Compose con PostgreSQL 16) para BD de test
- `prisma migrate deploy` para crear el schema antes de los tests
- `prisma db seed` (opcional) para datos de prueba

### 9.1 Setup de E2E

#### `apps/server/jest.e2e.config.ts`

```typescript
import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.e2e-spec\\.ts$',
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
      useESM: true,
    }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@pharmacy/shared-types$':
      '<rootDir>/../../packages/shared-types/src/index.ts',
    '^@pharmacy/shared-validation$':
      '<rootDir>/../../packages/shared-validation/src/index.ts',
  },
  globalSetup: '<rootDir>/test/e2e/global-setup.ts',
  globalTeardown: '<rootDir>/test/e2e/global-teardown.ts',
};

export default config;
```

#### `apps/server/test/e2e/global-setup.ts`

```typescript
import { execSync } from 'child_process';

export default async function globalSetup(): Promise<void> {
  // Asegurar que Prisma Client esté generado
  execSync('pnpm exec prisma generate', { stdio: 'inherit' });

  // Ejecutar migraciones en BD de test
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ||
    'postgresql://test:test@localhost:5432/pharmacy_test';
  execSync('pnpm exec prisma migrate deploy', { stdio: 'inherit' });
}
```

#### `apps/server/test/e2e/app-setup.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module';

export async function createTestApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  await app.init();
  return app;
}
```

### 9.2 Flujos E2E

Ubicación: `apps/server/test/e2e/flows/`

#### Flujo 1: Autenticación completa (auth.e2e-spec.ts)

```
1. POST /auth/login con credenciales válidas
   → 201, response.accessToken, response.refreshToken, response.user
2. GET /auth/me con header Authorization: Bearer <accessToken>
   → 200, response.username, response.role
3. GET /auth/me sin token
   → 401
4. GET /auth/me con token inválido
   → 401
5. POST /auth/logout con token válido
   → 200 o 204
6. GET /auth/me con token revocado (después de logout)
   → 401
7. POST /auth/refresh con refreshToken
   → 201, nuevo accessToken + refreshToken
```

#### Flujo 2: Ciclo de vida de venta (sale-lifecycle.e2e-spec.ts)

```
Precondición: Login como CASHIER, obtener token

1. POST /cash-shift { openingBalance: 50000 }
   → 201, shift.id, state: OPEN

2. POST /sales-pos { workstationId, items: [{ productId, quantity, unitPrice }] }
   → 201, sale.id, state: IN_PROGRESS

3. POST /sales-pos/:id/confirm { payments: [{ paymentMethodId, amount }] }
   → 200, state: CONFIRMED

4. GET /inventory/lots/:lotId (del producto vendido)
   → 200, currentStock reducido por la cantidad vendida

5. POST /sales-pos/:id/annul { reason: "Cliente canceló" }
   → 200, state: ANNULLED

6. GET /inventory/lots/:lotId
   → 200, currentStock restaurado

7. POST /cash-shift/:id/close { counts: [...] }
   → 200, state: CLOSED, closingDifference calculado
```

#### Flujo 3: Gestión de catálogo con RBAC (catalog.e2e-spec.ts)

```
Precondición: Login como ADMIN, obtener token

1. POST /catalog/products { internalCode, commercialName, genericName, ... }
   → 201, product.id

2. GET /catalog/products/:id
   → 200, product con datos creados

3. PATCH /catalog/products/:id { commercialName: "Nuevo nombre" }
   → 200, commercialName actualizado

4. POST /catalog/products/:id/prices { price: 15000.00, changeReason: "Ajuste IPC" }
   → 201, nuevo price history, currentPriceId actualizado

5. POST /catalog/products/:id/tax-schemes { taxSchemeId }
   → 201, nuevo tax history, currentTaxHistoryId actualizado

6. GET /catalog/products/:id
   → 200, incluye currentPrice y currentTaxScheme populados

// Verificar RBAC: Login como CASHIER
7. Login como CASHIER → obtener token
8. POST /catalog/products { ... } con token de CASHIER
   → 403 Forbidden (solo ADMIN puede crear productos)
```

#### Flujo 4: Bloqueo de cuenta (account-lockout.e2e-spec.ts)

```
Precondición: Usuario de test con password conocido

1. POST /auth/login { username: "user@test.com", password: "WRONG" }
   → 401 InvalidCredentialsException (intento 1)

2. Repetir × 4 más (total 5 intentos fallidos)

3. POST /auth/login { username: "user@test.com", password: "CORRECT" }
   → 403 AccountLockedException

4. Esperar 15 minutos (o manipular lockedUntil en BD)
   → El lock expira

5. POST /auth/login { username: "user@test.com", password: "CORRECT" }
   → 201, login exitoso (failedLoginAttempts reseteado a 0)
```

#### Flujo 5: Devolución de cliente (client-return.e2e-spec.ts)

```
Precondición: Venta confirmada existente

1. POST /sales-pos/returns { saleId, items: [{ saleItemId, quantity }] }
   → 201, clientReturn.id, state: DRAFT, refundAmount calculado

2. POST /sales-pos/returns/:id/confirm
   → 200, state: CONFIRMED

3. GET /inventory/lots/:id (lote del producto devuelto)
   → 200, currentStock incrementado

4. GET /fiscal-dian/documents?entityId=<clientReturn.id>
   → 200, documento fiscal tipo CREDIT_NOTE creado
```

#### Flujo 6: Habeas Data (habeas-data.e2e-spec.ts)

```
Precondición: Cliente creado con datos personales

1. PATCH /clients/:id/data-request { requestType: ERASURE }
   → 200, dataSubjectRequestStatus: PENDING_ERASURE

2. POST /clients/:id/erase (requiere rol ADMIN)
   → 200, dataSubjectRequestStatus: ERASURED

3. GET /clients/:id
   → 200, fullName: "ANONYMIZED", email: null, phone: null

4. GET /sales?clientId=<id> (ventas previas del cliente)
   → 200, sales conservan identificationNumber, fullName original (snapshot)
```

#### Flujo 7: Cierre de caja con diferencia (cash-shift.e2e-spec.ts)

```
Precondición: Turno abierto, ventas confirmadas

1. GET /cash-shift/:id
   → 200, expectedClosingAmount calculado (suma de ventas)

2. POST /cash-shift/:id/close {
     counts: [
       { paymentMethodId: CASH, declaredAmount: 9500 },
       { paymentMethodId: DEBIT_CARD, declaredAmount: 5000 }
     ]
   }
   → 200, state: CLOSED, closingDifference: expected - actual

3. Verificar: expectedClosingAmount = sum(ventas en turno)
   actualClosingAmount = sum(counts.declaredAmount)
   closingDifference = expected - actual
```

#### Flujo 8: Varios productos con FIFO (fifo-stock.e2e-spec.ts)

```
Precondición: Producto con 2 lotes (lote A: 10 unidades, entryDate antiguo; lote B: 5 unidades, entryDate reciente)

1. POST /sales-pos { items: [{ productId, quantity: 12 }] }
   → 201, venta creada

2. POST /sales-pos/:id/confirm { payments: [...] }
   → 200, CONFIRMED

3. GET /inventory/lots/:lotAId
   → 200, currentStock: 0 (consumió 10)

4. GET /inventory/lots/:lotBId
   → 200, currentStock: 3 (consumió 2 de las 12 requeridas)

5. GET /inventory/movements?lotId=:lotAId
   → Movement con quantity: -10

6. GET /inventory/movements?lotId=:lotBId
   → Movement con quantity: -2
```

---

## 10. Fase 6: Cobertura, CI/CD y Frontends (Futuro)

### 10.1 Thresholds de cobertura

Según `backend.md:58`: **mínimo 80% de cobertura de código** con Jest + Istanbul.

| Métrica | Threshold | Justificación |
|---------|-----------|---------------|
| **Branches** | 80% | Todas las ramas `if/else`, `switch/case`, operadores ternarios deben tener al menos un test |
| **Functions** | 80% | Cada método público debe estar cubierto. Métodos privados se cubren indirectamente vía públicos |
| **Lines** | 80% | Cada línea ejecutable debe ser alcanzada por al menos un test |
| **Statements** | 80% | Cada statement individual debe ejecutarse en algún test |

#### Archivos a excluir de cobertura (sin lógica ejecutable)

| Patrón | Razón |
|--------|-------|
| `*.module.ts` | Módulos NestJS: pura configuración `@Module()` |
| `*.schema.ts` | Schemas Zod: código declarativo |
| `*.exception.ts` | Excepciones: constructores vacíos o solo `super()` |
| `*.entity.ts` | Type aliases: `export type Foo = any` |
| `*.constants.ts` | Constantes: `export const X = 5` |
| `*.dto.ts` | DTO classes: puro transporte de datos, sin lógica |
| `index.ts` | Barrel exports |
| `main.ts` | Bootstrap de aplicación |
| `app.module.ts` | Root module (configuración) |

### 10.2 Integración CI/CD (GitHub Actions)

Archivo a crear: `.github/workflows/test.yml`

```yaml
name: Test Suite

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint-typecheck:
    name: Lint & Type Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm lint
      - run: pnpm typecheck

  unit-tests:
    name: Unit Tests
    runs-on: ubuntu-latest
    strategy:
      matrix:
        package:
          - '@pharmacy/shared-types'
          - '@pharmacy/shared-validation'
          - '@pharmacy/server'
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm --filter ${{ matrix.package }} test:cov
      - uses: codecov/codecov-action@v5
        with:
          files: ./coverage/coverage-final.json
          flags: ${{ matrix.package }}

  e2e-tests:
    name: E2E Tests
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: pharmacy_test
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm --filter @pharmacy/server prisma:generate
      - run: pnpm --filter @pharmacy/server exec prisma migrate deploy
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/pharmacy_test
      - run: pnpm --filter @pharmacy/server test:e2e
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/pharmacy_test
          REDIS_URL: redis://localhost:6379
          JWT_ACCESS_SECRET: test-access-secret
          JWT_REFRESH_SECRET: test-refresh-secret
          NODE_ENV: test
```

### 10.3 Tests de Frontends (Futuro)

Cuando `apps/pos-desktop/` y `apps/backoffice/` sean creados (Fase 8 del proyecto).

#### POS Desktop (`apps/pos-desktop`)

| Tipo | Herramienta | Qué testear |
|------|-------------|-------------|
| **Unit** | Vitest | Hooks (`useSync`, `useOffline`, `useBarcode`), servicios (`storage.ts`, `sync.ts`, `printing.ts`), slices de Redux Toolkit |
| **Component** | Vitest + React Testing Library | Componentes: `SalesTransaction`, `PaymentProcessing`, `Receipt`, `Inventory`, `AdminSettings`. Verificar renderizado, interacciones, estados offline. |
| **E2E** | Playwright | Flujos completos: login → abrir turno → crear venta → cobrar → imprimir recibo → cerrar turno. Modo offline: crear venta sin conexión → restaurar conexión → verificar sync. |

Configuración de Vitest (`apps/pos-desktop/vitest.config.ts`):

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.{spec,test}.{ts,tsx}'],
    coverage: {
      provider: 'istanbul',
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
    // Mock de Tauri APIs
    deps: {
      inline: ['@tauri-apps/api'],
    },
  },
});
```

#### Backoffice (`apps/backoffice`)

| Tipo | Herramienta | Qué testear |
|------|-------------|-------------|
| **Unit** | Vitest | Hooks (`useAuth`, `usePermissions`, `useDebounce`, `usePagination`), slices de estado UI |
| **Component** | Vitest + React Testing Library | Páginas (`Dashboard`, `Users`, `Products`, `Inventory`, `Purchases`, `Sales`, `Reports`, `Configuration`, `AuditLogs`). Componentes comunes (`tables`, `forms`, `charts`). |
| **Integration** | Vitest + msw (Mock Service Worker) | Páginas con TanStack Query mockeando API responses. Verificar loading/error/data states. |
| **E2E** | Playwright | Flujos de administración: CRUD de usuarios, CRUD de productos, generación de reportes, revisión de auditoría, configuración del sistema. |

### 10.4 Tests de `apps/fiscal-engine` (Futuro)

El microservicio `fiscal-engine` es un worker de BullMQ que consume jobs de `fiscal-documents`. Su plan de testing seguirá el mismo patrón que el server:

| Tipo | Herramienta | Qué testear |
|------|-------------|-------------|
| **Unit** | Jest + @nestjs/testing | Procesadores de jobs: `generateInvoice`, `signXml`, `transmitToDian`. Mock de `dian-sdk-node`, `xmlbuilder2`. |
| **Integration** | Jest + @nestjs/testing | Consumo de job completo: recibe job de BullMQ → genera XML → firma → transmite → actualiza estado. |
| **E2E** | Jest + BullMQ test helpers | Flujo completo: server encola job → fiscal-engine procesa → actualiza `FiscalDocument.fiscalState`. |

### 10.5 Utilidades de testing a crear

Para reducir duplicación de setup en tests, crear los siguientes helpers:

```
apps/server/test/
├── utils/
│   ├── prisma-mock.factory.ts    # Factory para mocks tipados de PrismaService
│   ├── test-data.factory.ts      # Fixtures: usuarios, productos, ventas, etc.
│   └── auth-testing.utils.ts     # Helpers para generar JWTs de test
├── mocks/
│   └── prisma-service.mock.ts    # Mock completo de PrismaService para integration tests
└── e2e/
    ├── global-setup.ts           # Setup global para tests E2E (migraciones, seed)
    ├── global-teardown.ts        # Limpieza post-tests
    ├── app-setup.ts              # Crear NestApplication para tests
    └── fixtures/
        ├── users.fixture.ts      # Datos de prueba: admin, cashier, inventory_assistant
        ├── products.fixture.ts   # Productos con precios, impuestos, lotes, categorías
        └── sales.fixture.ts      # Ventas en distintos estados para tests de flujo
```

#### Ejemplo: `prisma-mock.factory.ts`

```typescript
import { DeepMockProxy, mockDeep, mockReset } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';

export type PrismaMock = DeepMockProxy<PrismaClient>;

export function createPrismaMock(): PrismaMock {
  return mockDeep<PrismaClient>();
}

export function resetPrismaMock(mock: PrismaMock): void {
  mockReset(mock);
}
```

#### Ejemplo: `test-data.factory.ts`

```typescript
import { randomUUID } from 'crypto';
import { RoleType, User, Product, Sale, CashShift } from '@pharmacy/shared-types';

export function createTestUser(overrides?: Partial<User>): User {
  return {
    id: randomUUID(),
    username: 'testuser',
    fullName: 'Test User',
    role: RoleType.ADMIN,
    isActive: true,
    passwordHash: '$argon2id$...',
    passwordAlgorithm: 'argon2id',
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function createTestProduct(overrides?: Partial<Product>): Product {
  return {
    id: randomUUID(),
    internalCode: `PROD-${randomUUID().slice(0, 8)}`,
    commercialName: 'Test Product',
    genericName: 'Test Generic',
    isActive: true,
    saleType: 'FREE_SALE' as any,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ... más factories: createTestSale, createTestCashShift, createTestClient, etc.
```

#### Ejemplo: `auth-testing.utils.ts`

```typescript
import * as jwt from 'jsonwebtoken';

export function generateTestToken(payload: {
  sub: string;
  role: string;
  username: string;
}): string {
  return jwt.sign(payload, 'test-access-secret', { expiresIn: '15m' });
}

export function generateExpiredToken(payload: {
  sub: string;
  role: string;
}): string {
  return jwt.sign(payload, 'test-access-secret', { expiresIn: '0s' });
}
```

---

## 11. Resumen de Estimaciones (Actualizado)

| Fase | Descripción | Archivos de test | Tests | Esfuerzo (días) | Estado |
|------|-------------|-----------------|-------|-----------------|--------|
| **F0** | Infraestructura (deps, configs, scripts, turbo) | — | — | 1 | ✅ COMPLETO |
| **F1** | Paquetes compartidos | 5 spec files | ~55 | 1-2 | ✅ COMPLETO |
| **F2** | Capa common/infra (pipes, guards, filters, interceptors, prisma) | 6 spec files | ~44 | 2-3 | ✅ COMPLETO |
| **F3A** | Auth (AuthService, SessionService, PasswordHasher, JwtStrategy, LocalStrategy) | 5 spec files | ~58 | 2-3 | ✅ COMPLETO |
| **F3B** | Catalog (ProductsService, CategoriesService, TaxSchemesService) | 3 spec files | ~58 | 2 | ✅ COMPLETO |
| **F3C** | Sales + Cash + Clients + Inventory | 6 spec files | ~35 | 3-4 | 🔴 PENDIENTE |
| **F4** | Controladores (integración) | 9 spec files | ~72 | 3-4 | 🔴 PENDIENTE |
| **F5** | E2E flujos críticos | 8 e2e-spec files | ~24 | 3-4 | 🔴 PENDIENTE |
| **F6** | CI/CD, utilidades de testing | — | — | 2-3 | 🔴 PENDIENTE |
| **TOTAL COMPLETADO** | | **19 spec files** | **~215 tests** | **~9 días** | |
| **TOTAL RESTANTE** | | **~23 spec files** | **~131 tests** | **~10-13 días** | |

### Distribución por tipo de test

```
Ya implementados (F1 + F2 + F3A + F3B):   215 tests  (72%)
  ├── shared-validation (Zod schemas):      43 tests
  ├── shared-types (enums):                 11 tests
  ├── env.schema:                           10 tests
  ├── ZodValidationPipe:                     9 tests
  ├── RolesGuard:                            7 tests
  ├── HttpExceptionFilter:                  12 tests
  ├── AuditLogInterceptor:                  21 tests
  ├── PrismaService:                         3 tests
  ├── PasswordHasherService:                 7 tests
  ├── SessionService:                       16 tests
  ├── AuthService:                          30 tests
  ├── JwtStrategy:                           3 tests
  ├── LocalStrategy:                         2 tests
  ├── ProductsService:                      32 tests
  ├── CategoriesService:                    13 tests
  └── TaxSchemesService:                    13 tests
Pendientes (F3C):                          ~35 tests  (12%)
Integración (F4 — controllers):           ~72 tests  (24%)
E2E (F5 — flujos completos):              ~24 tests  (8%)
Utilidades (F6 — CI/CD + helpers):         —          —
                                           ─────────
TOTAL (cuando esté completo):             ~300+ tests
```

### Cronograma ajustado

```
Día 1:     Infraestructura + shared-validation tests                  ← COMPLETADO
Día 2:     enums.spec.ts + Fase 2 (ZodValidationPipe, RolesGuard)    ← COMPLETADO
Día 3-4:   Fase 2 (HttpExceptionFilter, AuditLogInterceptor, PrismaService)  ← COMPLETADO
Día 5-6:   Fase 3A (Auth completo: AuthService, SessionService, PasswordHasher, estrategias)  ← COMPLETADO
Día 7-8:   Fase 3B (Catalog: ProductsService, CategoriesService, TaxSchemesService)  ← EN CURSO
Día 10-12:  Fase 3C (SalesService, ClientReturnsService, CashShiftService, ClientsService, LotsService, ClientReturnCalculatorService)
Día 13-15: Fase 4 (Controladores: integración)
Día 16-19: Fase 5 (E2E: infraestructura + flujos críticos)
Día 20-22: Fase 6 (CI/CD, utilidades, documentación)
```

---

## 12. Riesgos Identificados

### Riesgo 1: ~~PrismaService no tipado — Mocks con `any`~~ → **RESUELTO**

**Estado:** ✅ **Corregido** — `PrismaService` ahora extiende `PrismaClient` directamente en lugar de envolverlo parcialmente. Todos los modelos tienen typing completo sin necesidad de casts `(as any)`.

**Mitigación aplicada:**
- `PrismaService` se definió como `export class PrismaService extends PrismaClient`
- Los servicios acceden a `this.prisma.model` con typing completo de Prisma Client
- Para mocks en tests: usar `mockDeep<PrismaClient>()` de `jest-mock-extended` — el mock refleja la forma completa del cliente

**Riesgo remanente:** Aunque el typing ahora es completo, los mocks con `mockDeep<PrismaClient>()` son deep mocks que aceptan cualquier llamada. Sigue siendo posible que un test pase aunque el código real tenga errores de lógica en las queries. Se mitiga con tests de integración contra Prisma real (Fase 4 y E2E).

### Riesgo 2: Tests E2E requieren PostgreSQL

**Problema:** No se pueden ejecutar tests E2E sin una instancia de PostgreSQL 16 corriendo.

**Impacto:** Los tests E2E fallarán en entornos sin Docker o PostgreSQL local.

**Mitigación:**
- CI/CD: Usar `services.postgres` en GitHub Actions.
- Desarrollo local: Proveer `docker-compose.test.yml` con PostgreSQL + Redis para tests.
- Alternativa: Usar `@testcontainers/postgresql` para levantar PostgreSQL programáticamente en los tests (requiere Docker).

### Riesgo 3: Transacciones anidadas en mocks

**Problema:** Varios servicios usan `prisma.$transaction(async (tx) => { ... })`. El callback recibe `tx` que es un PrismaClient transaccional. Mockear esto correctamente requiere que el mock de `$transaction` ejecute el callback pasándole el mismo mock (o un clone).

**Impacto:** Tests que verifican llamadas dentro de transacciones pueden fallar si el mock no ejecuta el callback.

**Mitigación (obligatoria en cada test que usa transacciones):**
```typescript
// Usando jest-mock-extended con DeepMockProxy
const prismaMock = mockDeep<PrismaClient>();
prismaMock.$transaction.mockImplementation(
  async (callback: any) => callback(prismaMock),
);
```

> **Importante:** El mock de `$transaction` se debe configurar en `beforeEach` de cada suite de tests que verifique servicios con transacciones. No asumir que `mockDeep` lo hace automáticamente.

### Riesgo 4: BullMQ en tests

**Problema:** `Queue.add()` requiere conexión a Redis. En tests unitarios, no hay Redis.

**Impacto:** Los servicios que encolan jobs (SalesService confirm, ClientReturnsService confirm) lanzarán error al intentar `queue.add()` si no se mockea.

**Mitigación:** Mockear siempre `Queue` y `BullModule` en tests unitarios y de integración. Solo usar Redis real en tests E2E.

### Riesgo 5: argon2 es lento en tests

**Problema:** `argon2.hash()` y `argon2.verify()` son operaciones intencionalmente lentas (diseño de seguridad). Ralentizan los tests.

**Impacto:** Los tests que usan `PasswordHasherService` real serán notablemente más lentos.

**Mitigación:**
- Tests unitarios: Mockear `PasswordHasherService` completamente.
- Tests de integración: Usar el servicio real, pero con timeouts generosos.
- Tests E2E: Usar el servicio real (es el comportamiento que se quiere verificar).

### Riesgo 6: Stubs no implementados reducen cobertura

**Problema:** ~10 servicios son stubs que lanzan `NotImplementedForPhaseException`. Si se mide cobertura sobre TODO el código, estos stubs (sin tests) bajarán el porcentaje.

**Impacto:** El threshold del 80% podría no alcanzarse hasta que esos stubs se implementen.

**Mitigación:**
- Opción A: Excluir temporalmente los archivos stub de `collectCoverageFrom` (agregar `!src/modules/sync/**`, `!src/modules/fiscal-dian/**`, etc.).
- Opción B: Escribir tests mínimos para los stubs (verificar que lanzan `NotImplementedForPhaseException`).
- Opción C: Implementar la lógica pendiente antes o en paralelo con el plan de testing.

### Riesgo 7: ~~Divergencias de tipos entre shared-types y Prisma~~ → **RESUELTO**

**Estado:** ✅ **Corregido** — `shared-types` `PaymentMethodCategory` se actualizó para coincidir con Prisma: `TRANSFER→BANK_TRANSFER`, `ELECTRONIC_WALLET→DIGITAL_WALLET`, `CREDIT_LINE→CREDIT`. Los tests de consistencia de enums (SHT-E01 a SHT-E04) ahora deben pasar sin divergencias conocidas.

**Riesgo remanente:** Pueden aparecer nuevas divergencias si se agregan valores a un lado pero no al otro. Los tests de enums en `enums.spec.ts` están diseñados para detectar esto temprano.

---

## Apéndice A: Comandos útiles durante el desarrollo de tests

```bash
# Instalar dependencias de testing
pnpm --filter @pharmacy/server add -D jest ts-jest @types/jest @nestjs/testing jest-mock-extended supertest @types/supertest
pnpm --filter @pharmacy/shared-validation add -D jest ts-jest @types/jest
pnpm --filter @pharmacy/shared-types add -D jest ts-jest @types/jest

# Ejecutar todos los tests
pnpm test

# Ejecutar tests con coverage
pnpm test:cov

# Ejecutar tests de un archivo específico
pnpm --filter @pharmacy/server test -- auth.service.spec.ts

# Ejecutar tests en watch mode
pnpm --filter @pharmacy/server test:watch

# Ejecutar tests E2E
pnpm --filter @pharmacy/server test:e2e

# Ejecutar un solo flujo E2E
pnpm --filter @pharmacy/server test:e2e -- sale-lifecycle.e2e-spec.ts

# Ver coverage report (abre en navegador)
pnpm --filter @pharmacy/server exec open-cli coverage/lcov-report/index.html
```

## Apéndice B: Referencias a los archivos de agentes

- `backend.md:58` — Testing: Jest + Istanbul, mínimo 80% code coverage.
- `backend.md:68` — Test files: `*.spec.ts` alongside the source file.
- `frontend-pos.md:57` — Testing: Vitest + React Testing Library + Playwright.
- `frontend-backoffice.md:57` — Testing: Vitest + React Testing Library + Playwright.
- `AGENTS.md:4-9` — Jest para backend, Vitest + Playwright para frontends.
- Root `package.json:37-40` — Scripts `test`, `test:cov`, `test:e2e`, `test:watch`.

---

**Documento preparado por el agente de planificación de testing, Julio 2026.**
