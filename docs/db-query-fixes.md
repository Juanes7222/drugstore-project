# Fixes a aplicar — consultas a BD (apps/server + apps/fiscal-engine)

> **Estado 2026-08-05:** 22/22 resueltos. Migraciones de índice FIX-001 y
> FIX-014 aplicadas (`20260805000003_add_client_pagination_and_product_trgm_indexes`:
> `Client(updatedAt, id)` btree + GIN `gin_trgm_ops` sobre
> `Product.commercialName` + `CREATE EXTENSION pg_trgm`). Además se sanó la
> cadena de migraciones (baseline `20260701000000_init` +
> `20260805000002_sync_schema_state` — ver nota al final del doc) y se
> registró `AuditLogInterceptor` como `APP_INTERCEPTOR` (no estaba
> registrado; las mutaciones `@Auditable` no se auditaban).

Auditoría de rendimiento, concurrencia y seguridad sobre todas las consultas a
base de datos. Cada fix incluye ubicación exacta, problema, y solución
propuesta. Prioridad: `P0` (correctitud/seguridad) → `P1` (rendimiento) → `P2`
(mejoras).

---

## Cadena de migraciones — saneada 2026-08-05

La carpeta `prisma/migrations` nació (commit 5348b27) sin baseline: la primera
migración hace `ALTER TABLE "SyncQueue"` pero ninguna migración creaba la
tabla (la base se creaba con `db push`). El shadow replay de `migrate dev`
fallaba siempre (P3006) y cualquier entorno fresco también. Arreglos:

1. **`20260701000000_init`** — baseline = schema histórico al commit de la
   primera migración (reconstruido desde `schema-source` en ese commit,
   menos el delta de la migración 1: `SyncSource`/`operationSource`). En DBs
   existentes se registra como aplicada sin ejecutar (INSERT manual en
   `_prisma_migrations`; `prisma migrate resolve --applied` no sirve porque
   solo acepta migraciones con fila en la tabla).
2. **`20260730000001_seed_generic_client`** (editada) — el INSERT del
   cliente genérico fallaba en DBs frescas (`createdById` NOT NULL, sin
   usuarios). Ahora es condicional (`WHERE EXISTS (SELECT 1 FROM "User")`)
   y `ClientsService.getGenericClient()` crea el registro lazy cuando falta.
   Checksum actualizado en `_prisma_migrations` de la dev DB.
3. **`20260805000002_sync_schema_state`** — captura todo el drift que solo
   existía en `schema-source` (aplicado vía `db push`): enum
   `InvoiceAdjustmentType`, reshape de `InvoiceLocalAdjustment`, 3 valores
   de `SyncOperationType`, tabla `SubscriptionPendingPayment`,
   `Product.sourceOperationUuid`, FKs/columnas eliminadas, JSONB. En la dev
   DB se registró como aplicada sin ejecutar.
4. **`20260805000001_add_sale_ws_localnumber_index`** — índice
   `Sale(workstationId, localNumber DESC)` (FIX-015); el `@@index` vive en
   `schema-source/{shared,server-only}/sale.prisma` (¡no en
   `prisma/schema/`, que es ensamblado y se regenera!).

Verificación: `migrate deploy` sobre una DB fresca aplica las 20 migraciones
y `migrate diff --from-config-datasource --to-schema prisma/schema` da
**migración vacía** (replay = schema exacto). Dev DB: 20/20, sin drift.

Nota: `prisma migrate diff --from-migrations` y `shadowDatabaseUrl` en el
config rompen otros comandos con P1010 en Prisma 7.8 — no configurar.

---

## P0 — Seguridad y correctitud

### FIX-001: `clients.service.ts:241` — `findAll` sin paginación

**Problema:** `this.prisma.client.findMany()` devuelve TODOS los clientes (PII
completa: datos de contacto, Habeas Data, taxId) en una sola respuesta. Con
volumen alto = cientos de miles de filas por request.

**Solución:** Reusar el utilitario `common/utils/cursor-pagination.ts` (keyset
por `(updatedAt, id)`, límite default 200) o paginación por búsqueda
(nombre/documento) + `take`. Añadir índice compuesto `@@index([updatedAt, id])`
en el modelo `Client` (migración).

**Archivos:** `apps/server/src/modules/clients/clients.service.ts`,
`packages/database/prisma/schema/models/clients.prisma` (o nombre real).

---

### FIX-002: `dev.controller.ts:81` — `$queryRawUnsafe` con interpolación de tabla

**Problema:**

