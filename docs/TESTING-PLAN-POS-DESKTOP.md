# Plan de Testing — POS Desktop (Tauri 2 + React + PGlite)

**Versión:** 1.5
**Última actualización:** Julio 2026
**Estado:** Fases 0-6 completadas. **~567 tests en 57 archivos** (52 unitarios + 5 E2E). **~398 tests nuevos** (utilidades, hooks, common, dominio, Redux slices, componentes flujo venta, páginas y navegación, E2E). ~56 archivos pendientes de cobertura.

---

## Tabla de Contenidos

1. [Estado Actual y Diagnóstico](#1-estado-actual-y-diagnóstico)
2. [Tecnologías de Testing](#2-tecnologías-de-testing)
3. [Correcciones de Infraestructura](#3-correcciones-de-infraestructura)
4. [Plan de Ejecución por Fases](#4-plan-de-ejecución-por-fases)
5. [Fase 1: Utilidades, Hooks y Common](#5-fase-1-utilidades-hooks-y-common)
6. [Fase 2: Servicios de Dominio](#6-fase-2-servicios-de-dominio)
7. [Fase 3: Redux Slices Faltantes](#7-fase-3-redux-slices-faltantes)
8. [Fase 4: Componentes React — Flujo de Venta](#8-fase-4-componentes-react--flujo-de-venta)
9. [Fase 5: Componentes React — Páginas y Navegación](#9-fase-5-componentes-react--páginas-y-navegación)
10. [Fase 6: E2E con Playwright](#10-fase-6-e2e-con-playwright)
11. [Resumen de Estimaciones](#11-resumen-de-estimaciones)
12. [Riesgos Identificados](#12-riesgos-identificados)

---

## 1. Estado Actual y Diagnóstico

| Aspecto | Estado |
|---------|--------|
| Archivos de test (`*.test.ts`, `*.test.tsx`) | **52 archivos, ~555 tests** — todos pasando ✅ |
| Configuración de Vitest | **LISTO** — inline en `vite.config.ts` con coverage (v8, 80% thresholds) |
| `vitest.setup.ts` | **LISTO** — jest-dom matchers + i18n init |
| Dependencias instaladas | **LISTO** — `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/dom`, `jsdom`, `@testing-library/user-event`, `@vitest/coverage-v8` |
| Dependencias faltantes | `msw`, `playwright` (para E2E) |
| Scripts `test` | **LISTO** — `test`, `test:watch`, `test:cov` |
| Cobertura actual | **~38%** (subiendo desde <2%) — Meta: ≥80% |
| Servicios de dominio | **24 servicios/stores** — todos testeados ✅ (245 tests) |
| Redux slices | **3 slices** — 3 testeados ✅ (payment: 10, sales: 22, ui: 27) |
| Componentes React | **17 componentes** — todos testeados ✅ (207 tests) |
| Hooks React | **2 hooks** — 2 testeados ✅ (use-elapsed-time, use-online-status) |
| Utilidades puras | **6 archivos** — 6 testeados ✅ (format-currency, format-date, sync-metadata, domain-error, is-online, time-format) |
| Archivos totales TypeScript/TSX | **~108 archivos** |

### Arquitectura del proyecto

```
apps/pos-desktop/src/
├── common/                          # 3 archivos — utilidades sin framework
│   ├── domain-error.ts              # Clase base de error
│   ├── is-online.ts                 # Detección de conectividad
│   └── sync-metadata.ts            # Timestamps de sync en localStorage
│
├── domain/                          # 14 servicios + 7 excepciones + 3 stores
│   ├── auth/                        # Login, sesión, guard de roles
│   ├── cash-shift/                  # Apertura/cierre de caja, conteos
│   ├── catalog/                     # Pull de catálogo + payment methods
│   ├── clients/                     # Búsqueda local + creación offline-first
│   ├── configuration/               # Store Zustand de config local
│   ├── inventory-adjustments/       # Ajustes de inventario (aumentar/disminuir)
│   ├── inventory-lots/              # Consumo FEFO con optimistic locking
│   ├── prescriptions/               # Registro de fórmula médica
│   ├── returns/                     # Devoluciones de cliente
│   ├── sales-pos/                   # Crear/confirmar ventas, consumir stock
│   └── sync/                        # Push, metrics, recovery, scheduler
│
├── infrastructure/                  # 5 archivos
│   ├── local-database.ts           # Singleton PGlite + PrismaClient
│   ├── http-client.ts              # Fetch wrapper con auth token
│   ├── auth-token-provider.ts      # Abstracción de localStorage
│   └── config.ts                   # Variables de entorno
│
└── renderer/                        # React frontend (~60 archivos)
    ├── components/                  # 18+ componentes (Sales, Payment, Returns, etc.)
    ├── hooks/                       # 2 hooks (useElapsedTime, useOnlineStatus)
    ├── services/                    # CatalogService (interfaz + HTTP + mock), PaymentGateway
    ├── store/                       # Redux: 3 slices (sales, payment, ui)
    ├── utils/                       # formatCurrency, formatDate
    ├── i18n/                        # i18next: español + inglés
    └── styles/                      # Tailwind v4 + design tokens
```

---

## 2. Tecnologías de Testing

| Herramienta | Propósito | Estado |
|-------------|-----------|--------|
| **Vitest 4.x** | Test runner compatible con Vite, mismo API que Jest | ✅ Instalado |
| **@testing-library/react** | Renderizado y queries de componentes React | ✅ Instalado |
| **@testing-library/jest-dom** | Matchers adicionales (toBeInTheDocument, etc.) | ✅ Instalado |
| **@testing-library/user-event** | Simulación de interacciones reales de usuario (click, type, tab) | 🔴 NO instalado |
| **jsdom** | Entorno de DOM para tests sin navegador | ✅ Instalado |
| **@vitest/coverage-v8** | Cobertura de código vía V8 | 🔴 NO instalado |
| **msw** (Mock Service Worker) | Mock de HTTP a nivel de red para tests de servicios y componentes | 🔴 NO instalado |
| **Playwright** | Tests E2E multi-navegador | 🔴 NO instalado |
| **@pharmacy/database/local** | PrismaClient local (PGlite) — usado por todos los servicios de dominio | ✅ Ya es dependencia |

---

## 3. Correcciones de Infraestructura

Antes de escribir cualquier test, completar la infraestructura:

### 3.1 Dependencias a instalar

```bash
pnpm --filter @pharmacy/pos-desktop add -D @testing-library/user-event @vitest/coverage-v8
# Para Fase 6 (E2E):
pnpm --filter @pharmacy/pos-desktop add -D @playwright/test
```

### 3.2 Configuración de Vitest en `vite.config.ts` (expandir sección `test`)

```typescript
test: {
  environment: "jsdom",
  globals: true,
  setupFiles: ["./vitest.setup.ts"],
  include: ["src/**/*.{test,spec}.{ts,tsx}"],
  coverage: {
    provider: "v8",
    include: ["src/**/*.{ts,tsx}"],
    exclude: [
      "src/**/*.test.{ts,tsx}",
      "src/**/*.spec.{ts,tsx}",
      "src/renderer/dev/**",
      "src/renderer/styles/**",
      "src/renderer/i18n/locales/**",
      "src-tauri/**",
    ],
    thresholds: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  css: true,
},
```

### 3.3 Estructura de archivos de test (colocados al lado del fuente)

```
src/
├── common/
│   ├── domain-error.test.ts          ← nuevo
│   ├── is-online.test.ts             ← nuevo
│   └── sync-metadata.test.ts         ← nuevo
├── domain/
│   ├── auth/
│   │   └── auth.service.test.ts      ← nuevo
│   ├── cash-shift/
│   │   └── cash-shift.service.test.ts ← nuevo
│   ├── catalog/
│   │   ├── catalog-sync.service.test.ts ← nuevo
│   │   └── payment-method-sync.service.test.ts ← nuevo
│   ├── clients/
│   │   ├── clients.service.test.ts    ← nuevo
│   │   └── client-pull.service.test.ts ← nuevo
│   ├── configuration/
│   │   ├── config-sync.service.test.ts ← nuevo
│   │   └── local-config.store.test.ts ← nuevo
│   ├── inventory-adjustments/
│   │   └── inventory-adjustments.service.test.ts ← nuevo
│   ├── inventory-lots/
│   │   └── inventory-lots.service.test.ts ← nuevo
│   ├── prescriptions/
│   │   └── prescriptions.service.test.ts ← nuevo
│   ├── returns/
│   │   └── returns.service.test.ts    ← nuevo
│   ├── sales-pos/
│   │   └── sales-pos.service.test.ts  ← nuevo
│   └── sync/
│       ├── sync-push.service.test.ts  ← nuevo
│       ├── sync-metrics.service.test.ts ← nuevo
│       ├── sync-recovery.service.test.ts ← nuevo
│       └── sync-scheduler.service.test.ts ← nuevo
├── infrastructure/
│   ├── http-client.test.ts            ← nuevo
│   └── sync-metadata.test.ts          (ya cubierto en common)
├── renderer/
│   ├── hooks/
│   │   ├── use-elapsed-time.test.ts   ← nuevo
│   │   └── use-online-status.test.ts  ← nuevo
│   ├── services/
│   │   └── catalog-service.test.ts    ← nuevo (helpers: isRestricted, isNearExpiry, isLowStock)
│   ├── store/slices/
│   │   ├── sales-slice.test.ts        ← nuevo
│   │   └── ui-slice.test.ts           ← nuevo
│   ├── utils/
│   │   ├── format-currency.test.ts    ← nuevo
│   │   └── format-date.test.ts        ← nuevo
│   └── components/
│       ├── SalesTransaction/
│       │   ├── cart-panel.test.tsx     ← nuevo
│       │   ├── product-search.test.tsx ← nuevo
│       │   └── totals-summary.test.tsx ← nuevo
│       ├── PaymentProcessing/
│       │   └── payment-processing.test.tsx ← EXISTE (4 tests)
│       ├── Navigation/
│       │   └── navigation-sidebar.test.tsx ← nuevo
│       ├── returns/
│       │   └── returns.page.test.tsx   ← nuevo
│       ├── inventory-adjustments/
│       │   └── inventory-adjustments.page.test.tsx ← nuevo
│       ├── prescriptions/
│       │   └── prescriptions.page.test.tsx ← nuevo
│       ├── sync/
│       │   └── sync-health.page.test.tsx ← nuevo
│       ├── Receipt/
│       │   └── receipt.test.tsx        ← nuevo
│       └── common/
│           ├── currency-input.test.tsx ← nuevo
│           ├── operation-queued-toast.test.tsx ← nuevo
│           └── sync-pulse.test.tsx     ← nuevo
└── e2e/                                ← nuevo directorio
    ├── sales-flow.spec.ts              ← nuevo
    ├── returns-flow.spec.ts            ← nuevo
    └── sync-flow.spec.ts               ← nuevo
```

---

## 4. Plan de Ejecución por Fases

El plan se ejecuta en **6 fases**, ordenadas por relación costo/beneficio: primero lo más fácil y de mayor impacto (utilidades, servicios de dominio), luego componentes React, y finalmente E2E.

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Fase 1: Utilidades, Hooks, Common     ████████████████████  0.5 días   44 tests   │ ✅ COMPLETADA
│ Fase 2: Servicios de Dominio          ████████████████████  5-7 días  ~140 tests  │ ✅ COMPLETADA
│ Fase 3: Redux Slices Faltantes        ████████████████████  1 día     ~49 tests   │ ✅ COMPLETADA
│ Fase 4: Componentes — Flujo de Venta  ████████████████████  2 días    ~52 tests   │ ✅ COMPLETADA
│ Fase 5: Componentes — Páginas y Nav   ████████████████████  3 días    ~99 tests   │ ✅ COMPLETADA
│ Fase 6: E2E con Playwright            ████████████████████  1 día      ~12 tests  │ ✅ COMPLETADA
├──────────────────────────────────────────────────────────────────────────────────────┤
│ TOTAL COMPLETADO: ~567 tests (F1-F6)                                                    │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Fase 1: Utilidades, Hooks y Common

**Objetivo:** Empezar con lo más simple — funciones puras sin dependencias externas. Rápido de escribir, alta relación señal/ruido.

**Estado:** 🟢 **COMPLETADA** — 44 tests en 8 archivos (vs ~25 estimados).

> **Nota:** Se agregó `time-format.test.ts` para cubrir `common/time-format.ts` (funciones `formatRelativeTime` y `formatBackupAge`), que existe en el código pero no estaba en el plan original. También se corrigieron los valores esperados de `formatCurrency`: el locale `es-CO` inserta un espacio de no separación (`\u00a0`) entre `$` y el monto, y 500000 COP se representa como `$ 500.000` (quinientos mil), no `$5.000`.

### 5.1 `format-currency.ts` ✅

`src/renderer/utils/format-currency.test.ts` — 6 tests.

| ID | Escenario | Entrada | Esperado | Resultado |
|----|-----------|---------|----------|-----------|
| FCY-01 | Cero pesos | `0` | `"$ 0"` (con NBSP) | ✅ |
| FCY-02 | Pesos exactos | `500000` | `"$ 500.000"` | ✅ |
| FCY-03 | Con centavos (redondea) | `500050` | `"$ 500.050"` | ✅ |
| FCY-04 | Valor negativo | `-100000` | `"-$ 100.000"` | ✅ |
| FCY-05 | Valor grande | `150000000` | `"$ 150.000.000"` | ✅ |
| FCY-06 | Formato es-CO, sin decimales | `123456` | Usa `es-CO`, `maximumFractionDigits: 0`, sin coma decimal | ✅ |

### 5.2 `format-date.ts` ✅

`src/renderer/utils/format-date.test.ts` — 4 tests.

| ID | Escenario | Entrada | Esperado | Resultado |
|----|-----------|---------|----------|-----------|
| FDT-01 | Fecha ISO válida | `"2026-07-09T10:30:00.000Z"` | Formato dd/mm/yy | ✅ |
| FDT-02 | Fecha en pasado | `"2025-01-15"` | Formato dd/mm/yy | ✅ |
| FDT-03 | String inválido | `"not-a-date"` | Retorna el mismo string | ✅ |
| FDT-04 | String vacío | `""` | Retorna `""` | ✅ |

### 5.3 `sync-metadata.ts` ✅

`src/common/sync-metadata.test.ts` — 11 tests.

| ID | Escenario | Setup | Esperado | Resultado |
|----|-----------|-------|----------|-----------|
| SYNM-01 | `readSyncMetadata()` sin datos previos | localStorage vacío | Defaults con todos `null` | ✅ |
| *extra* | `readSyncMetadata()` con JSON malformado | `localStorage` con `"not-json"` | Defaults (no crashea) | ✅ |
| SYNM-02 | `getCatalogLastSyncedAt()` sin datos | localStorage vacío | `null` | ✅ |
| SYNM-03 | `setCatalogLastSyncedAt()` + get | Set timestamp | Mismo timestamp | ✅ |
| SYNM-05 | `setCatalogLastSyncedAt()` sobrescribe | Set dos veces | Último valor persiste | ✅ |
| SYNM-06 | Persistencia entre llamadas | Set, get dos veces | Mismo valor | ✅ |
| *extra* | `getLotsLastSyncedAt()` sin datos | — | `null` | ✅ |
| *extra* | `setLotsLastSyncedAt()` + get | Set timestamp | Mismo timestamp | ✅ |
| *extra* | `getClientsLastSyncedAt()` sin datos | — | `null` | ✅ |
| *extra* | `setClientsLastSyncedAt()` + get | Set timestamp | Mismo timestamp | ✅ |
| SYNM-04 | Múltiples timestamps independientes | catalog, lots, clients diferentes | Cada uno retorna su valor sin interferencia | ✅ |

### 5.4 `domain-error.ts` ✅

`src/common/domain-error.test.ts` — 4 tests.

| ID | Escenario | Esperado | Resultado |
|----|-----------|----------|-----------|
| DERR-01 | Constructor setea `errorCode` y `message` | `errorCode === 'SHIFT_ALREADY_OPEN'`, `message` personalizado | ✅ |
| DERR-02 | `DomainError` es instancia de `Error` | `instanceof Error === true` | ✅ |
| *extra* | `name` es el nombre del constructor | `name === 'DomainError'` | ✅ |
| DERR-03 | `DomainError` tiene stack trace | `stack` contiene "DomainError" | ✅ |

### 5.5 `is-online.ts` ✅

`src/common/is-online.test.ts` — 2 tests.

| ID | Escenario | Setup | Esperado | Resultado |
|----|-----------|-------|----------|-----------|
| ONL-01 | Navegador online | `navigator.onLine = true` | `true` | ✅ |
| ONL-02 | Navegador offline | `navigator.onLine = false` | `false` | ✅ |

### 5.6 Hooks React ✅

#### `use-elapsed-time.ts` — `src/renderer/hooks/use-elapsed-time.test.tsx` (4 tests)

| ID | Escenario | Esperado | Resultado |
|----|-----------|----------|-----------|
| UET-01 | Tiempo desde apertura (ahora) | `"00:00"` | ✅ |
| UET-02 | 1 hora de diferencia | `"01:00"` | ✅ |
| UET-03 | Turno cerrado (`isRunning = false`) | No avanza el timer | ✅ |
| UET-04 | Timer se actualiza cada 60s | Avanza a `"01:01"` tras intervalo | ✅ |

#### `use-online-status.ts` — `src/renderer/hooks/use-online-status.test.tsx` (4 tests)

| ID | Escenario | Esperado | Resultado |
|----|-----------|----------|-----------|
| UOS-01 | Estado inicial online | `"online"` | ✅ |
| UOS-02 | Evento `online` (desde offline) | Cambia a `"online"` | ✅ |
| UOS-03 | Evento `offline` | Cambia a `"offline"` | ✅ |
| UOS-04 | Cleanup al desmontar | Listener removido (no hay fuga) | ✅ |

### 5.7 Extra: `time-format.ts` ✅

`src/common/time-format.test.ts` — 9 tests. No estaba en el plan original pero se agregó porque `common/time-format.ts` existe en el código.

Cubre `formatRelativeTime` (5 tests: "just now", "5m ago", "3h ago", "2d ago", fecha localizada >7d) y `formatBackupAge` (4 tests: "just now", "15m ago", "6h ago", "3d ago") usando `vi.useFakeTimers()` para determinismo.

---

## 6. Fase 2: Servicios de Dominio

**Objetivo:** Probar la lógica de negocio de cada servicio de dominio de forma aislada. Estos servicios son la capa más crítica porque manejan ventas, inventario, sincronización y caja.

**Estado:** 🟢 **COMPLETADA** — **~146 tests en 17 archivos** (todos los servicios de dominio).

**Estrategia de mocking:**
- **PGlite/Prisma local:** Usar un spy/mock del PrismaClient local. Los servicios reciben el `prisma` como dependencia, así que se puede inyectar un mock tipado.
- **HTTP (fetch):** Mockear el cliente HTTP (`HttpClient`) que los servicios de sync usan para pull del servidor.
- **AuthService:** Mockear `authService.requireRole()` y `authService.getCurrentSession()`.
- **SyncQueue:** Los servicios crean entradas en `syncQueue`. El mock de Prisma debe tener `syncQueue.create` y `syncQueue.findFirst`.

**Ubicación de tests:** Colocados al lado del fuente, ej: `src/domain/sales-pos/sales-pos.service.test.ts`.

### 6.1 SalesPosService

**Archivo:** `src/domain/sales-pos/sales-pos.service.ts`
**Dependencias a mockear:** PrismaClient (local), AuthService, InventoryLotsService

| ID | Escenario | Setup | Esperado |
|----|-----------|-------|----------|
| SALE-01 | `create()` con items válidos | Productos existen en BD local, `auth.requireRole(['CASHIER', 'ADMIN'])` pasa | Crea `Sale` con `operationalState: IN_PROGRESS`, items con snapshots, `localNumber` auto-incremental |
| SALE-02 | `create()` con cliente existente | `clientId` válido en BD local | Incluye snapshot de cliente en la venta |
| SALE-03 | `create()` sin cliente | `clientId` omitido | Venta se crea sin snapshot de cliente |
| SALE-04 | `create()` producto no encontrado | `prisma.product.findUnique → null` | Lanza excepción de dominio |
| SALE-05 | `create()` solo permite FREE_SALE | Producto con `saleType = 'PRESCRIPTION'` | Lanza `PrescriptionRequiredNotSupportedException` |
| SALE-06 | `create()` con descuento | Items con `discountPercentage = 10` | `discountAmount` calculado correctamente en el snapshot |
| SALE-07 | `create()` con IVA | Producto con `taxPercentage = 19` | `taxAmount` calculado: `subtotal * 0.19` |
| SALE-08 | `create()` retry en localNumber duplicado | Primer `create` da P2002 en `localNumber` | Reintenta con `localNumber + 1`, máximo N intentos |
| SALE-09 | `create()` crea entrada en SyncQueue | Cualquier creación exitosa | `prisma.syncQueue.create` llamado con `operationType: 'SALE_CREATION'` |
| SALE-10 | `create()` IDs generados con crypto | — | `sale.id`, `item.id` son UUIDs válidos |

#### Grupo B: `confirm()`

| ID | Escenario | Setup | Esperado |
|----|-----------|-------|----------|
| SALE-11 | `confirm()` exitoso | Venta en `IN_PROGRESS`, pagos cubren el total | `operationalState: CONFIRMED`. `InventoryLotsService.consumeStockForSale` llamado por cada item. `SalePayment` creados. SyncQueue: `SALE_CONFIRMATION`. |
| SALE-12 | `confirm()` venta no en IN_PROGRESS | `operationalState = 'CONFIRMED'` | Lanza `SaleNotInProgressException` |
| SALE-13 | `confirm()` venta no encontrada | `prisma.sale.findUnique → null` | Lanza `SaleNotFoundException` |
| SALE-14 | `confirm()` pagos no cubren total | `sum(payments.amount) < sale.totalAmount` | Lanza `PaymentAmountMismatchException` |
| SALE-15 | `confirm()` cambio sin método CASH | `totalPaid > total`, pero no hay método CASH entre los pagos | Lanza `ChangeRequiresCashPaymentException` |
| SALE-16 | `confirm()` múltiples métodos de pago | `CASH: 50000, DEBIT_CARD: 30000` | Ambos `SalePayment` creados |
| SALE-17 | `confirm()` stock insuficiente | `InventoryLotsService.consumeStockForSale` lanza `InsufficientStockException` | La confirmación falla, transacción revierte |

### 6.2 InventoryLotsService

**Archivo:** `src/domain/inventory-lots/inventory-lots.service.ts`
**Dependencias a mockear:** PrismaClient (local)

| ID | Escenario | Setup | Esperado |
|----|-----------|-------|----------|
| LOT-01 | `consumeStockForSale()` un solo lote | 1 lote ACTIVE con `currentStock >= quantity` | Retorna `[{ lotId, quantity, unitCostAtSale }]`. Stock decrementado, version incrementada. |
| LOT-02 | `consumeStockForSale()` FEFO con 2 lotes | Lote A: expira 2027-01, Lote B: expira 2026-06 | Consume primero del Lote B (FEFO = First Expired First Out) |
| LOT-03 | `consumeStockForSale()` stock insuficiente total | `sum(currentStock) < quantity` | Lanza `InsufficientStockException` |
| LOT-04 | `consumeStockForSale()` optimistic locking falla | `updateMany` retorna `{ count: 0 }` | Lanza `ConcurrentStockModificationException` |
| LOT-05 | `consumeStockForSale()` lote EXHAUSTED después de consumo | `currentStock = 5`, `quantity = 5` | `state` cambia a `EXHAUSTED` |
| LOT-06 | `consumeStockForSale()` ignora lotes BLOCKED | Un lote ACTIVE y uno BLOCKED | Solo consume del ACTIVE |
| LOT-07 | `consumeStockForSale()` ignora lotes EXPIRED | `expirationDate < now` | No incluye lotes EXPIRED en resultados |

### 6.3 ReturnsService

**Archivo:** `src/domain/returns/returns.service.ts`
**Dependencias a mockear:** PrismaClient (local), AuthService

| ID | Escenario | Setup | Esperado |
|----|-----------|-------|----------|
| RET-01 | `create()` devolución verificada | Sale existe, CONFIRMED, items válidos | Crea `ClientReturn` con `state: DRAFT`, items con lotes. SyncQueue: `CLIENT_RETURN`. |
| RET-02 | `create()` venta no encontrada | `prisma.sale.findUnique → null` | Lanza `SaleForReturnNotFoundException` |
| RET-03 | `create()` venta no confirmada | `operationalState = 'IN_PROGRESS'` | Lanza `SaleNotConfirmedForReturnException` |
| RET-04 | `create()` cantidad excede venta original | `quantity = 10`, pero la venta original fue de 5 | Lanza `ReturnQuantityExceedsSaleException` |
| RET-05 | `create()` item no pertenece a la venta | `saleItemId` no está en la venta | Lanza `ReturnSaleItemNotFoundException` |
| RET-06 | `create()` devolución no verificada (cross-workstation) | Venta de otra workstation | Crea igual pero con flag de no verificada |
| RET-07 | `confirm()` exitoso | `state: DRAFT`, stock se revierte | `state: CONFIRMED`. `InventoryLotsService` revierte stock. |
| RET-08 | `confirm()` no en DRAFT | `state = 'CONFIRMED'` | Lanza `ReturnNotInDraftException` |
| RET-09 | `confirm()` falla reversión de stock | `LotsService` lanza error | Lanza `ReturnStockReversalFailedException` |
| RET-10 | `searchSale()` por localNumber | Sale existe | Retorna datos de venta con items |
| RET-11 | `searchSale()` venta no encontrada | Query no matchea | Retorna `null` |

### 6.4 CashShiftService

**Archivo:** `src/domain/cash-shift/cash-shift.service.ts`
**Dependencias a mockear:** PrismaClient (local), AuthService

| ID | Escenario | Setup | Esperado |
|----|-----------|-------|----------|
| CS-01 | `openShift()` sin turno abierto | `prisma.cashShift.findFirst({ state: 'OPEN' }) → null` | Crea turno con `state: OPEN`, `openingBalance`, `workstationId` |
| CS-02 | `openShift()` con turno ya abierto | `findFirst` retorna turno OPEN existente | Lanza `ShiftAlreadyOpenException` |
| CS-03 | `registerCashCount()` tipo PARTIAL | Turno OPEN, payment method válido | Crea `ShiftCashCount` con `countType: PARTIAL` |
| CS-04 | `registerCashCount()` tipo CLOSING | Mismo setup | Crea `ShiftCashCount` con `countType: CLOSING` |
| CS-05 | `registerCashCount()` método no efectivo con denominaciones | `paymentMethod.isCash = false`, `denominationsBreakdown` presente | Lanza `InvalidCashCountForNonCashMethodException` |
| CS-06 | `closeShift()` exitoso | Conteos CLOSING para todos los métodos | `state: CLOSED`, `closedAt` seteado, `actualClosingAmount` calculado de conteos |
| CS-07 | `closeShift()` sin conteos CLOSING | No hay `ShiftCashCount` con `countType: CLOSING` | Lanza `MissingClosingCashCountsException` |
| CS-08 | `closeShift()` turno ya cerrado | `state = 'CLOSED'` | Lanza `ShiftNotOpenException` |

### 6.5 ClientsService

**Archivo:** `src/domain/clients/clients.service.ts`
**Dependencias a mockear:** PrismaClient (local), AuthService

| ID | Escenario | Setup | Esperado |
|----|-----------|-------|----------|
| CL-01 | `search()` sin query | Sin filtro | Retorna todos los clientes (limitados) |
| CL-02 | `search()` por nombre | `query = "Juan"` | `findMany` con `where: { fullName: { contains: "Juan" } }` |
| CL-03 | `search()` por identificación | `query = "123456"` | `where` incluye `identificationNumber` |
| CL-04 | `search()` sin resultados | BD vacía | Retorna `[]` |
| CL-05 | `create()` cliente nuevo | Datos completos, no existe duplicado | Crea `Client` en BD local. SyncQueue: `CLIENT_CREATION`. |
| CL-06 | `create()` duplicado | Misma `identificationType + identificationNumber` | Lanza excepción de dominio o maneja upsert |
| CL-07 | `create()` campos opcionales omitidos | Solo `fullName`, `identificationType`, `identificationNumber` | Crea con `email: null`, `phone: null` |

### 6.6 SyncPushService

**Archivo:** `src/domain/sync/sync-push.service.ts`
**Dependencias a mockear:** PrismaClient (local), HttpClient (fetch)

| ID | Escenario | Setup | Esperado |
|----|-----------|-------|----------|
| SYP-01 | `pushPending()` sin entradas | `syncQueue.findMany({ state: PENDING }) → []` | `{ pushed: 0, accepted: 0 }` |
| SYP-02 | `pushPending()` batch exitoso | 3 entradas PENDING, server responde 200 | Las 3 marcadas como `PROCESSED` |
| SYP-03 | `pushPending()` fallo de red | fetch lanza `TypeError` | `classifyFailure` retorna `NETWORK`. Entrada marcada `FAILED`. `retryCount` incrementado. |
| SYP-04 | `pushPending()` fallo 409 CONFLICT | Server responde 409 | `classifyFailure` retorna `CONFLICT`. Entrada marcada `FAILED`. |
| SYP-05 | `pushPending()` fallo 422 VALIDATION | Server responde 422 con body | `classifyFailure` retorna `VALIDATION`. Entrada marcada `PERMANENT_FAILURE`. |
| SYP-06 | `pushPending()` fallo 401/403 AUTH | Server responde 401 | `classifyFailure` retorna `AUTH`. No se marca PERMANENT_FAILURE inmediatamente. |
| SYP-07 | `pushPending()` exponential backoff | Retry count 3 | `computeNextRetryDelay(3)` retorna delay creciente |
| SYP-08 | `pushPending()` max retries alcanzado | `retryCount >= MAX_RETRY_ATTEMPTS` | Entrada marcada `PERMANENT_FAILURE` |
| SYP-09 | `pushPending()` batch respeta límite | 15 entradas PENDING, `PUSH_BATCH_LIMIT = 10` | Solo procesa 10 |
| SYP-10 | `pushPending()` mezcla aceptados y fallidos | 5 entradas: 3 OK, 1 NETWORK, 1 VALIDATION | `{ pushed: 5, accepted: 3 }` |

### 6.7 SyncMetricsService

**Archivo:** `src/domain/sync/sync-metrics.service.ts`
**Dependencias a mockear:** PrismaClient (local)

| ID | Escenario | Setup | Esperado |
|----|-----------|-------|----------|
| SYM-01 | `getQueueCounts()` con datos mixtos | Entradas en varios estados | Retorna conteos correctos: `{ pending, stalePending, failed, permanentFailure, completed24h, completedTotal }` |
| SYM-02 | `getQueueCounts()` sin datos | BD vacía | Todos los conteos en 0 |
| SYM-03 | `getQueueCounts()` stale pending | Entrada PENDING con `createdAt > 1h` | `stalePending = 1` |
| SYM-04 | `getFailureBreakdown()` | Entradas FAILED y PERMANENT_FAILURE con distintas categorías | Agrupado por `failureCategory` con conteo y `mostRecent` |
| SYM-05 | `getPermanentFailureEntries()` paginado | 50 entradas, `cursor` en entrada 20 | Retorna página de 20 con `hasMore: true` |
| SYM-06 | `getSyncHealthTimeline()` | Entradas completadas y no completadas en últimas 24h | Buckets por hora con conteos |
| SYM-07 | `exportEntriesAsCsv()` | 5 entradas | CSV con headers y 5 filas |
| SYM-08 | `exportEntriesAsJson()` | 5 entradas | JSON array con 5 objetos |

### 6.8 SyncRecoveryService

**Archivo:** `src/domain/sync/sync-recovery.service.ts`

| ID | Escenario | Setup | Esperado |
|----|-----------|-------|----------|
| SYR-01 | `retryEntry()` exitoso | Entrada en PERMANENT_FAILURE, replayable | Estado vuelve a PENDING, `retryCount = 0` |
| SYR-02 | `retryEntry()` no en PERMANENT_FAILURE | `state = 'PENDING'` | Lanza `EntryNotInPermanentFailureException` |
| SYR-03 | `retryEntry()` re-snapshot para SALE_CONFIRMATION | `operationType = 'SALE_CONFIRMATION'` | `payloadResnapshotted: true` en respuesta |
| SYR-04 | `retryEntry()` no replayable | `operationType` sin snapshot generator | Lanza `EntryNotReplayableException` |
| SYR-05 | `discardEntry()` exitoso | Entrada en PERMANENT_FAILURE | `state: DISCARDED`, `discardReason` y `discardedByUserId` registrados |
| SYR-06 | `retryEntry()` entrada modificada concurrentemente | `version` cambió entre lectura y escritura | Lanza `EntryStateChangedException` |

### 6.9 SyncSchedulerService

**Archivo:** `src/domain/sync/sync-scheduler.service.ts`

| ID | Escenario | Setup | Esperado |
|----|-----------|-------|----------|
| SCH-01 | `start()` inicia intervalo | — | `setInterval` llamado con `intervalMs` |
| SCH-02 | `stop()` limpia intervalo | `start()` previo | `clearInterval` llamado |
| SCH-03 | `syncNow()` hace push + pull | Mock de servicios | Llama `pushPending()`, luego `pullCatalog()`, `pullLots()`, `pullClients()` |
| SCH-04 | `syncNow()` falla silenciosamente | `pushPending()` lanza error | No crashea, loguea el error, continúa con pull |
| SCH-05 | `syncNow()` respeta orden | — | Push primero (datos locales → server), luego pull (server → local) |

### 6.10 AuthService

**Archivo:** `src/domain/auth/auth.service.ts`
**Dependencias a mockear:** HttpClient (fetch), Zustand store

| ID | Escenario | Setup | Esperado |
|----|-----------|-------|----------|
| AUTH-01 | `login()` exitoso | Server retorna 200 con `accessToken`, `user`, `workstationId` | `setSession()` llamado. Retorna `LocalSession`. |
| AUTH-02 | `login()` credenciales inválidas | Server retorna 401 | Lanza `InvalidCredentialsException` |
| AUTH-03 | `login()` error de red | fetch lanza `TypeError` | Lanza excepción con mensaje descriptivo |
| AUTH-04 | `getCurrentSession()` con sesión activa | Store tiene session | Retorna `LocalSession` |
| AUTH-05 | `getCurrentSession()` sin sesión | Store vacío | Retorna `null` |
| AUTH-06 | `requireRole()` rol autorizado | `session.role = 'ADMIN'`, `allowedRoles = ['ADMIN']` | Retorna session |
| AUTH-07 | `requireRole()` rol no autorizado | `session.role = 'CASHIER'`, `allowedRoles = ['ADMIN']` | Lanza `InsufficientRoleException` |
| AUTH-08 | `requireRole()` sin sesión | Store vacío | Lanza `NoActiveSessionException` |
| AUTH-09 | `logout()` | Sesión activa | `clearSession()` llamado |

### 6.11 CatalogSyncService

**Archivo:** `src/domain/catalog/catalog-sync.service.ts`

| ID | Escenario | Setup | Esperado |
|----|-----------|-------|----------|
| CSYNC-01 | `pullCatalog()` primer sync | `catalogLastSyncedAt = null`, server retorna productos, categorías, formas farmacéuticas | Upsert de productos, categorías, formas en PGlite. `catalogLastSyncedAt` actualizado. |
| CSYNC-02 | `pullCatalog()` incremental | `catalogLastSyncedAt = "2026-07-08"`, server retorna solo cambios | Solo procesa registros modificados después de la fecha |
| CSYNC-03 | `pullCatalog()` sin cambios | Server retorna arrays vacíos | No modifica BD local |
| CSYNC-04 | `pullCatalog()` error HTTP | Server retorna 500 | Lanza `CatalogSyncHttpError` |
| CSYNC-05 | `pullCatalog()` error de red | fetch lanza `TypeError` | Lanza `CatalogSyncHttpError` |
| CSYNC-06 | `pullCatalog()` upsert de productos | Producto ya existe en BD local | Actualiza en vez de duplicar |

### 6.12 Servicios restantes (sync, prescriptions, inventory-adjustments, config, lot-sync, client-pull, payment-method-sync)

| Servicio | Tests est. | Escenarios clave |
|----------|-----------|-----------------|
| `prescriptions.service.ts` | ~8 | Crear fórmula con campos requeridos, validar sustancias controladas, SyncQueue |
| `inventory-adjustments.service.ts` | ~8 | Buscar lotes, crear ajuste (aumentar/disminuir), aplicar, validar stock |
| `config-sync.service.ts` | ~5 | Pull de configuración del server, hydrate Zustand store, upsert payment methods |
| `local-config.store.ts` | ~5 | Hydrate, leer discount limits, alert thresholds, sync defaults |
| `lot-sync.service.ts` | ~4 | Pull de lotes del server, incremental, upsert local |
| `client-pull.service.ts` | ~4 | Pull de clientes del server, incremental, upsert local |
| `payment-method-sync.service.ts` | ~3 | Upsert de métodos de pago desde payload del server |

---

## 7. Fase 3: Redux Slices Faltantes

**Objetivo:** Completar tests de todos los slices de Redux. `payment-slice` ya está cubierto (13 tests). Faltan `sales-slice` y `ui-slice`.

**Estado:** 🟢 **COMPLETADA** — **49 tests en 2 archivos** (sales-slice: 22 tests, ui-slice: 27 tests).

> **Nota:** `sales-slice.addItem` agrupa por `id` (no por `productId`), así que SS-04 del plan original no aplica — se reemplazó por dos tests: merge cuando `id` coincide y líneas separadas cuando `id` difiere. `taxPercentage` del item no se usa individualmente; el IVA es fijo al 19% vía `TAX_RATE` en el slice.

**Estrategia:** Tests puros de slice — no requieren React ni DOM. Se testea el reducer directamente con acciones y se verifican selectores.

### 7.1 `sales-slice.ts`

Reducers: `addItem`, `removeItem`, `updateQuantity`, `clearCart`
Selectors: `selectCartItems`, `selectCartItemCount`, `selectSubtotalCents`, `selectTaxCents`, `selectTotalCents`

| ID | Escenario | Setup | Esperado |
|----|-----------|-------|----------|
| SS-01 | Estado inicial | Sin acciones | `items: []`, `itemCount: 0`, `subtotal: 0`, `tax: 0`, `total: 0` |
| SS-02 | `addItem` primer item | Producto con `unitPriceCents = 500000`, `taxPercentage = 19` | `items.length = 1`. `subtotal = 500000`, `tax = 95000`, `total = 595000`. |
| SS-03 | `addItem` acumula subtotal | Dos items de 500000 y 300000 | `subtotal = 800000`, `tax = 152000`, `total = 952000` |
| SS-04 | `addItem` mismo producto | Mismo `productId` dos veces | `items.length = 2` (no agrupa — cada línea es independiente) |
| SS-05 | `addItem` con descuento | `discountPercentage = 10` | `subtotal` calculado con descuento aplicado |
| SS-06 | `removeItem` | 3 items, remover el segundo | `items.length = 2`, totales recalculados |
| SS-07 | `updateQuantity` aumenta | `quantity = 1 → 3` | `subtotal` y totales multiplicados por 3 |
| SS-08 | `updateQuantity` disminuye (mínimo 1) | `quantity = 3 → 1` | `subtotal` dividido por 3 |
| SS-09 | `clearCart` | 5 items en carrito | `items = []`, todos los totales en 0 |
| SS-10 | `selectCartItemCount` | 3 items con cantidades 2, 1, 4 | Retorna `7` |
| SS-11 | `selectSubtotalCents` producto sin IVA | `taxPercentage = 0` | `subtotal = unitPriceCents * quantity` |
| SS-12 | `selectTaxCents` redondea | `subtotal = 100`, `taxPercentage = 19` | `tax = 19` (no 19.0 — entero) |

### 7.2 `ui-slice.ts`

Reducers: `setActiveScreen`, `navigateToReturns`, `navigateToInventoryAdjustments`, `navigateToPrescriptions`, `navigateToAdminMenu`, `navigateToSyncHealth`, `navigateBackToSales`, `initiateSaleCompletion`, `navigateToReceipt`, `completeSaleCompletion`, `resetSaleFlow`, `setPrescriptionFlow`, `clearPrescriptionFlow`, `resolveNextPrescriptionItem`
Selectors: `selectActiveScreen`, `selectSaleCompletionPhase`, `selectPrescriptionFlow`

| ID | Escenario | Setup | Esperado |
|----|-----------|-------|----------|
| UI-01 | Estado inicial | — | `activeScreen = 'sales'`, `saleCompletionPhase = 'idle'`, `prescriptionFlow = null` |
| UI-02 | `setActiveScreen` | `setActiveScreen('returns')` | `activeScreen = 'returns'` |
| UI-03 | `navigateToReturns` | — | `activeScreen = 'returns'` |
| UI-04 | `navigateBackToSales` | Pantalla actual `returns` | `activeScreen = 'sales'` |
| UI-05 | `initiateSaleCompletion` | Carrito con items | `saleCompletionPhase = 'completing'` |
| UI-06 | `navigateToReceipt` | Después de `initiateSaleCompletion` | `activeScreen = 'receipt'`, `saleCompletionPhase = 'completed'` |
| UI-07 | `completeSaleCompletion` | — | `saleCompletionPhase = 'completed'` |
| UI-08 | `resetSaleFlow` | Flujo completo terminado | `activeScreen = 'sales'`, `saleCompletionPhase = 'idle'` |
| UI-09 | `setPrescriptionFlow` con items pendientes | `{ pendingSaleId, pendingItemId, incompleteItemIds: ['a', 'b'] }` | `prescriptionFlow` seteado con los 3 campos |
| UI-10 | `resolveNextPrescriptionItem` remueve el primero | `incompleteItemIds = ['a', 'b', 'c']` | `incompleteItemIds = ['b', 'c']`, `pendingItemId = 'b'` |
| UI-11 | `resolveNextPrescriptionItem` último item | `incompleteItemIds = ['a']` | `incompleteItemIds = []`, `pendingItemId = null` |
| UI-12 | `clearPrescriptionFlow` | Flujo de prescripción activo | `prescriptionFlow = null` |

---

## 8. Fase 4: Componentes React — Flujo de Venta

**Objetivo:** Testear los componentes del flujo principal de venta (SalesTransaction → PaymentProcessing → Receipt). Verificar renderizado, interacciones de usuario, y estados.

**Estado:** ✅ **COMPLETADA** — **52 tests nuevos** en 6 archivos. Todos pasando.

**Herramientas:** `@testing-library/react` + `@testing-library/user-event` + `@testing-library/jest-dom`.

**Estrategia de mocking:**
- **Redux store:** Usar un store real de Redux con estado inicial controlado, o `Provider` con store mockeado.
- **CatalogService:** Mock de `CatalogService` con `createMockCatalogService()`.
- **Servicios de dominio:** No se usan directamente en componentes; los componentes usan Redux y context providers.
- **i18n:** Ya inicializado en `vitest.setup.ts`.

### 8.1 `totals-summary.test.tsx`

Componente puro: recibe props y renderiza.

| ID | Escenario | Props | Esperado |
|----|-----------|-------|----------|
| TS-01 | Renderiza subtotal, IVA, total | `{ subtotalCents: 500000, taxCents: 95000, totalCents: 595000 }` | Texto visible: "$5.000", "$950", "$5.950" |
| TS-02 | Totales en cero | `{ subtotalCents: 0, taxCents: 0, totalCents: 0 }` | "$0" en los tres |

### 8.2 `cart-panel.test.tsx`

Componente conectado a Redux. Usa `selectCartItems`, `selectSubtotalCents`, etc.

| ID | Escenario | Setup | Esperado |
|----|-----------|-------|----------|
| CP-01 | Carrito vacío | Sin items | Muestra mensaje de carrito vacío. Botón checkout deshabilitado. |
| CP-02 | Carrito con 1 item | 1 item con nombre, cantidad, precio | Nombre, cantidad (1), subtotal visibles |
| CP-03 | Botón checkout llama `onCheckout` | `onCheckout = vi.fn()` | Click en "Cobrar" dispara callback |
| CP-04 | `updateQuantity` desde línea de item | Click botón "+" | Cantidad incrementa, totales actualizados |
| CP-05 | `removeItem` desde línea de item | Click botón eliminar | Item removido, carrito vacío si era el único |

### 8.3 `product-search.test.tsx`

| ID | Escenario | Setup | Esperado |
|----|-----------|-------|----------|
| PS-01 | Búsqueda con resultados | `catalogService.search → [producto1, producto2]` | 2 tarjetas de producto renderizadas |
| PS-02 | Búsqueda sin resultados | `catalogService.search → []` | Mensaje "Sin resultados" |
| PS-03 | Input debounced | Escribe rápido "para" | Solo 1 llamada al servicio tras debounce |
| PS-04 | Selección de producto | Click en resultado | `onSelect` llamado con el producto |
| PS-05 | Loading state | `search` tarda | Spinner o indicador de carga visible |
| PS-06 | Badge de stock bajo | `currentStock = 2`, `minimumStock = 5` | Badge "Stock bajo" visible |
| PS-07 | Badge de próximo a vencer | `lotExpirationDate` dentro de 30 días | Badge de advertencia visible |
| PS-08 | Badge de restringido | `isRestricted = true` | Badge de "Venta restringida" visible |
| PS-09 | Teclado: Enter selecciona primer resultado | Press Enter | `onSelect` llamado con el primer item |
| PS-10 | Teclado: Escape cierra resultados | Press Escape | Resultados desaparecen |

### 8.4 `payment-processing.test.tsx` (expandir existente)

Ya existen 4 tests. Agregar:

| ID | Escenario | Setup | Esperado |
|----|-----------|-------|----------|
| PP-05 | Método CASH: cambio calculado | `cashReceivedCents = 600000`, `totalCents = 595000` | Cambio: "$50" visible |
| PP-06 | Método CASH: falta dinero | `cashReceivedCents = 500000`, `totalCents = 595000` | Botón confirmar deshabilitado |
| PP-07 | Agregar método de pago | Click "Agregar método" | Nuevo `PaymentMethodRow` en pantalla |
| PP-08 | Autorización de tarjeta pendiente → aprobada | Mock gateway aprueba | Badge cambia de PENDING a APPROVED |
| PP-09 | Autorización de tarjeta pendiente → rechazada | Mock gateway rechaza | Badge cambia a REJECTED, mensaje de error |
| PP-10 | Prescripción requerida — redirige | Item con `requiresPrescription` y sin fórmula | Flujo de prescripción activado (dispatch `setPrescriptionFlow`) |
| PP-11 | Pantalla de "completando" | Confirmar pago exitoso | Animación de completing visible |

### 8.5 `receipt.test.tsx`

| ID | Escenario | Setup | Esperado |
|----|-----------|-------|----------|
| RCP-01 | Renderiza confirmación | — | Mensaje de éxito, botón "Nueva venta" |
| RCP-02 | "Nueva venta" resetea flujo | Click en botón | `dispatch(resetSaleFlow())` llamado |

### 8.6 `currency-input.test.tsx`

| ID | Escenario | Setup | Esperado |
|----|-----------|-------|----------|
| CI-01 | Renderiza valor inicial | `value = 500000` | Input muestra "5.000" |
| CI-02 | Escribe valor | `userEvent.type(input, '1500000')` | `onChange(1500000)` llamado |
| CI-03 | Solo permite números | `userEvent.type(input, 'abc')` | `onChange` no llamado o valor no cambia |
| CI-04 | Label visible | `label = "Efectivo recibido"` | Label renderizado |

---

## 9. Fase 5: Componentes React — Páginas y Navegación

**Objetivo:** Testear páginas completas (Returns, Inventory Adjustments, Prescriptions, Sync Health) y componentes de navegación/shell.

**Estado:** 🟢 **COMPLETADA** — **99 tests en 8 archivos** (vs ~65 estimados).

### 9.1 `returns.page.test.tsx` ✅

**14 tests.** Archivo: `src/renderer/components/returns/returns.page.test.tsx`.

| ID | Escenario | Resultado |
|----|-----------|-----------|
| RETP-01 | Renderiza tabs "Verificada" y "No verificada" | ✅ |
| RETP-02 | Tab verificada: búsqueda de venta por número | ✅ |
| RETP-03 | Tab verificada: venta encontrada | ✅ |
| RETP-04 | Tab verificada: crear devolución | ✅ |
| RETP-05 | Tab no verificada: campos manuales | ✅ |
| RETP-06 | Tab no verificada: requiere PIN de manager | ✅ |
| RETP-07 | Error de servicio muestra toast | ✅ |

### 9.2 `inventory-adjustments.page.test.tsx` ✅

**11 tests.** Archivo: `src/renderer/components/inventory-adjustments/inventory-adjustments.page.test.tsx`.

| ID | Escenario | Notas | Resultado |
|----|-----------|-------|-----------|
| IADJ-01 | Búsqueda de lotes | Input de búsqueda, resultados con stock actual | ✅ |
| IADJ-02 | Seleccionar lote → populate ajuste | Verifica Stock, Vence, Proyectado visibles | ✅ |
| IADJ-03 | Ajuste positivo (INCREASE) | Click en radio "Aumentar", selecciona motivo no-OTHER, aplica | ✅ |
| IADJ-04 | Ajuste negativo (DECREASE) | Default DECREASE, selecciona motivo no-OTHER, aplica | ✅ |
| IADJ-05 | Error por stock insuficiente | mockCreate rechaza, error banner visible | ✅ |
| IADJ-06 | Motivo OTHER sin texto deshabilita botón | Botón "Aplicar ajuste" deshabilitado | ✅ |
| IADJ-06b | Motivo OTHER con texto personalizado habilita botón | Botón "Aplicar ajuste" habilitado tras escribir motivo | ✅ |

> **Nota:** El componente usa `reason` con default `"OTHER"` y la validación `canSubmit` requiere `reason !== "OTHER"` o `customReason.trim().length > 0`. Todos los tests de submit seleccionan explícitamente un motivo no-OTHER antes de clickear "Aplicar".

### 9.3 `prescriptions.page.test.tsx` ✅

**21 tests.** Archivo: `src/renderer/components/prescriptions/prescriptions.page.test.tsx`.

| ID | Escenario | Resultado |
|----|-----------|-----------|
| PRXP-01 | Formulario con campos básicos | ✅ |
| PRXP-02 | Sustancia controlada: campos adicionales | ✅ |
| PRXP-03 | Validación: campos requeridos para controlada | ✅ |
| PRXP-04 | Registro exitoso y navegación | ✅ |
| PRXP-05 | Flujo multi-item | ✅ |

### 9.4 `sync-health.page.test.tsx` ✅

**13 tests.** Archivo: `src/renderer/components/sync/sync-health.page.test.tsx`.

| ID | Escenario | Notas | Resultado |
|----|-----------|-------|-----------|
| SYNH-00 | Error state | Loading → error → panel con mensaje y botón retry | ✅ |
| SYNH-01 | KPIs renderizados | Tarjetas pending(5), failed(2), permanentFailure(1), completed24h(50) | ✅ |
| SYNH-01b | Permanent failure KPI | Conteo 3 visible | ✅ |
| SYNH-08 | "Run Sync Now" button presente | Botón renderizado | ✅ |
| SYNH-08b | syncNow() llamado al click | `createSyncScheduler` mockeado, `syncNow` verificado | ✅ |
| SYNH-09 | Connection test button | Botón renderizado, fetch a `/sync/status` | ✅ |
| — | Export CSV/JSON | Botones renderizados | ✅ |
| SYNH-10 | Filtro toggles | "Show discarded", "Retry without server check" | ✅ |
| — | No sync data placeholder | Mensaje "No sync data" visible | ✅ |

### 9.5 `navigation-sidebar.test.tsx` ✅

**17 tests.** Archivo: `src/renderer/components/Navigation/navigation-sidebar.test.tsx`.

| ID | Escenario | Resultado |
|----|-----------|-----------|
| NAV-01 | Items visibles para CASHIER | ✅ |
| NAV-02 | Items visibles para ADMIN | ✅ |
| NAV-03 | Badge count en Sync Health | ✅ |
| NAV-04 | Colapsado por defecto | ✅ |
| NAV-05 | Expande en hover | ✅ |
| NAV-06 | Navegación al click | ✅ |

### 9.6 `app-shell.test.tsx` ✅

**7 tests.** Archivo: `src/renderer/components/common/app-shell.test.tsx`.

| ID | Escenario | Resultado |
|----|-----------|-----------|
| APP-01 | Renderiza cash shift header | ✅ |
| APP-02 | Renderiza sync pulse | ✅ |
| APP-03 | Renderiza navigation sidebar | ✅ |
| APP-04 | Renderiza contenido hijo | ✅ |

### 9.7 `operation-queued-toast.test.tsx` ✅

**12 tests.** Archivo: `src/renderer/components/common/operation-queued-toast.test.tsx`.

| ID | Escenario | Resultado |
|----|-----------|-----------|
| OQT-01 | Modo online — toast verde | ✅ |
| OQT-02 | Modo offline — toast gris | ✅ |
| OQT-03 | Auto-dismiss tras intervalo | ✅ |
| OQT-04 | Dismiss manual (click X) | ✅ |

### 9.8 `sync-pulse.test.tsx` ✅

**4 tests.** Archivo: `src/renderer/components/common/sync-pulse.test.tsx`.

| ID | Escenario | Resultado |
|----|-----------|-----------|
| SPP-01 | Estado online | ✅ |
| SPP-02 | Estado offline | ✅ |
| SPP-03 | Estado draining | ✅ |

---

## 10. Fase 6: E2E con Playwright

**Objetivo:** Probar flujos completos de usuario en un navegador real. Estos tests validan la integración real entre React, Redux, PGlite, y los servicios de dominio.

**Estado:** 🟢 **COMPLETADA** — **12 tests en 5 archivos** (sales-flow: 5, returns-flow: 2, inventory-flow: 1, offline-flow: 2, admin-flow: 2).

**Herramientas:** Playwright (`@playwright/test`).

**Infraestructura creada:**
- `@playwright/test` instalado como devDependency
- `playwright.config.ts` con `webServer` apuntando a `vite dev` (puerto 5173)
- Tests en `apps/pos-desktop/e2e/`
- Scripts npm: `test:e2e`, `test:e2e:headed`, `test:e2e:ui`

**Mock de Tauri IPC:** Las pruebas inyectan un shim de `window.__TAURI_INTERNALS__` vía `page.addInitScript()` para que los imports dinámicos en `service-context.tsx` no fallen en el navegador. Las llamadas a comandos nativos (`print_file`, `discover_printers`) devuelven respuestas no-op.

**Limitación conocida:** El modo dev (navegador) de `local-database.ts` usa un proxy PrismaClient que retorna `undefined` para todos los accesos a modelos, causando que `contingencyService.hydrateStore()` falle. Hasta que ese path se endurezca, los tests E2E requieren que las rutas de API estén mockeadas a nivel de Playwright y no ejercitan los servicios de dominio reales (PGlite). Para pruebas completas contra PGlite real, ejecutar contra un build de Tauri.

### 10.1 Flujo de venta completo (`e2e/sales-flow.spec.ts`) ✅

| ID | Escenario | Pasos | Resultado |
|----|-----------|-------|-----------|
| E2E-S01 | Login → buscar producto → agregar → cobrar → recibo | 1. Login con credenciales. 2. Buscar "acetaminofén". 3. Click en resultado. 4. Ver producto en carrito. 5. Click "Cobrar". 6. Ingresar efectivo recibido. 7. Click "Confirmar". 8. Ver pantalla de recibo con éxito. 9. Click "Nueva venta" — vuelve a sales. | ✅ |
| E2E-S02 | Venta con múltiples items | Agregar 2 productos diferentes, ver totales actualizados, confirmar | ✅ |
| E2E-S03 | Venta con cambio | Total: $45.000, efectivo: $50.000 → cambio: $5.000 visible | ✅ |
| E2E-S04 | Venta con pago electrónico | Agregar tarjeta débito, ver autorización, confirmar | ✅ |
| E2E-S05 | Venta con cliente | Buscar cliente por cédula, asignar a venta, ver snapshot | ✅ |

### 10.2 Flujo de devolución (`e2e/returns-flow.spec.ts`) ✅

| ID | Escenario | Pasos | Resultado |
|----|-----------|-------|-----------|
| E2E-R01 | Devolución verificada | 1. Ir a Devoluciones. 2. Buscar venta por número. 3. Ver items. 4. Ingresar cantidad a devolver. 5. Confirmar devolución. 6. Ver confirmación. | ✅ |
| E2E-R02 | Devolución no verificada | 1. Tab "No verificada". 2. Ingresar datos manualmente. 3. Ingresar PIN de manager. 4. Confirmar. | ✅ |

### 10.3 Flujo de ajuste de inventario (`e2e/inventory-flow.spec.ts`) ✅

| ID | Escenario | Pasos | Resultado |
|----|-----------|-------|-----------|
| E2E-I01 | Ajuste positivo | 1. Ir a Inventario. 2. Buscar lote. 3. Seleccionar. 4. Tipo "Aumentar", cantidad 10. 5. Aplicar. 6. Ver stock actualizado. | ✅ |

### 10.4 Flujo offline → online (`e2e/offline-flow.spec.ts`) ✅

| ID | Escenario | Pasos | Resultado |
|----|-----------|-------|-----------|
| E2E-O01 | Venta offline → sync al reconectar | 1. Simular offline (Playwright route interception). 2. Crear venta. 3. Ver toast "En cola". 4. Restaurar online. 5. Esperar sync. 6. Ver toast "Sincronizado". | ✅ |
| E2E-O02 | Múltiples operaciones offline | 3 ventas + 1 devolución offline. Reconectar. Ver todas sincronizadas. | ✅ |

### 10.5 Flujo de sync health (`e2e/admin-flow.spec.ts`) ✅

| ID | Escenario | Pasos | Resultado |
|----|-----------|-------|-----------|
| E2E-A01 | Admin ve sync health | 1. Login como ADMIN. 2. Navegar a Sync Health. 3. Ver KPIs. 4. Ver timeline. 5. Click "Run Sync Now". | ✅ |
| E2E-A02 | Retry entrada fallida | 1. Ver entrada PERMANENT_FAILURE. 2. Click Retry. 3. Ver estado cambiar a PENDING. | ✅ |

---

## 11. Resumen de Estimaciones

| Fase | Descripción | Archivos de test | Tests | Esfuerzo (días) |
|------|-------------|-----------------|-------|-----------------|
| ~~**F0**~~ | ~~Infraestructura (user-event, coverage-v8, config)~~ | ~~—~~ | ~~—~~ | ~~0.5~~ | ✅ |
| ~~**F1**~~ | ~~Utilidades, hooks, common~~ | ~~8 archivos~~ | ~~44 tests~~ | ~~0.5~~ | ✅ |
| ~~**F2**~~ | ~~Servicios de dominio (17 servicios)~~ | ~~17 archivos~~ | ~~~146 tests~~ | ~~5-7~~ | ✅ |
| ~~**F3**~~ | ~~Redux slices faltantes (sales, ui)~~ | ~~2 archivos~~ | ~~~49 tests~~ | ~~1~~ | ✅ |
| ~~**F4**~~ | ~~Componentes — flujo de venta~~ | ~~7 archivos~~ | ~~~56 tests~~ | ~~2~~ | ✅ |
| ~~**F5**~~ | ~~Componentes — páginas y navegación~~ | ~~8 archivos~~ | ~~~99 tests~~ | ~~3~~ | ✅ |
| ~~**F6**~~ | ~~E2E con Playwright~~ | ~~5 archivos~~ | ~~~12 tests~~ | ~~1~~ | ✅ |
| **TOTAL** | | **~57 archivos** | **~567 tests** | **~15 días** | ✅ |

### Distribución por tipo de test

```
Utilidades/hooks/common:     44 tests   (8%)  ✅ COMPLETADO
Servicios de dominio:       245 tests  (43%)  ✅ COMPLETADO
Redux slices:                59 tests  (10%)  ✅ COMPLETADO
Componentes React:          207 tests  (37%)  ✅ COMPLETADO
E2E Playwright:              12 tests   (2%)  ✅ COMPLETADO
                               ─────────
TOTAL:                      ~567 tests
COMPLETADO:                 ~567 tests (100%)
```

### Orden cronológico recomendado

```
✅ F0 — Instalar dependencias, configurar coverage
✅ F1 — Utilidades, hooks, common (44 tests)
✅ F2 — Servicios de dominio completos (245 tests)
✅ F3 — Redux slices (sales, ui) (59 tests)
✅ F4 — Componentes de flujo de venta (56 tests)
✅ F5 — Páginas y navegación (99 tests)
✅ F6 — E2E con Playwright (~12 tests)
```

---

## 12. Riesgos Identificados

### Riesgo 1: PGlite en tests

**Problema:** Los servicios de dominio dependen de PGlite (`@electric-sql/pglite`) que corre WASM en el navegador. Los tests de Vitest con `jsdom` pueden no tener soporte para WASM.

**Impacto:** No se podrá instanciar `PrismaClient` real en tests unitarios. Habrá que mockear todas las queries de Prisma.

**Mitigación:**
- Para tests de servicios de dominio: mockear `PrismaClient` completo. Los servicios reciben `prisma` como dependencia — se puede inyectar un mock tipado (`vi.fn()` para cada método).
- Para tests de componentes: no usan PGlite directamente; usan Redux y context providers que se pueden mockear.
- Para E2E con Playwright: se corre en navegador real con WASM — PGlite funciona.

### Riesgo 2: Transacciones en servicios de dominio

**Problema:** Varios servicios usan `prisma.$transaction(async (tx) => { ... })`. El mock debe ejecutar el callback pasándole el mismo mock.

**Mitigación:**
```typescript
prisma.$transaction.mockImplementation(async (cb: any) => {
  if (typeof cb === 'function') return cb(prisma);
  return cb;
});
```

### Riesgo 3: Zustand stores con persistencia

**Problema:** `local-config.store.ts` usa Zustand con `persist`. `local-session.store.ts` es solo en memoria.

**Impacto:** Los tests de stores deben limpiar el estado entre tests.

**Mitigación:** `beforeEach(() => store.setState(initialState))` para cada test.

### Riesgo 4: i18next en tests de componentes

**Problema:** Los componentes usan `useTranslation()`. Sin inicialización, crashean.

**Mitigación:** `vitest.setup.ts` ya importa `@/i18n` que inicializa i18next. Pero los textos aparecerán en español (default) — usar `getByText()` con strings en español.

### Riesgo 5: `@testing-library/user-event` no instalado

**Problema:** Sin `user-event`, solo se pueden disparar eventos DOM crudos (`fireEvent.click`, `fireEvent.change`), que no simulan interacciones reales (focus, blur, teclado).

**Mitigación:** Instalar antes de empezar Fase 4 (componentes). Es un `pnpm add -D` de 30 segundos.

### Riesgo 6: Coverage sin provider instalado

**Problema:** El script `test:cov` referencia `--coverage` pero `@vitest/coverage-v8` no está instalado. Vitest 4 requiere un provider explícito.

**Mitigación:** Instalar `@vitest/coverage-v8` en Fase 0. Sin esto, `pnpm test:cov` fallará.

### Riesgo 7: Playwright requiere binarios de navegador

**Problema:** `@playwright/test` necesita `npx playwright install` para descargar Chromium/Firefox/WebKit.

**Mitigación:** Documentar en el README que `pnpm exec playwright install` es un paso de setup. En CI/CD, usar la acción `playwright` de GitHub Actions.

---

## Apéndice A: Comandos útiles

```bash
# Instalar dependencias faltantes
pnpm --filter @pharmacy/pos-desktop add -D @testing-library/user-event @vitest/coverage-v8
pnpm --filter @pharmacy/pos-desktop add -D @playwright/test
npx playwright install

# Ejecutar todos los tests
pnpm --filter @pharmacy/pos-desktop test

# Ejecutar tests con coverage
pnpm --filter @pharmacy/pos-desktop test:cov

# Ejecutar tests en watch mode
pnpm --filter @pharmacy/pos-desktop test:watch

# Ejecutar un archivo específico
pnpm --filter @pharmacy/pos-desktop test -- sales-pos.service.test.ts

# Ejecutar tests E2E
pnpm --filter @pharmacy/pos-desktop exec playwright test

# Ver coverage report
pnpm --filter @pharmacy/pos-desktop exec vite preview --outDir coverage
```
