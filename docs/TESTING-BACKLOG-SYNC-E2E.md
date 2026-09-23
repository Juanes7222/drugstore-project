# Testing Backlog — Sync, Hub & Workstation Flows (Next Session)

**Created:** 2026-09-22
**Scope:** Remaining tests to complete full production-confidence coverage of the
offline-first sync system (POS ↔ server hub ↔ fiscal engine).
**Current state:** 12 integration specs / 37 tests green (`apps/pos-desktop`,
vitest), 51/51 dispatcher unit specs, 151/151 fiscal-engine specs. Every run
verified twice for idempotency against the persistent test DB.

---

## 1. Where the coverage stands

The following flows are covered end-to-end (real POS services over PGlite →
HTTP → real NestJS AppModule → PostgreSQL → server-side replay):

| Flow | Spec |
|---|---|
| Sale POS → server replay → DB (id mapping, stock, lots) | `pos-server-replay`, `pos-multi-terminal` |
| Idempotency (batch re-delivered → `ALREADY_ACCEPTED`) | `pos-sync-resilience` |
| Corrupt payload → `PERMANENT_FAILURE` without poisoning batch | `pos-sync-resilience` |
| Pull server→POS (catalog, prices, clients, lots) | `pos-pull` |
| Cross-tenant isolation | `pos-cross-tenant` |
| Price propagation POS→POS via incremental pull + local-edit guard | `pos-multi-pos-price-pull` |
| Client returns (stock credit + credit note) | `pos-client-return` |
| Lot dependencies (FEFO, exhausted lots) | `pos-lot-dependencies` |
| Other operation types (shift closure, inventory adjustment, credit payment, etc.) | `pos-other-operations` |
| Fiscal contingency (sale during `ResolutionExhaustedException`, window expiry) | `pos-fiscal-contingency`, `pos-fiscal-expiry` |
| **Auto dependency requeue (client + product chains)** | `pos-dependency-requeue` |

Bugs the integration suite already caught and fixed in production code:

1. `INVOICE_TRANSMISSION` payload shipped with `saleId: ''` / `provisionalCufe: ''`
   → every real push failed server-side validation.
2. Seller fields (`nit`, `name`) and `lineItems[].productId` shipped empty.
3. Shared-validation CUFE schema demanded 64 hex but the POS generates
   SHA-384 = 96 hex.
4. `ContingencyResultWriter` could not resolve the workstation for
   contingency documents (`doc.saleId` is the POS-local sale id, which does
   not exist as a server `Sale`) → DIAN results were silently dropped.
5. POS could not match `SyncInvoiceResult` by `invoiceId` for contingency
   documents (fixed with `id` OR `saleId` fallback).
6. **Degraded-sale patch gap:** a cash sale arriving before its
   `CLIENT_CREATION` was replayed as `CONFIRMED` with `clientId = null`; the
   sale's queue row was already `COMPLETED`, so `requeueDependentsOf` could
   never see it and nothing re-delivered it. Fixed by having the
   `CLIENT_CREATION` handler scan for degraded sales referencing the local
   client uuid and re-attribute them (`patchOrphanSaleClient`).

---

## 2. Backlog — ordered by risk

### 2.1 Concurrent push race: two POS, same lot, stock exactly sufficient  🔴 HIGH

**Why:** all multi-terminal specs are sequential. The race is the classic
production bug: two cashiers sell the last unit at the same time.

**Test ideas:**
- Two PGlite POS instances push batches **concurrently**
  (`Promise.all` with real HTTP) against the same lot with
  `currentStock = 1` and two sales of 1 unit each.
  - Assert: exactly one sale `COMPLETED`, the other `PERMANENT_FAILURE`
    with `Insufficient stock`; lot `currentStock = 0`; **no negative stock**.
- Same scenario but with stock = 2 and both sales succeeding — assert
  `currentStock = 0` and exactly 2 `InventoryMovement` rows (no lost update).
- Same `clientSequence` from both workstations: verify the server
  never merges them (per-workstation sequence scoping).
- Concurrent `SHIFT_OPEN` from two workstations under the global-shift
  model: assert exactly ONE open shift exists (advisory-lock path in
  `ensureGlobalShiftAttribution`).
- Concurrent `PRODUCT_CREATION` with the same `OFFLINE-` code from two
  workstations: one gets a P-code, the other retries via P2002 and
  eventually converges — no duplicate products.

**Files to touch:** new `pos-concurrent-push.integration.test.ts` in
`apps/pos-desktop/src/domain/integration/` (reuse the multi-terminal harness).

### 2.2 Integrity verification endpoint  🔴 HIGH

**Why:** `POST /sync/integrity/verify` is the mechanism that detects
**silent data loss** (gaps in the ledger, permanently failed ops). Zero
tests today — if it breaks, lost operations are never noticed.

**Test ideas:**
- Healthy ledger: POS pushes N operations, all complete; call verify →
  no gaps reported.
- Simulate a lost operation (delete one server `SyncQueue` row between
  pushes) → verify reports the gap with the correct `clientSequence`.
- A `PERMANENT_FAILURE` row on the server → verify flags it in the
  response and the POS surfaces it.
- Auth: verify endpoint must reject another workstation's token
  (workstation-scoped ledger check).
- Cross-tenant: tenant B's verify never sees tenant A's rows (RLS).

### 2.3 Client credit money flows  🟠 MEDIUM-HIGH

**Why:** credit sales and payments move real money; only the happy path
inside `pos-other-operations` is exercised.

**Test ideas:**
- Credit sale offline → sale confirmed with `creditState = PENDING`;
  `CLIENT_CREDIT_PAYMENT` pushed → server creates the payment,
  `creditState` converges, account balance reduces by the exact amount.