```ts
await this.prisma.$queryRawUnsafe<unknown[]>(
  `SELECT * FROM "${table}" ORDER BY (SELECT NULL)`,
);
```

`table` se interpola directamente en el SQL (los identificadores no se pueden
parametrizar). Si el valor es controlable por el cliente → SQL injection.

**Solución:** Whitelist estricta de nombres de tabla (validar contra lista
constante antes de interpolar), y bloquear el módulo dev fuera de
`NODE_ENV !== 'production'`. Alternativa preferida: excluir el módulo del
bundle de producción por completo.

**Archivos:** `apps/server/src/modules/dev/dev.controller.ts`,
`apps/server/src/app.module.ts`.

---

### FIX-003: `subscriptions.service.ts:268` — UPDATE raw y contexto RLS

**Problema:** `$queryRaw` rutea por el proxy tenant-aware → cae al root client
**sin `app.current_tenant()`** si se ejecuta desde un job cron. Con RLS +
FORCE, `app.current_tenant()` NULL → **0 filas afectadas, subscripciones
vencidas nunca se marcan EXPIRED** (fail silencioso).

**RESUELTO 2026-08-05 — no aplica:** `Subscription` es la tabla padre
(plataforma), **intencionalmente SIN RLS** — verificado contra la migración
`20260804000002_enable_row_level_security` (no hay `ALTER TABLE
"Subscription" ENABLE ROW LEVEL SECURITY`). El UPDATE global del cron es
correcto por diseño; no debe envolverse en `withTenant()`. Decisión
documentada en `evaluateStatusTransitions()`.

**Archivos:** `apps/server/src/modules/licensing/subscriptions/subscriptions.service.ts`,
`apps/server/src/infrastructure/prisma/prisma.service.ts`.

---

### FIX-004: `tenant-config.service.ts` — TOCTOU en optimistic locking (5 sitios)

**Problema:** El mecanismo de versión (`expectedConfigVersion`) se valida con
un `findUnique` (líneas 408-416) y luego se aplica un `update()` sin guardia
de versión (líneas 541, 591, 643, 1131, 1367). Dos requests concurrentes con
la misma `expectedConfigVersion` pasan ambos el check → lost update: el
read-modify-write de un cajero pisa las secciones del otro.

**Solución:** Reemplazar el check + update por actualización condicional
atómica:

```ts
const updated = await this.prisma.tenantConfig.updateMany({
  where: { id, configVersion: expectedConfigVersion },
  data: { configVersion: { increment: 1 }, /* ...resto del patch... */ },
});
if (updated.count === 0) {
  throw new ConfigVersionConflictException(expectedConfigVersion);
}
```

Alternativa: `SELECT ... FOR UPDATE` dentro de `$transaction` (row lock) antes
del read-modify-write. Aplicar en los 5 puntos (líneas ~541, 591, 643, 1131,
1367).

**Archivos:** `apps/server/src/modules/tenant-config/services/tenant-config.service.ts`.

---

### FIX-005: `auth.service.ts:1001-1053` — race en lockout de login

**Problema:** Contador de intentos fallidos con read-modify-write no atómico:

```ts
const newFailedAttempts = user.failedLoginAttempts + 1; // read
// ...
data: { failedLoginAttempts: newFailedAttempts },        // write
```

Dos logins concurrentes leen `failedLoginAttempts = 9` → ambos escriben 10 →
el umbral de bloqueo (10/20) nunca se cruza → **bypass del lockout por race**.

**Solución:** Incremento atómico + releer para decidir bloqueo:

```ts
await this.prisma.user.update({
  where: { id: userId },
  data: { failedLoginAttempts: { increment: 1 } },
});
const updated = await this.prisma.user.findUnique({ where: { id: userId } });
if (updated.failedLoginAttempts >= 10) { /* lockout */ }
```

Nota: `@nestjs/throttler` ya está aprobado como dependencia para endpoints de
auth — usarlo como defensa en profundidad sobre el mismo endpoint de login.

**Archivos:** `apps/server/src/modules/auth/auth.service.ts`.

---

### FIX-006: Race de `sequentialNumber` en purchases (3 sitios)

**Problema:** `getNextSequentialNumber()` en purchase-orders
(línea 285), purchase-receptions (línea 589) y supplier-returns (línea 308)
hace `findFirst orderBy sequentialNumber desc + 1` sin lock ni retry. Dos
creaciones concurrentes (dos cajeros) → mismo número de secuencia. El path de
sync sí tiene advisory lock; el path HTTP no.

