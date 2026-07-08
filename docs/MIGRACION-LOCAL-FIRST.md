# Plan de Migración: Server → POS Desktop (Local-First)

**Versión:** 1.2  
**Fecha:** 8 de julio de 2026  
**Contexto:** Migración de funcionalidades del servidor NestJS (`apps/server`) al POS desktop Tauri/React (`apps/pos-desktop`) para lograr una arquitectura **local-first**, donde el servidor es fuente de verdad pero no indispensable para la operación diaria.

---

## Índice

1. [Estado actual](#1-estado-actual)
2. [Fase 1 — Push Sync (CRÍTICO)](#2-fase-1--push-sync-crítico)
3. [Fase 2 — Módulo de Clientes (ALTO)](#3-fase-2--módulo-de-clientes-alto)
4. [Fase 3 — Sincronización de Configuración (MEDIO)](#4-fase-3--sincronización-de-configuración-medio)
5. [Fase 4 — Server Cleanup (MEDIO)](#5-fase-4--server-cleanup-medio)
6. [Fase 5 — Funcionalidades Avanzadas (BAJO)](#6-fase-5--funcionalidades-avanzadas-bajo)
7. [Cronograma sugerido](#7-cronograma-sugerido)
8. [Arquitectura final deseada](#8-arquitectura-final-deseada)

---

## 1. Estado actual

### 1.1 Arquitectura general del proyecto

```
drugstore-project/
├── apps/
│   ├── server/                  ← NestJS API (PostgreSQL, fuente de verdad)
│   │   └── src/modules/         ← 11 módulos, ~229 archivos TypeScript
│   ├── pos-desktop/             ← Tauri 2 + React (local-first)
│   │   └── src/modules/         ← 6 módulos locales, ~18 archivos TS
│   └── fiscal-engine/           ← BullMQ worker (DIAN XML)
├── packages/
│   ├── database/                ← Prisma schemas (shared + server-only)
│   ├── shared-types/            ← Enums e interfaces compartidas
│   └── shared-validation/       ← Zod schemas compartidos
└── main.md                      ← Documento técnico (741 RFs)
```

### 1.2 Mapa de funcionalidades: Server vs POS Desktop

| Funcionalidad | Server | POS Desktop | Estado |
|---|---|---|---|
| **Auth** — login, sesión, roles, JWT | NestJS controller + service | ✅ Auth service (HTTP login a server) + Zustand store | Completado |
| **Cash Shift** — abrir/cerrar/arqueo | controller + service | ✅ CashShiftService (local PGlite) + SyncQueue | Completado |
| **Catalog** — productos, precios, impuestos | controller + service | ✅ CatalogSyncService (pull + upsert local) | Completado |
| **Lots** — lotes, vencimientos, stock | controller + service | ✅ LotSyncService (pull + upsert local) | Completado |
| **Inventory Movement** — consumo FEFO | service (vía sync replay) | ✅ InventoryLotsService (consumo local con lock optimista) | Completado |
| **Sales POS** — crear/confirmar ventas | controller + service + sync replay | ✅ SalesPosService (create + confirm local) + SyncQueue | Completado |
| **Sync Scheduler** — pull periódico | — | ✅ SyncScheduler (catalog + lots cada 5 min) | Completado |
| --- | --- | --- | --- |
| **Push Sync** — enviar SyncQueue al server | POST /sync/batch | ❌ No implementado | **CRÍTICO** |
| **Clientes** — CRUD, búsqueda, descuentos | controller + service | ❌ No implementado | **ALTO** |
| **Client sync** — pull/push de clientes | — | ❌ No implementado | **ALTO** |
| **Payment methods sync** | endpoint GET | ❌ No implementado (hardcodeados) | **MEDIO** |
| **Config sync** — parámetros operativos | configuration module | ❌ No implementado | **MEDIO** |
| **Client returns** | controller + service | ❌ No implementado | Bajo |
| **Inventory adjustments** | controller + service | ❌ No implementado (solo server) | Bajo |
| **Prescriptions** | controller + service | ❌ No implementado | Bajo |
| **Purchases** (órdenes, recepción) | controller + service | N/A — backoffice exclusivo | N/A |
| **Reports** | controller + service | N/A — backoffice exclusivo | N/A |
| **Fiscal/DIAN** | NestJS + fiscal-engine | N/A — motor fiscal desacoplado | N/A |
| **Configuration management** | controller + service | N/A — backoffice exclusivo | N/A |

### 1.3 Problemas identificados

1. **No hay push sync**: El `SyncScheduler` solo hace pull (bajar catálogo y lotes). Las ventas confirmadas y turnos cerrados generan entradas en `SyncQueue` local, pero nunca se envían al servidor. El sistema opera en vacío: el POS escribe en su base PGlite local, pero el servidor nunca se entera.

2. **No hay gestión de clientes offline**: El POS no puede crear ni buscar clientes localmente. Si una venta necesita asociar un cliente, depende de que el cajero tenga conexión al servidor en ese momento.

3. **No hay parámetros de operación locales**: Medios de pago, umbrales de descuento, configuración de alertas — todo vive en el servidor. El POS usa valores hardcodeados o por defecto.

4. **Server aún expone endpoints de thin-client**: Controladores como `POST /sales-pos/sales` y `POST /cash-shift/open` fueron diseñados para un POS que llamaba al servidor directamente. Hoy el POS opera local-first y debería usar solo `POST /sync/batch` para escritura.

---

## 2. Fase 1 — Push Sync (CRÍTICO)

### 2.1 Objetivo

Cerrar el ciclo local-first: las operaciones creadas offline deben llegar al servidor para ser re-ejecutadas (replay) por el `SyncOperationDispatcherService`.

### 2.2 Arquitectura del push

```
POS Local DB (PGlite)
    │
    │ tabla: sync_queue
    │   status = PENDING
    │   operationType = SALE_CONFIRMATION | SHIFT_CLOSURE | CLIENT_CREATION | ...
    │
    ▼
SyncPushService
    │
    ├── 1. Leer entries PENDING ordenadas por sourceCreatedAt ASC
    ├── 2. Construir batch (hasta N operaciones, default 10)
    ├── 3. Enviar POST /sync/batch al server
    ├── 4. Procesar respuesta por operación:
    │       • ACCEPTED → marcar COMPLETED
    │       • ALREADY_ACCEPTED → marcar COMPLETED (idempotencia)
    │       • REJECTED → marcar FAILED + registrar error
    │       • Error de red → mantener PENDING + programar reintento
    └── 5. Si todas OK, proceder a pull sync
```

### 2.3 Archivos a crear/modificar

```
apps/pos-desktop/src/
├── modules/
│   └── sync/
│       ├── sync-push.service.ts       ← NUEVO (lectura + envío de SyncQueue)
│       ├── sync-scheduler.service.ts   ← MODIFICAR (agregar push al ciclo)
│       ├── sync-types.ts              ← NUEVO (tipos para el push)
│       └── index.ts                   ← MODIFICAR (exportar nuevos servicios)
│
├── infrastructure/
│   └── sync-batch.http-client.ts      ← NUEVO (wrapper para POST /sync/batch)
│
└── common/
    └── is-online.ts                   ← ya existe (usar como gate)
```

### 2.4 `sync-push.service.ts` — Especificación

```typescript
// apps/pos-desktop/src/modules/sync/sync-push.service.ts

interface SyncPushConfig {
  prisma: PrismaClient;
  httpClient: SyncBatchHttpClient;
  batchSize?: number;
  maxRetryAttempts?: number;
  baseRetryDelayMs?: number;
  onProgress?: (report: PushProgress) => void;
}

interface PushProgress {
  total: number;
  completed: number;
  failed: number;
  remaining: number;
}

class SyncPushService {
  async pushNextBatch(config: SyncPushConfig): Promise<PushProgress>;
  async pushAllPending(config: SyncPushConfig): Promise<PushProgress>;
  async getPendingCount(prisma: PrismaClient): Promise<number>;
  async retryFailedEntries(prisma: PrismaClient, maxEntries?: number): Promise<number>;
}
```

### 2.5 Integración en el scheduler

El ciclo del `SyncScheduler` cambia de:

```
[ pull catalog ] → [ pull lots ] → [ esperar 5 min ]
```

a:

```
[ push pending ] → [ pull catalog ] → [ pull lots ] → [ esperar 5 min ]
```

Y `syncNow()` ejecuta push + pull.

### 2.6 Mecanismo de reintentos

| Intento | Espera |
|---|---|
| 1 | 30 segundos |
| 2 | 2 minutos |
| 3 | 5 minutos |
| 4 | 10 minutos |
| 5+ | 30 minutos (máximo) |
| Límite total | 10 intentos → estado `FAILED` definitivo (no reintentar más) |

> **Nota sobre `PERMANENT_FAILURE`:** El enum `SyncStatus` actual solo tiene `PENDING | PROCESSING | COMPLETED | FAILED`. No existe `PERMANENT_FAILURE`. Para distinguir entre "falló y va a reintentar" vs "falló y ya no se reintenta más" se puede usar una combinación de `status = FAILED` + `retryCount >= maxRetryAttempts`, sin necesidad de agregar un nuevo valor al enum. Si más adelante se necesita un estado explícito, se agrega como cambio de schema (ver Apéndice C).

### 2.7 Registro en tabla SyncQueue local

La tabla `SyncQueue` ya existe en el schema compartido (modelo Prisma en `packages/database/prisma/schema-source/shared/sync-queue.prisma`) y por lo tanto está disponible tanto en el servidor (PostgreSQL) como en el POS (PGlite). El POS no necesita definir un modelo separado.

Los campos relevantes para el push sync son:

| Campo | Tipo | Uso |
|---|---|---|
| `id` | `String @id` | UUID del registro |
| `operationUuid` | `String @unique` | ID de operación generado por el POS (idempotencia) |
| `operationType` | `SyncOperationType` | `SALE_CONFIRMATION`, `SHIFT_CLOSURE`, etc. |
| `payload` | `String @db.Text` | JSON con todos los datos de la operación |
| `payloadHash` | `String` | SHA-256 del payload (integridad) |
| `status` | `SyncStatus @default(PENDING)` | `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED` |
| `retryCount` | `Int @default(0)` | Número de intentos fallidos |
| `lastErrorMessage` | `String? @db.Text` | Último error conocido |
| `nextRetryAt` | `DateTime?` | Cuándo reintentar (para backoff) |
| `sourceWorkstationId` | `String` | Estación que originó la operación |
| `sourceCreatedAt` | `DateTime` | Marca de tiempo del POS |
| `versionSchema` | `Int @default(1)` | Versión del schema del payload |

Cuando el `SyncPushService` lea entries PENDING, debe filtrar también aquellas `FAILED` cuyo `retryCount < maxRetryAttempts` y `nextRetryAt <= now`. Las que hayan superado el límite de reintentos se quedan como `FAILED` pero no se vuelven a seleccionar — se convierten efectivamente en errores permanentes sin necesidad de un estado adicional en el enum.

> **Importante:** `versionSchema` **ya existe** en el modelo (línea 11 del schema). No confundir con `PERMANENT_FAILURE` que **no existe** en el enum `SyncStatus` y no se necesita agregar (ver sección 2.6).

### 2.8 Dependencias externas afectadas (server)

#### 2.8.1 Sync endpoint

El servidor ya tiene el endpoint `POST /sync/batch` implementado en:
- `apps/server/src/modules/sync/controllers/sync.controller.ts`
- `apps/server/src/modules/sync/services/sync.service.ts`
- `apps/server/src/modules/sync/sync-operation-dispatcher.service.ts`

No requiere cambios — ya soporta todos los operation types que el POS genera:
- `SALE_CONFIRMATION` ✅
- `SHIFT_CLOSURE` ✅
- `CLIENT_CREATION` ✅ (existente, ver Fase 2 para ajuste de tipado)
- `INVENTORY_ADJUSTMENT` ✅

#### 2.8.2 Schema compartido: SyncQueue y relaciones a Workstation (no es un problema)

`SyncQueue` está en el grupo compartido del schema (`schema-source/shared/sync-queue.prisma`). El modelo `Workstation` está en el grupo server-only (`schema-source/server-only/auth.prisma`). En el schema maestro (`schema.prisma`), SyncQueue tiene dos relaciones completas a Workstation:

```prisma
// schema.prisma (maestro canónico — contiene todos los modelos)
model SyncQueue {
  ...
  sourceWorkstationId   String
  sourceWorkstation     Workstation   @relation(fields: [sourceWorkstationId], references: [id])
  ...
  workstationId         String?
  workstation           Workstation?  @relation("SyncQueueWorkstation", fields: [workstationId], references: [id])
}
```

Sin embargo, **esto no causa error de generación** en el cliente local. El script `split-schema.mjs` (específicamente la función `flattenModel`, líneas 153-197) **remueve automáticamente** cualquier campo que sea `@relation` o array que apunte a un modelo de la otra categoría. Los campos escalares (`sourceWorkstationId`, `workstationId`) se conservan intactos.

El archivo compartido ya refleja esto correctamente:

```prisma
// schema-source/shared/sync-queue.prisma (generado por split-schema.mjs)
model SyncQueue {
  ...
  sourceWorkstationId   String            // ← escalar, sin @relation
  ...
  workstationId         String?           // ← escalar, sin @relation
}
```

Este es el mismo mecanismo que ya maneja las relaciones `SaleItem ↔ Prescription` y `Lot ↔ PurchaseReceptionItem`. **No requiere ninguna corrección adicional** antes de comenzar la Fase 1 — el `prisma generate --config prisma.local.config.ts` compila sin error porque el fragmento compartido no contiene relaciones a modelos server-only.

> **Para referencia**: la cadena de generación completa es:
> ```
> schema.prisma (1 archivo maestro con todos los modelos y relaciones)
>     │
>     ▼  split-schema.mjs
> schema-source/shared/        ← fragmentos compartidos (relaciones a server-only eliminadas)
> schema-source/server-only/   ← fragmentos servidor (relaciones a shared eliminadas)
>     │
>     ▼  assemble-schema.mjs
> schema/             ← build completo (shared + server-only, para apps/server)
> schema-local/       ← build local (shared solo, para apps/pos-desktop)
>     │
>     ▼  prisma generate --config prisma.{full,local}.config.ts
> generated/full-client/        ← cliente PostgreSQL
> generated/local-client/       ← cliente PGlite
> ```

### 2.9 Criterios de aceptación

- [ ] Una venta confirmada offline aparece como COMPLETED en la SyncQueue local tras el push
- [ ] El servidor muestra la venta en su base de datos PostgreSQL
- [ ] Una operación duplicada (mismo `operationUuid`) devuelve `ALREADY_ACCEPTED` sin duplicar datos
- [ ] Una operación con payload corrupto (hash mismatch) se marca como `FAILED`
- [ ] El reintento automático funciona con backoff exponencial
- [ ] Al llegar a 10 intentos fallidos, la operación queda como `FAILED` con `retryCount >= maxRetryAttempts` y el scheduler deja de seleccionarla
- [ ] El indicador de sync en la UI muestra correctamente pendientes vs completados

---

## 3. Fase 2 — Módulo de Clientes (ALTO)

### 3.1 Objetivo

Permitir al POS desktop crear, buscar y asociar clientes a ventas sin dependencia del servidor. Sincronizar los clientes creados offline cuando se restablezca la conexión.

### 3.2 RFs cubiertos (de main.md)

| RF | Descripción |
|---|---|
| RF-CLI-01 a RF-CLI-05 | Creación de cliente con validación de identificación colombiana |
| RF-CLI-06 | Creación rápida desde POS con datos mínimos |
| RF-CLI-09 a RF-CLI-18 | Búsqueda por identificación, nombre, datos de contacto |
| RF-CLI-37 a RF-CLI-44 | Clasificación y descuentos automáticos por clasificación |
| RF-CLI-45 a RF-CLI-48 | Datos fiscales para facturación DIAN (snapshot en venta) |
| RF-SINC-01 | Réplica local de clientes frecuentes e institucionales |

### 3.3 Archivos a crear/modificar

```
apps/pos-desktop/src/
├── modules/
│   └── clients/
│       ├── clients.service.ts            ← NUEVO (CRUD local de clientes)
│       ├── clients.sync.service.ts       ← NUEVO (pull desde server)
│       ├── classification-discount.service.ts ← NUEVO (descuento automático por clasificación)
│       ├── identification-validator.ts   ← NUEVO (validación CC/NIT)
│       ├── exceptions.ts                 ← NUEVO
│       └── index.ts                      ← NUEVO
│
├── common/
│   └── identification-validator.ts       ← NUEVO (algoritmo dígito verificación Colombia)
│
├── renderer/
│   ├── components/
│   │   └── SalesTransaction/
│   │       └── client-selector.tsx       ← NUEVO (selector/buscador de cliente en POS)
│   │       └── quick-client-create.tsx   ← NUEVO (formulario rápido)
│   └── store/
│       └── slices/
│           └── client-slice.ts           ← NUEVO (estado de cliente en venta activa)
```

### 3.4 `clients.service.ts` — Especificación

```typescript
// apps/pos-desktop/src/modules/clients/clients.service.ts

interface CreateClientInput {
  identificationType: IdentificationType;
  identificationNumber: string;
  fullName: string;
  email?: string;
  phone?: string;
  address?: string;
  municipality?: string;
  department?: string;
}

interface ClientRecord {
  id: string;
  identificationType: string;
  identificationNumber: string;
  fullName: string;
  classificationId: string;
  classification: { type: string; discountPercentage: number };
  // ...otros campos del modelo local Client
}

class ClientsService {
  async findByIdentification(
    type: IdentificationType,
    number: string,
  ): Promise<ClientRecord | null>;

  async search(query: string, limit?: number): Promise<ClientRecord[]>;

  async getById(id: string): Promise<ClientRecord | null>;

  /**
   * Crea un cliente localmente y encola CLIENT_CREATION en SyncQueue.
   * Si hay conexión, puede enviarlo directamente (opcional).
   */
  async createQuick(
    input: CreateClientInput,
    workstationId: string,
    userId: string,
  ): Promise<ClientRecord>;

  /**
   * Aplica el descuento automático de la clasificación del cliente.
   * Retorna el porcentaje a descontar (0 si no aplica).
   */
  async getClassificationDiscount(clientId: string): Promise<number>;
}
```

### 3.5 `clients.sync.service.ts` — Especificación

Sigue el mismo patrón que `CatalogSyncService` y `LotSyncService`:

```typescript
// apps/pos-desktop/src/modules/clients/clients.sync.service.ts

interface ClientSyncConfig {
  baseUrl: string;
  httpClient?: SyncHttpClient;
  accessToken?: string;
  prisma: PrismaClient;
}

class ClientSyncService {
  async pullClients(config: ClientSyncConfig): Promise<void>;
  // GET /clients?lastSyncedAt=<timestamp>&page=N&pageSize=200
  // Upsert transaccional en tabla Client local
  // Actualiza classificationId según el mapa de clasificaciones
}
```

### 3.6 Handler existente: corregir tipado inseguro

El `SyncOperationDispatcherService` **ya tiene** el handler `handleClientCreation` implementado (líneas 82-90). Llama a `clientsService.create()` pasando 3 argumentos:

```typescript
// apps/server/src/modules/sync/sync-operation-dispatcher.service.ts (real)

private async handleClientCreation(entry: any): Promise<void> {
  const payload = JSON.parse(entry.payload);
  const clientId: string | undefined = payload.metadata?.localClientId;
  await this.clientsService.create(
    payload.createClientDto,
    payload.userId,
    clientId,
  );
}
```

**Problema detectado:** el parámetro `entry` está tipado como `any`, igual que los otros tres handlers del mismo archivo. Esto contradice el estándar que se aplicó al limpiar `PrismaService`. La corrección es:

```typescript
// apps/server/src/modules/sync/sync-operation-dispatcher.service.ts
// Cambiar la firma de dispatch y todos los handlers privados:

interface SyncQueueEntry {
  id: string;
  operationType: SyncOperationType;
  payload: string;
  sourceWorkstationId: string;
  retryCount: number;
  // ... otros campos que el handler necesite
}

async dispatch(entry: SyncQueueEntry): Promise<void> { ... }
private async handleClientCreation(entry: SyncQueueEntry): Promise<void> { ... }
```

Esta corrección aplica a los 4 handlers (`handleSaleConfirmation`, `handleShiftClosure`, `handleClientCreation`, `handleInventoryAdjustment`), no solo al de clientes.

**El `clientsService.create`** admite un `clientId` opcional como tercer argumento. Cuando el POS provee `payload.metadata.localClientId` (el UUID que el POS asignó localmente al cliente), el server preserva ese UUID. Si hay conflicto por el unique constraint de identificación (mismo cliente creado desde dos POS distintos), el server hace un **upsert**: la versión más reciente (la del POS que está sincronizando) reemplaza a la anterior. Esta es la estrategia de conflictos documentada en `clients.service.ts` (líneas 48-66).

### 3.7 Integración en ventas

El flujo cambia de:

```
[ cajero inicia venta ]
    → [ agrega productos ]
    → [ cobra ]
    → [ confirma ]
```

a:

```
[ cajero inicia venta ]
    → [ opcional: busca/asocia cliente ]
    →   • Si el cliente existe localmente → lo asocia (con descuento automático)
    →   • Si no existe → crea rápido (nombre + identificación)
    → [ agrega productos ]
    → [ cobra ]
    → [ confirma ]
```

En `SalesPosService.confirm()`:
- Si `clientId` está presente, cargar snapshot del cliente (nombre, identificación, clasificación)
- Aplicar descuento automático por clasificación antes de calcular totales
- Incluir `clientId` en el payload de `SALE_CONFIRMATION` del SyncQueue

### 3.8 Validación de identificaciones colombianas

```typescript
// apps/pos-desktop/src/common/identification-validator.ts

interface ValidationResult {
  valid: boolean;
  formatted?: string;
  error?: string;
}

function validateColombianId(
  type: IdentificationType,
  number: string,
): ValidationResult;
// CC: 8-10 dígitos, dígito de verificación (opcional)
// NIT: formato NNN.NNN.NNN-N, cálculo dígito verificación DIAN
// CE: hasta 15 caracteres alfanuméricos
// PASSPORT: alfanumérico, sin formato fijo
// TI: 8-10 dígitos
```

### 3.9 Criterios de aceptación

- [ ] Cliente creado offline aparece en la base PGlite local inmediatamente
- [ ] Cliente creado offline llega al servidor tras el push sync
- [ ] Búsqueda de cliente por identificación funciona sin conexión
- [ ] Búsqueda de cliente por nombre funciona sin conexión
- [ ] Clasificación del cliente se replica localmente
- [ ] Descuento automático por clasificación se aplica al asociar cliente a venta
- [ ] Snapshot del cliente queda grabado en la venta (no cambia si el cliente se modifica después)
- [ ] Validación de CC rechaza números inválidos
- [ ] Validación de NIT calcula dígito de verificación correctamente

---

## 4. Fase 3 — Sincronización de Configuración (MEDIO)

### 4.1 Objetivo

Replicar localmente los parámetros de operación que el POS necesita para funcionar offline: medios de pago, umbrales de descuento por rol, configuración de alertas de vencimiento.

### 4.2 Payment methods sync

#### 4.2.1 Situación actual

El modelo `PaymentMethod` existe en el schema compartido (local). La tabla existe en PGlite. Pero el POS no la poblada desde el server — posiblemente hay valores hardcodeados o un seed inicial.

#### 4.2.2 Implementación

```typescript
// apps/pos-desktop/src/modules/catalog/payment-method-sync.service.ts

// Reutiliza el mismo patrón de CatalogSyncService
// GET /catalog/payment-methods
// Upsert en tabla PaymentMethod local
// Se ejecuta como parte del pull sync inicial
```

### 4.3 Umbrales de descuento por rol

#### 4.3.1 Situación actual

Los límites de descuento (RF-POS-31, RF-POS-32) están configurados en el servidor. El POS no los conoce localmente.

#### 4.3.2 Implementación

```typescript
// apps/pos-desktop/src/modules/configuration/discount-limits.sync.service.ts

// GET /configuration?module=SALES_POS&keys=discount.item.max.percentage.cashier,...
// Almacenar en memoria (Zustand) o en tabla local de config
// Valores por defecto si no hay sync:
//   CASHIER:   item.max=10%, global.max=5%
//   INVENTORY_ASSISTANT: item.max=0%, global.max=0%
//   ADMIN:     item.max=100%, global.max=100%
```

### 4.4 Almacenamiento local de configuración

**Decisión:** No se replica el modelo `SystemConfig` del servidor en el schema local. Este modelo quedó deliberadamente del lado servidor al separar los schemas compartido y server-only, para no cargar cada terminal POS con la configuración general del sistema.

En su lugar, se usa un enfoque más acotado:

#### 4.4.1 Endpoint `GET /configuration/pos-settings`

Agregar en el servidor un endpoint público (autenticado con JWT mínimo) que retorna solo los parámetros que el POS necesita para operar:

```typescript
// apps/server/src/modules/configuration/controllers/configuration.controller.ts

@Get('pos-settings')
@UseGuards(JwtAuthGuard)
async getPosSettings(): Promise<PosSettingsResponse> {
  // Retorna exclusivamente:
  return {
    paymentMethods: [],          // activos, ordenados, con categoría
    discountLimits: {
      cashier: { itemMaxPercent: 10, globalMaxPercent: 5 },
      inventoryAssistant: { itemMaxPercent: 0, globalMaxPercent: 0 },
      admin: { itemMaxPercent: 100, globalMaxPercent: 100 },
      accountant: { itemMaxPercent: 0, globalMaxPercent: 0 },
    },
    alertThresholds: {
      expirationWarningDays: 30,
      lowStockAlert: true,
    },
    syncDefaults: {
      batchSize: 10,
      maxRetryAttempts: 10,
      retryDelaysSeconds: [30, 120, 300, 600, 1800],
    },
  };
}
```

#### 4.4.2 Almacenamiento local

Los valores se guardan en una estructura simple en memoria o en una tabla utilitaria local (no un modelo Prisma completo):

```typescript
// apps/pos-desktop/src/modules/configuration/local-config.store.ts

interface LocalConfigStore {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  getAll(): Record<string, unknown>;
  hydrateFromServer(response: PosSettingsResponse): void;
}

// Implementación con Zustand persistido (subscribeWithStorage)
// o tabla local_config con key-value simple.
//
// Valores por defecto seguros si el POS nunca ha sincronizado:
//   discountLimits: { cashier: { itemMax: 10, globalMax: 5 } }
//   syncDefaults: { batchSize: 10, maxRetryAttempts: 10 }
```

### 4.5 Criterios de aceptación

- [ ] Todos los métodos de pago activos del servidor se replican localmente
- [ ] Un método de pago desactivado en el server se refleja localmente tras el sync
- [ ] Los límites de descuento del rol del cajero se aplican localmente
- [ ] Si no hay sync (primera ejecución offline), se usan valores por defecto seguros

---

## 5. Fase 4 — Server Cleanup (MEDIO)

### 5.1 Objetivo

Documentar qué endpoints del server ya no son consumidos directamente por el POS desktop, simplificar validaciones redundantes, y preparar el servidor para ser Backoffice API + Sync Replay Engine.

### 5.2 Diagnóstico de endpoints

#### Endpoints que el POS ya NO consume directamente

El POS desktop opera así para **escritura**:
- Login: `POST /auth/login` (sigue usándolo directamente)
- Operaciones de negocio: todas vía `POST /sync/batch` (NUNCA directo)

Por lo tanto, estos endpoints ya no son llamados por el POS:

| Módulo | Endpoint | ¿Quién lo usa ahora? |
|---|---|---|
| **sales-pos** | `POST /sales-pos/sales` | Backoffice (futuro) |
| | `POST /sales-pos/sales/:id/confirm` | Backoffice (futuro) |
| | `POST /sales-pos/sales/:id/annul` | Backoffice (futuro) |
| **cash-shift** | `POST /cash-shift` | Backoffice (futuro) |
| | `POST /cash-shift/:id/close` | Backoffice (futuro) |
| | `POST /cash-shift/:id/cash-counts` | Backoffice (futuro) |
| | `POST /cash-shift/:id/force-close` | Solo admin — backoffice |
| **clients** | `POST /clients` (desde POS directo) | Backoffice (futuro) |
| | `PATCH /clients/:id` | Backoffice (futuro) |
| **inventory-lots** | `POST /inventory-lots/adjustments` | Backoffice (futuro, o POS en Fase 5) |

#### Endpoints que el POS SÍ consume (PULL)

| Módulo | Endpoint | Uso |
|---|---|---|
| **catalog** | `GET /catalog/products?page=N&pageSize=X` | CatalogSyncService |
| | `GET /catalog/categories` | CatalogSyncService |
| | `GET /catalog/pharmaceutical-forms` | CatalogSyncService |
| **inventory-lots** | `GET /inventory-lots/lots?page=N&pageSize=X` | LotSyncService |
| **clients** | `GET /clients?page=N&pageSize=X` | ClientSyncService (Fase 2) |
| **configuration** | `GET /configuration?module=...&keys=...` | Config Sync (Fase 3) |

#### Endpoints que el POS SÍ consume (PUSH)

| Endpoint | Uso |
|---|---|
| `POST /sync/batch` | SyncPushService (Fase 1) |

### 5.3 Acciones concretas

#### 5.3.1 Agregar comentarios de deprecación

En cada controlador que ya no es consumido por el POS:

```typescript
/**
 * @deprecated POS Desktop
 *
 * Este endpoint ya no es llamado directamente por el POS desktop.
 * El POS opera en modo local-first y envía las operaciones de negocio
 * exclusivamente a través de POST /sync/batch.
 *
 * Este endpoint se mantiene para:
 * 1. El panel administrativo web (backoffice) — futura implementación
 * 2. El SyncOperationDispatcherService, que llama a los servicios
 *    subyacentes (no a este controller) durante el replay.
 *
 * Los servicios (CashShiftService, SalesService, etc.) no deben
 * modificarse — son la implementación autoritativa que el dispatcher
 * utiliza para re-ejecutar operaciones offline.
 */
```

#### 5.3.2 Simplificar validaciones en endpoints deprecados

Algunos DTOs de endpoints directos pueden tener validaciones redundantes ahora que el POS pasa por sync. Por ejemplo:

```typescript
// Antes: validación exhaustiva en el DTO (para thin-client)
// Ahora: validación relajada porque:
//   1. El POS ya validó todo localmente
//   2. El sync replay re-valida en el servicio
//   3. El endpoint solo lo usa backoffice (con supervisión humana)
```

**No eliminar validaciones** — solo moverlas al servicio si no están ya allí.

#### 5.3.3 Verificar que el sync dispatcher tenga todos los handlers

Todos los `operationType` que el POS puede generar deben tener handler en el dispatcher:

| OperationType | Handler | Status |
|---|---|---|
| `SALE_CONFIRMATION` | ✅ `handleSaleConfirmation` | Implementado |
| `SHIFT_CLOSURE` | ✅ `handleShiftClosure` | Implementado |
| `CLIENT_CREATION` | ❌ No implementado | **Agregar en Fase 2** |
| `INVENTORY_ADJUSTMENT` | ✅ `handleInventoryAdjustment` | Implementado |
| `CLIENT_RETURN` | ❌ No implementado | Futuro (Fase 5) |

#### 5.3.4 Agregar endpoint público de configuración para POS

```typescript
// apps/server/src/modules/configuration/controllers/configuration.controller.ts

@Get('pos-settings')
@Public() // o JWT mínimo
async getPosSettings(): Promise<PosSettingsDto> {
  // Retorna solo parámetros no sensibles que el POS necesita:
  // - paymentMethods[] (activos, ordenados)
  // - discountLimits por rol
  // - alertThresholds (expiración, stock mínimo)
  // - syncDefaults (batchSize, retryConfig)
}
```

### 5.4 Criterios de aceptación

- [ ] No se elimina ningún endpoint sin confirmar que backoffice no lo necesita
- [ ] El SyncOperationDispatcherService tiene handler para todos los operation types que el POS genera
- [ ] Se agregó el endpoint `GET /configuration/pos-settings` para consumo del POS
- [ ] Comentarios de deprecación agregados en todos los controllers afectados

---

## 6. Fase 5 — Funcionalidades Avanzadas (BAJO)

### 6.1 Objetivo

Agregar funcionalidades complementarias que el POS necesita pero que no son críticas para el MVP local-first.

### 6.2 Client Returns (RF-POS-56 a RF-POS-74)

#### 6.2.1 Descripción

Devolución de cliente desde el POS: seleccionar venta original, seleccionar ítems a devolver, calcular monto a reembolsar, registrar movimiento de inventario inverso.

#### 6.2.2 Archivos a crear

```
apps/pos-desktop/src/modules/sales-pos/
├── client-returns.service.ts           ← NUEVO
├── client-return-calculator.service.ts ← NUEVO (cálculo de montos)
└── client-returns.types.ts             ← NUEVO

apps/server/src/modules/sales-pos/services/
└── client-return-sync.handler.ts       ← MODIFICAR dispatcher
```

#### 6.2.3 Consideraciones

- La devolución debe referenciar la venta original por ID
- El monto a reembolsar se calcula localmente (precio al momento de la venta)
- Se genera un `InventoryMovement` de tipo `CLIENT_RETURN` (stock reversal)
- SyncQueue entry type: `CLIENT_RETURN` (nuevo, agregar al dispatcher)
- En el server, el handler debe validar que la venta original existe y no está anulada

### 6.3 Inventory Adjustments básicos (RF-INV-41 a RF-INV-47)

#### 6.3.1 Descripción

Ajustes simples de inventario desde el POS: merma por daño, donación, corrección de stock. El server ya soporta `INVENTORY_ADJUSTMENT` en el dispatcher.

#### 6.3.2 Archivos a crear

```
apps/pos-desktop/src/modules/inventory-lots/
└── inventory-adjustments.service.ts   ← NUEVO (ajustes simples)
```

#### 6.3.3 Tipos de ajuste permitidos en POS

| Tipo | Descripción |
|---|---|
| `DAMAGE` | Producto dañado/roto |
| `DONATION` | Donación |
| `CORRECTION` | Corrección de stock (sobrante o faltante documentado) |
| `EXPIRATION` | Vencimiento (automático, no manual) |

El POS **no** debería crear ajustes que requieran aprobación de inventario (RF-INV-43). Esos son backoffice.

### 6.4 Prescriptions management (RF-POS-37 a RF-POS-40)

#### 6.4.1 Descripción

Registro de que una receta médica fue presentada para productos clasificados como `PRESCRIPTION`.

#### 6.4.2 Implementación mínima

- El modelo `SaleItem` ya tiene `requiresPrescription` y `saleItemPrescriptionId`
- En `SalesPosService.confirm()`, si algún ítem requiere receta y la configuración lo exige, validar que el cajero marcó "receta presentada"
- Incluir `prescriptionConfirmed: boolean` en los ítems del payload sync
- No se maneja subida de archivos de receta en esta versión (backoffice)

### 6.5 Criterios de aceptación

- [ ] Devolución de cliente offline registra correctamente stock reversal
- [ ] Devolución se sincroniza al server y es re-ejecutada correctamente
- [ ] Ajuste simple de inventario desde POS funciona offline
- [ ] Flag de receta presentada se guarda en la venta y viaja en el sync payload

---

## 7. Cronograma sugerido

| Sprint | Fase | Duración estimada | Entregables |
|---|---|---|---|
| **1** | Fase 1 — Push Sync | 2 semanas | SyncPushService + integración en scheduler + UI de estado de sync |
| **2** | Fase 2 — Clientes (parte 1) | 2 semanas | ClientsService + ClientsSyncService + integración en ventas |
| **3** | Fase 2 — Clientes (parte 2) | 1 semana | UI de selector/creación de cliente + descuento automático |
| **4** | Fase 3 — Config Sync | 1 semana | Payment methods sync + discount limits sync + endpoint pos-settings |
| **5** | Fase 4 — Server Cleanup | 1 semana | Comentarios de deprecación + handler de CLIENT_CREATION + endpoint pos-settings |
| **6** | Fase 5 — Avanzadas | 2-3 semanas | Client returns + adjustments + prescriptions |

**Total estimado: 10-11 semanas**

---

## 8. Arquitectura final deseada

### 8.1 Diagrama de flujo de datos

```
┌─────────────────────────────────────────────────────────────┐
│                    POS Desktop (Tauri)                       │
│                                                             │
│  ┌──────────┐    ┌────────────┐    ┌──────────────────┐    │
│  │  Sales   │───▶│  Local DB  │◀───│  Sync Scheduler  │    │
│  │  POS     │    │  (PGlite)  │    │                  │    │
│  │  Service │    │            │    │  ┌─────────────┐ │    │
│  ├──────────┤    │ • Product  │    │  │ PushService │ │    │
│  │  Cash    │    │ • Lot      │    │  │ ───▶ POST   │ │    │
│  │  Shift   │    │ • Sale     │    │  │     /sync/  │ │    │
│  │  Service │    │ • SyncQ    │    │  │     batch   │ │    │
│  ├──────────┤    │ • Client   │    │  └──────┬──────┘ │    │
│  │  Clients │    │ • Payment  │    │         │        │    │
│  │  Service │    │   Method   │    │  ┌──────┴──────┐ │    │
│  ├──────────┤    └────────────┘    │  │ PullService │ │    │
│  │ Inventory│                      │  │ ───▶GET    │ │    │
│  │ Service  │                      │  │    /catalog │ │    │
│  └──────────┘                      │  │    /lots    │ │    │
│                                    │  │    /clients │ │    │
│  ┌──────────────────────────┐      │  └─────────────┘ │    │
│  │  Connectivity Manager    │      └──────────────────┘    │
│  │  (is-online.ts)         │                              │
│  └──────────────────────────┘                              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ HTTP (cuando hay conexión)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│               Servidor Central (NestJS)                      │
│                                                             │
│  POST /sync/batch ──▶ SyncService ──▶ Dispatcher            │
│                                        │                    │
│  GET /catalog/*    ──▶ CatalogController                     │
│  GET /lots/*       ──▶ LotsController                        │
│  GET /clients*     ──▶ ClientsController                     │
│  GET /pos-settings ──▶ ConfigController                      │
│                                        │                    │
│  ┌─────────────────────────────────────┴──────────────┐    │
│  │  Business Services (autoritativos)                  │    │
│  │  • SalesService     • CashShiftService              │    │
│  │  • ClientsService   • InventoryService              │    │
│  │  • CatalogService   • LotsService                   │    │
│  └─────────────────────────────────────────────────────┘    │
│                                        │                    │
│                                        ▼                    │
│                              PostgreSQL 16                  │
│                              (fuente de verdad)             │
└─────────────────────────────────────────────────────────────┘
                                        │
                                        │ BullMQ
                                        ▼
┌─────────────────────────────────────────────────────────────┐
│              Fiscal Engine (Worker)                          │
│  • UBL 2.1 XML generation                                    │
│  • XAdES-EPES signing                                        │
│  • DIAN transmission                                         │
│  • Contingency management                                    │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 Principios de la arquitectura final

1. **Local-first**: El POS opera completo contra su base PGlite local. El servidor PUEDE estar caído y el POS sigue funcionando.

2. **Server as source of truth**: El servidor es la versión autoritativa. Los datos locales son una réplica funcional que puede divergir temporalmente.

3. **Sync por batch (push)**: El POS nunca escribe directamente en el servidor para operaciones de negocio. Siempre usa `POST /sync/batch` y el servidor re-ejecuta (replay) la operación validando todas las reglas de negocio.

4. **Sync por pull (read)**: El POS baja datos de referencia (catálogo, lotes, clientes, configuración) periódicamente. La réplica local permite operar sin conexión.

5. **No bifurcación de lógica**: La lógica de negocio principal se implementa una vez en el servidor. El POS tiene una implementación ligera local para operación offline, pero el servidor siempre re-valida durante el replay.

6. **Idempotencia garantizada**: Cada operación tiene un `operationUuid` único global. El servidor rechaza duplicados sin efectos secundarios.

### 8.3 Lo que NO cambia

- **Backoffice web**: Futura aplicación React que llama directamente a los endpoints REST del servidor (no pasa por sync batch). Opera asumiendo conectividad.
- **Fiscal Engine**: BullMQ worker independiente. No se migra al POS. La transmisión DIAN ocurre desde el servidor después del sync replay.
- **Purchases**: Módulo puramente administrativo. No se migra al POS.
- **Reports**: Módulo de backoffice. No se migra al POS.
- **Configuration management**: Configuración general del sistema en backoffice. El POS solo recibe un subconjunto de parámetros de operación.

---

## A. Apéndice: Inventario de archivos del POS Desktop

### A.1 Estado actual

```
apps/pos-desktop/src/
├── common/
│   ├── domain-error.ts          — Base class para errores de dominio
│   ├── is-online.ts             — Detección de conectividad
│   └── sync-metadata.ts         — Timestamps de última sincronización
│
├── infrastructure/
│   └── local-database.ts        — Singleton de conexión a PGlite + Prisma
│
├── modules/
│   ├── auth/                    — 4 archivos (completado)
│   ├── cash-shift/              — 3 archivos (completado)
│   ├── catalog/                 — 2 archivos (completado)
│   ├── inventory-lots/          — 4 archivos (completado)
│   ├── sales-pos/               — 3 archivos (completado)
│   └── sync/                    — 2 archivos (incompleto — falta push)
│
└── renderer/
    ├── components/
    │   ├── common/              — AppShell, CashShiftHeader, SyncPulse
    │   ├── PaymentProcessing/   — PaymentMethodRow, PaymentProcessing
    │   ├── Receipt/             — Receipt component
    │   └── SalesTransaction/    — CartPanel, ProductSearch, etc.
    ├── hooks/                   — useElapsedTime, useOnlineStatus
    ├── services/                — HTTP client, catalog service
    ├── store/                   — Zustand store (payment, sales, ui slices)
    └── utils/                   — formatCurrency, formatDate
```

### A.2 Archivos a crear (por fase)

| Fase | Archivo | Ruta |
|---|---|---|
| 1 | `sync-push.service.ts` | `modules/sync/` |
| 1 | `sync-types.ts` | `modules/sync/` |
| 1 | `sync-batch.http-client.ts` | `infrastructure/` |
| 2 | `clients.service.ts` | `modules/clients/` |
| 2 | `clients.sync.service.ts` | `modules/clients/` |
| 2 | `classification-discount.service.ts` | `modules/clients/` |
| 2 | `identification-validator.ts` | `modules/clients/` |
| 2 | `exceptions.ts` | `modules/clients/` |
| 2 | `index.ts` | `modules/clients/` |
| 2 | `identification-validator.ts` (compartido) | `common/` |
| 2 | `client-selector.tsx` | `renderer/components/SalesTransaction/` |
| 2 | `quick-client-create.tsx` | `renderer/components/SalesTransaction/` |
| 2 | `client-slice.ts` | `renderer/store/slices/` |
| 3 | `payment-method-sync.service.ts` | `modules/catalog/` |
| 3 | `discount-limits.sync.service.ts` | `modules/configuration/` (nuevo módulo) |
| 5 | `client-returns.service.ts` | `modules/sales-pos/` |
| 5 | `client-return-calculator.service.ts` | `modules/sales-pos/` |
| 5 | `client-returns.types.ts` | `modules/sales-pos/` |
| 5 | `inventory-adjustments.service.ts` | `modules/inventory-lots/` |

### A.3 Archivos a modificar (por fase)

| Fase | Archivo | Cambio |
|---|---|---|
| 1 | `modules/sync/sync-scheduler.service.ts` | Agregar push al ciclo + syncNow hace push+pull |
| 1 | `modules/sync/index.ts` | Exportar SyncPushService |
| 2 | `modules/sales-pos/sales-pos.service.ts` | Aceptar clientId, aplicar descuento por clasificación, incluir snapshot en payload sync |
| 2 | `modules/sales-pos/exceptions.ts` | Agregar excepciones de cliente |
| 3 | `modules/catalog/index.ts` | Exportar PaymentMethodSyncService |
| 4 | `apps/server/src/modules/sync/sync-operation-dispatcher.service.ts` | Agregar handler CLIENT_CREATION |

---

## B. Apéndice: Dependencias entre fases

```
Fase 1: Push Sync
  └── No requiere Fase 2, 3, 4 o 5
  └── Es prerequisito de: nada (pero sin esto, las fases 2 y 5 crean
      operaciones en SyncQueue que nunca llegan al server)

Fase 2: Clientes
  └── Requiere Fase 1 (para que CLIENT_CREATION llegue al server)
  └── Es prerequisito de: nada directo, pero integra con sales-pos

Fase 3: Config Sync
  └── No requiere Fase 2
  └── Independiente

Fase 4: Server Cleanup
  └── Requiere Fase 2 (agregar handler CLIENT_CREATION)
  └── Independiente en lo demás

Fase 5: Avanzadas
  └── Requiere Fase 1 (push sync)
  └── Requiere Fase 2 (clientes para devoluciones)
```

Se puede empezar por **Fase 1** inmediatamente — no tiene dependencias bloqueantes y es la que desbloquea el valor real del sistema local-first.

---

## C. Apéndice: Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| **Conflictos de datos** — dos POS venden el mismo lote offline, ambos sincronizan, el stock del server queda negativo | Alto | El sync replay en server valida stock antes de confirmar. La segunda venta en llegar será rechazada (FAILED). El POS debe mostrar alerta y permitir re-procesar. | 
| **Gran volumen de operaciones offline** — varios días sin conexión, miles de ventas acumuladas | Medio | Push por lotes (default 10), backoff exponencial, UI de progreso. El servidor ya está diseñado para esto (paginación, cola FIFO, take 20). |
| **Migración de datos** — datos existentes en server que el POS necesita | Medio | Pull sync inicial (catalog, lots, clients) debe ser completo no incremental la primera vez. Usar paginación (pageSize=200-500). |
| **Versiones de schema divergentes** — POS offline por mucho tiempo, schema cambia en server | Bajo | El campo `versionSchema` en SyncQueue permite al servidor rechazar operaciones con schema desactualizado. El POS debe actualizarse antes de seguir operando. |
| **Colisión de números locales** — dos POS asignan el mismo número de venta local | Bajo | El `localNumber` incluye prefijo de workstation. El `internalNumber` lo asigna el server durante replay (secuencial global). |