- **Overpayment attempt** → server must reject (domain rule) and the POS
  entry must land `PERMANENT_FAILURE`, not corrupt the balance.
- Payment + annulment (`CLIENT_CREDIT_PAYMENT_ANNULMENT`) → balance
  restored exactly; re-delivery of the annulment is idempotent.
- Concurrent payment + return on the same client from two workstations
  → final balance consistent (double-entry style invariant).
- Degraded client (clientId null at replay time, see bug #6) followed by
  credit sale → credit is attached to the patched client, not lost.

### 2.4 Operation types still without a full POS→server→DB flow  🟠 MEDIUM

From the 19 types the dispatcher handles, these lack a full-flow spec:
`CLIENT_UPDATE`, `CLIENT_DEACTIVATE`, `INVOICE_ADJUSTMENT`,
`PURCHASE_ORDER_CONFIRMATION`, `SUPPLIER_RETURN_CONFIRMATION`,
`AUDIT_LOG_BATCH`.

**Test ideas (one spec each, minimal):**
- `CLIENT_UPDATE`: offline edit + edit at the server via backoffice while
  offline → last-writer-wins converges; the POS pulls the merged state.
- `CLIENT_DEACTIVATE`: deactivate offline + attempt to sell to that
  client online → replay must surface the domain rule (client inactive).
- `PURCHASE_ORDER_CONFIRMATION`: PO pushed before/after its reception →
  idempotency + the PO-stub path in `confirmReceptionFromSync`.
- `SUPPLIER_RETURN_CONFIRMATION`: stock leaves the server lot; FEFO
  allocation; idempotent on re-delivery.
- `AUDIT_LOG_BATCH`: 200-entry batch with one malformed row inside →
  the batch still completes, the bad row is rejected individually
  (savepoint isolation).

### 2.5 Sync resilience corner cases  🟡 MEDIUM

- **Retry storm control:** server returns 500 twice, then accepts → POS
  backoff schedule respected (`nextRetryAt`), no duplicate server rows.
- **Batch > server limit:** outbox with 300 PENDING rows → batching
  chunks correctly; order within a batch preserved by `clientSequence`.
- **Token expiry mid-push:** access token expires between pushes → POS
  refresh path silently rotates and the push succeeds (no operation lost
  or duplicated).
- **Payload hash mismatch:** mutate the payload after enqueueing →
  server returns `REJECTED: PAYLOAD_HASH_MISMATCH`; POS marks
  `PERMANENT_FAILURE`; other entries in the batch unaffected.
- **Clock skew:** POS local clock 5 minutes ahead → `sourceCreatedAt`
  ordering does not break replay (server relies on `clientSequence`, not
  timestamps).

### 2.6 Fiscal engine ↔ hub edge cases  🟡 MEDIUM

- DIAN result arrives **after** the 48h contingency window expired but
  the invoice was already transmitted (`EXPIRED_CONTINGENCY` race).
- Two contingency invoices for the same sale (operator retried) → only
  one transmission accepted server-side (idempotency on CUFE).
- `SyncInvoiceResult` arrives for an invoice the POS already expired →
  POS must not resurrect `EXPIRED_CONTINGENCY` to `TRANSMITTED_AUTHORIZED`.

### 2.7 Performance / soak (optional, last)  🟢 LOW

- 1,000 operations in one outbox pushed in one session → wall-clock
  time and zero losses (baseline metric for regressions).
- 10 "days" of offline operation (2,000 sales, 500 clients, 30 products)
  → push + pull converge, integrity verify clean.

---

## 3. Harness notes for the next session

- **Integration harness location:**
  `apps/pos-desktop/src/domain/integration/` — copy
  `pos-dependency-requeue.integration.test.ts` as the template: it seeds
  the server (subscription, workstation, user, tax scheme, payment method,
  resolution/allocation, product+lot+supplier) and boots the real
  `AppModule` + a PGlite POS.
- **Run command:**
  `cd apps/pos-desktop && npx vitest run --config vitest.integration.config.ts`
- **Prerequisites:** Docker test PostgreSQL on port **5433**
  (`pharmacy_test/pharmacy_test_db`) and Redis on **6380**. If the
  container was recreated, run
  `node -e "require('./apps/server/test/global-setup.cjs')().then(...)"` —
  the module exports an async setup (migrations + role password).
- **Deterministic ids:** use the `uuidFrom(seed)` helper; make
  identification numbers / barcodes **unique per run**
  (`${base}-${Date.now()}`) because the server upserts clients by
  identification key against the persistent DB.
- **Server-side cleanups must include dynamic rows** created by previous
  runs (e.g. receptions for a deterministic supplier — the dispatcher's
  idempotency fallback matches `(sequentialNumber, supplierId)`).
- **Cron-driven dispatch:** operation types NOT in
  `SyncService.IMMEDIATE_DISPATCH_TYPES` (e.g. `CLIENT_CREATION`) are only
  dispatched by `SyncProcessingJob.processPendingOperations()` — invoke it
  directly (`serverApp.get(SyncProcessingJob)`) in a drain loop; do not
  wait for the real 30s cron.
- **Chain rule learned:** when a dependency requeue revives an entry
  inside the same drain, it may fail again for the NEXT missing dependency.
  Design assertions around the final state after the full chain
  (sale → product → reception → completed), not intermediate ones.

## 4. Definition of done for this backlog

- Every new spec runs **twice consecutively green** (persistent DB).
- `npx tsc --noEmit` clean in `apps/server`, `apps/pos-desktop`,
  `apps/fiscal-engine`.
- `eslint` 0 errors on touched files (warnings must not regress the
  current baseline).
- Any production bug found gets a fix + a regression note appended to
  section 1 of this document.