**Solución:** Copiar el patrón de `sales.service.ts:121-124` (advisory lock +
retry P2002 ×5):

```ts
const lockKey = PurchaseOrdersService.hashEntityId(tenantId + ':' + 'PO'); // o por tipo doc
await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey}::bigint)`;
// ...findFirst + 1, create, retry 5x ante P2002
```

Aplicar en: `create()` de purchase-orders, purchase-receptions y
supplier-returns. Extraer un helper compartido (p.ej.
`common/utils/sequential-number.ts`) en lugar de duplicar el hash en cada
servicio.

**Archivos:** `apps/server/src/modules/purchases/services/{purchase-orders,purchase-receptions,supplier-returns}.service.ts`.

---

### FIX-007: `supplier-returns.service.ts:183` — `confirmReturnFromSync` sin advisory lock

**Problema:** PO (`purchase-orders.service.ts:168`) y reception
(`purchase-receptions.service.ts:263`) serializan el check de idempotencia +
create con `pg_advisory_xact_lock`; el supplier return NO → inconsistencia.
BullMQ puede entregar el mismo job a dos workers → P2002 en
`(sequentialNumber, supplierId)`.

**Solución:** Añadir el mismo `pg_advisory_xact_lock` con
`hashEntityId(payload.returnId)` al inicio del `$transaction` de
`confirmReturnFromSync`.

**Archivos:** `apps/server/src/modules/purchases/services/supplier-returns.service.ts`.

---

### FIX-008: `fiscal-transmission.service.ts` (fiscal-engine) — doble transmisión

**Problema:** `transmit()` hace `loadPendingDocument` → `transitionToInTransmission`
sin row lock. Dos triggers concurrentes (retry del worker + re-trigger manual)
pueden transmitir el mismo documento dos veces. DIAN no da idempotencia (la
limitación ya está documentada en el código).

**Solución:** Claim con row lock: `SELECT ... FOR UPDATE` sobre el
FiscalDocument (o `updateMany where fiscalState = PENDING_SIGNATURE` +
verificar count) antes de iniciar la transmisión.

**Archivos:** `apps/fiscal-engine/src/modules/fiscal-processing/fiscal-transmission.service.ts`.

---

## P1 — Rendimiento

### FIX-009: `sync-operation-dispatcher.service.ts:678` — `generateNextOfflineProductCode` carga todos los productos

**Problema:** El comentario dice "raw SQL MAX" pero la implementación trae
TODOS los productos con `internalCode` empezando por `P` a memoria y calcula
el máximo en JS:

```ts
const all = await this.prisma.product.findMany({
  where: { internalCode: { startsWith: 'P' } },
  select: { internalCode: true },
});
```

Cada creación de producto offline → full scan + carga completa + reduce en
memoria.

**Solución:** MAX numérico en SQL (compara numéricamente, no lexicográfico,
igual que el comentario original):

```sql
SELECT MAX(CAST(SUBSTRING("internalCode" FROM 2) AS BIGINT))
FROM "Product"
WHERE "internalCode" LIKE 'P%' AND "internalCode" ~ '^P[0-9]+$';
```

La race (MAX + insert fuera de transacción) queda cubierta por el unique
constraint y el retry del SyncQueue — ya documentado como aceptado.

**Archivos:** `apps/server/src/modules/sync/sync-operation-dispatcher.service.ts`.

---

### FIX-010: `purchase-receptions.service.ts:198` — O(n²) en `confirm()`

**Problema:** `tx.purchaseOrderItem.findMany({ where: { purchaseOrderId } })`
se ejecuta DENTRO del loop de items (líneas 166-210), cuando los items ya
vienen cargados en el `include` de la línea 156. Reception de 10 items → 10
re-fetch redundantes + 1 update de PO por item.

**Solución:** Calcular el estado del PO una sola vez después del loop, usando
los items ya cargados (`reception.purchaseOrder.items`) aplicando los
incrementos acumulados en memoria, y hacer un único `purchaseOrder.update`.
Para N items: de ~4N+2N queries a ~3N+1.

**Archivos:** `apps/server/src/modules/purchases/services/purchase-receptions.service.ts`.

---

### FIX-011: `blessing.service.ts:74-110` — batch de sesiones offline serial

**Problema:** `blessSessions()` procesa hasta 50 sesiones en secuencia, cada
una con 2-3 queries (`getSessionState` + `isRevoked` + `recordBlessing`) →
hasta ~150 round trips seriales por request.

**Solución:**
1. Fetch de todos los `tokenHash` revocados en 1 query con `IN` (hacer
   `isRevoked` por hash en memoria).
2. Writes independientes con `Promise.allSettled` (acotado a 50).

**Archivos:** `apps/server/src/modules/auth/offline/blessing.service.ts`.

---

### FIX-012: `workstation-heartbeat.service.ts:53-81` — `create` en loop

**Problema:** `recordHeartbeats()` inserta cada heartbeat con `create`
individual en un `for`.

**Solución:** `createMany` con batch (p.ej. 500 por lote). Nota: `createMany`
omite triggers y no devuelve filas — verificar que el modelo no depende de
hooks de Prisma (no los hay) ni de `@@ignore`.

**Archivos:** `apps/server/src/modules/sync/services/workstation-heartbeat.service.ts`.

---

### FIX-013: `reports.service.ts` — `getSalesSummary` agrega en JS

**Problema:** Carga TODAS las ventas confirmadas del rango en memoria
(`fetchConfirmedSales`) y agrega por día/método de pago en JS
(`buildSalesBreakdown`, `computeSalesTotals`).

**Solución:** Agregación en SQL con `prisma.sale.groupBy` (por día +
paymentMethod, sumas de `totalAmount`/`totalTax`/`totalCost`/`changeAmount`) o
`$queryRaw` con `GROUP BY`. El índice `@@index([operationalState, confirmedAt])`
ya existe — confirmar que el planner lo usa. Añadir paginación o límite de
rango en el endpoint.

**Archivos:** `apps/server/src/modules/reports/services/reports.service.ts`.

---

### FIX-014: `products.service.ts` findAll — búsqueda ILIKE no anclada

**Problema:** `where.OR` con `contains` + `mode: 'insensitive'` sobre
`commercialName`/`internalCode` → `ILIKE '%x%'` que no usa el índice btree de
`commercialName` → seq scan por búsqueda. Sin `take` → respuesta no acotada.

**Solución:**
1. Paginación (reusar `cursor-pagination.ts`).
2. Índice trigram: `CREATE EXTENSION pg_trgm;` +
   `CREATE INDEX ... USING GIN ("commercialName" gin_trgm_ops)` (migración)
   — soporta `ILIKE '%x%'` con `pg_trgm`.

**Archivos:** `apps/server/src/modules/catalog/services/products.service.ts`,
`packages/database/prisma/schema/models/product.prisma` (o nombre real).

---

### FIX-015: Índice faltante `Sale(workstationId, localNumber)`

**Problema:** `sales.service.ts:625` `getNextLocalNumber` filtra por
`workstationId` y ordena por `localNumber desc`. Sale tiene
`@@index([workstationId, confirmedAt])` pero NO `(workstationId, localNumber)`
→ sort en cada venta confirmada (hot path).

**Solución:** Migración: `@@index([workstationId, localNumber])` en `Sale`.

**Archivos:** `packages/database/prisma/schema/models/sale.prisma` + migración.

---

### FIX-016: `sync.service.ts:55-66` — `receiveBatch` serial

**Problema:** `for...of` con `await ingestOperation` por operación → latencia
proporcional al tamaño del batch.

**Solución:** Los writes deben permanecer seriales (correctitud), pero
paralelizar las lecturas de validación (DTO con Zod, pre-checks) con
`Promise.all` acotado (p.ej. 10 concurrentes). Documentar el trade-off.

**Archivos:** `apps/server/src/modules/sync/services/sync.service.ts`.

---

### FIX-017: `cash-shift.service.ts:179-200` — `flagExtendedShifts` por tenant (documentar)

**Problema:** `subscription.findMany({ select: { id: true } })` sin límite + 1
transacción `withTenant` por subscripción (obligatorio por RLS: cada tenant
necesita su propio `SET LOCAL app.current_tenant`). Costo O(#tenants), 1
commit por tenant.

**Solución:** Aceptable por diseño; documentar en el código. Opcional: límite
de procesamiento por corrida (p.ej. primeros 500) para acotar el job.

**Archivos:** `apps/server/src/modules/cash-shift/cash-shift.service.ts`.

---

## P2 — Mejoras de calidad

### FIX-018: `purchase-receptions.service.ts:168` — Error plano sin errorCode

**Problema:** `new Error('Item ... is missing expiration date')` → 500
genérico vía `HttpExceptionFilter`; viola la regla de excepciones de dominio
(errorCode + message estable).

**Solución:** Crear `MissingExpirationDateException` en
`exceptions/` extendiendo la base de DomainException del módulo.

**Archivos:** `apps/server/src/modules/purchases/exceptions/`.

---

### FIX-019: `audit-log.interceptor.ts:57-63` — write de auditoría post-respuesta

**Problema:** El insert de auditoría es fire-and-forget DESPUÉS de responder,
fuera de la transacción del request → se pierde ante crash y no es atómico con
la mutación. (AuditLog no tiene RLS — verificado — el write al root client
funciona, `subscriptionId` queda NULL.)

**Solución:** Escribir dentro de la transacción del request (via
`TenantContextService` → `runWithTenant`/tx activa) cuando el interceptor
corre dentro del contexto, manteniendo el catch para que un fallo de auditoría
nunca bloquee la respuesta.

**Archivos:** `apps/server/src/common/interceptors/audit-log.interceptor.ts`,
`apps/server/src/modules/tenant/tenant-context.service.ts`.

---

### FIX-020: fiscal-engine — quitar `(this.prisma as any)` en 3 sitios

**Problema:** `fiscal-transmission.service.ts:82` y
`fiscal-documents.service.ts:122,151` usan `(this.prisma as any).techProviderConfig`
/ `.fiscalIssuerConfig`. Viola la regla de no-cast. Si el cliente generado del
worker no incluye esos modelos → extender la generación; si los incluye →
quitar los casts y dejar el tipo real.

**Archivos:** `apps/fiscal-engine/src/modules/fiscal-processing/{fiscal-transmission,fiscal-documents}.service.ts`.

---

### FIX-021: `fiscal-documents.service.ts` (server) — verificar paginación en findAll

**Problema:** `findAll` construye `where` con filtros (state, documentType,
rango de fechas) pero no se confirmó `take`/límite en la lectura truncada.

**Solución:** Confirmar `take`/paginación; si no existe, aplicar
`cursor-pagination.ts`. Verificar que `@@index([fiscalState, lastRetryAt])`
cubre el poll del worker de retry.

**Archivos:** `apps/server/src/modules/fiscal-dian/services/fiscal-documents.service.ts`.

---

### FIX-022: `tenant-config.service.ts:332` — uuid nil como sentinel de taxScheme

**Problema:** Fallback `'00000000-0000-0000-0000-000000000000'` como
`taxSchemeId` cuando no hay esquema activo.

**Solución:** Documentar el sentinel en el modelo/schema, o hacer el campo
nullable en recepciones. No cambiar sin revisar la FK.

**Archivos:** `packages/database/prisma/schema/models/purchase-reception.prisma`.

---

## Índices recomendados (resumen de migraciones)

| Modelo | Índice | Motivo | Fix |
|---|---|---|---|
| `Client` | `@@index([updatedAt, id])` | Paginación keyset de `findAll` | FIX-001 |
| `Product` | GIN `gin_trgm_ops` sobre `commercialName` (+ `internalCode`) | ILIKE `%x%` | FIX-014 |
| `Sale` | `@@index([workstationId, localNumber])` | `getNextLocalNumber` hot path | FIX-015 |
| `PurchaseOrder` / `PurchaseReception` / `SupplierReturn` | verificar índice sobre `sequentialNumber` (parcial por tenant si aplica) | `getNextSequentialNumber` | FIX-006 |

## Orden de ejecución sugerido

1. **FIX-009** (raw MAX) — simple, alto impacto.
2. **FIX-010** (N² reception) — simple, alto impacto.
3. **FIX-005, FIX-004, FIX-006, FIX-007** — races de correctitud.
4. **FIX-011, FIX-012** — loops → batch.
5. **FIX-015** — migración índice Sale.
6. **FIX-014** — paginación + trigram.
7. **FIX-013, FIX-016, FIX-017** — agregación SQL y latencia de sync.
8. **FIX-018, FIX-019, FIX-020, FIX-021, FIX-022** — calidad.
9. **FIX-001, FIX-002, FIX-003, FIX-008** — seguridad (pueden subir de
   prioridad según exposición).

## Cobertura de tests (invocar al testing agent)

- Unit (mocks `mockDeep<PrismaClient>`): FIX-009, FIX-010, FIX-011, FIX-012,
  FIX-013, FIX-018.
- Integración Testcontainers (PostgreSQL real, obligatorio por concurrencia):
  FIX-004 (TOCTOU config), FIX-005 (race lockout), FIX-006/FIX-007 (race
  sequentialNumber), FIX-008 (doble transmisión), FIX-015 (índice).
- E2E: FIX-001 (paginación clients), FIX-014 (búsqueda productos).
