# Testing Backlog — Sync, Hub & Workstation Flows (Next Session)

**Created:** 2026-09-22
**Scope:** Remaining tests to complete full production-confidence coverage of the
offline-first sync system (POS ↔ server hub ↔ fiscal engine).
**Current state:** 18 integration specs / 73 tests green (`apps/pos-desktop`,
vitest) — includes the 6 specs written from this backlog (see §2). Verified
twice consecutively against the persistent test DB (18/18 specs, 73/73 tests
both runs). Unit suites: 51/51 dispatcher, 28/28 supplier-returns,
47/47 sync-push, 151/151 fiscal-engine, full POS vitest 6295+ green.

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
7. **Supplier returns from sync never consumed stock**
   (`apps/server/src/modules/purchases/services/supplier-returns.service.ts`,
   `confirmReturnFromSync`): the replay path created the return directly as
   `CONFIRMED` without calling `consumeStockForSupplierReturn`, while the
   online `confirm()` path does consume. Result: the server lot kept the
   returned stock — inflated inventory and sellable goods that had left the
   store. Found by `pos-purchases-sync.integration.test.ts` (stock assertion
   on `SUPPLIER_RETURN_CONFIRMATION`). Fixed: create as `DRAFT`, consume
   stock per item, then flip to `CONFIRMED` (same create→consume→confirm
   flow as the online path).
8. **Transient push failures never backed off — retry storm → premature
   PERMANENT_FAILURE** (`apps/pos-desktop/src/domain/sync/sync-push.service.ts`,
   `recordBatchFailure`): after any network error or 5xx the entry was
   left in `PENDING` with a `nextRetryAt` that nothing read —
   `fetchPendingEntries` selects `PENDING` rows unconditionally. Every
   subsequent push retried the whole batch immediately (sub-second), so a
   short server outage burned all 10 retry attempts in seconds and
   stranded operations in `PERMANENT_FAILURE` even though the server was
   back. Found by the retry-storm test in `pos-sync-edge-cases` (backoff
   window assertions). Fixed: failed attempts now move the entry to
   `FAILED` with the exponential-backoff `nextRetryAt` (which is the state
   `fetchPendingEntries`, the scheduler's reconnect reset, and the docs
   already assumed); `PERMANENT_FAILURE` also clears `nextRetryAt`.
   Unit spec `sync-push.service.test.ts` updated + regression covered in
   the integration spec.
9. **Stale unit mocks masked the CUFE-by-saleId fix:**
   `invoice.service.test.ts`'s `applyTransmissionResult` tests stubbed
   `invoice.update` directly and the mock's `findFirst` did not understand
   the `OR: [{id}, {saleId}]` clause introduced with bug fix #5 — they
   failed once the whole suite was run. Fixed the mock (OR-aware) and
   rewrote the tests to seed the store; added a regression test that the
   result matched by `saleId` applies to the right invoice.

---

## 2. Backlog — ordered by risk

> **Status 2026-09-24:** items 2.1–2.6 are DONE (specs written, green, and
> the bugs above were found and fixed). Only the optional 2.8 soak
> (1,000+ ops) remains; a light 35-op soak is included in
> `pos-sync-edge-cases`. Behavioral findings learned while writing them
> are listed in §2.7.

### 2.1 Concurrent push race: two POS, same lot, stock exactly sufficient  🔴 HIGH — ✅ DONE

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

### 2.2 Integrity verification endpoint  🔴 HIGH — ✅ DONE

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

### 2.3 Client credit money flows  🟠 MEDIUM-HIGH — ✅ DONE

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

### 2.4 Operation types still without a full POS→server→DB flow  🟠 MEDIUM — ✅ DONE

(See also the AUDIT_LOG_BATCH finding in §2.7 — the doc's original
assumption of per-row savepoint isolation was wrong.)

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

### 2.5 Sync resilience corner cases  🟡 MEDIUM — ✅ DONE

(Retry-storm control done as a real backoff-schedule test; it found bug #8.
Token-expiry mid-push is covered by the unit specs of `refreshAccessToken`
+ the AUTH retry-budget test in `pos-sync-edge-cases`.)

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

### 2.6 Fiscal engine ↔ hub edge cases  🟡 MEDIUM — ✅ DONE

Covered by the second test in `pos-fiscal-expiry.integration.test.ts`.
One finding CONTRADICTS the original bullet: a late DIAN result DOES
resurrect `EXPIRED_CONTINGENCY` → `TRANSMITTED_AUTHORIZED`, and that is
**intentional** (see §2.7).

- DIAN result arrives **after** the 48h contingency window expired but
  the invoice was already transmitted (`EXPIRED_CONTINGENCY` race).
- Two contingency invoices for the same sale (operator retried) → only
  one transmission accepted server-side (idempotency on CUFE).
- `SyncInvoiceResult` arrives for an invoice the POS already expired →
  POS must not resurrect `EXPIRED_CONTINGENCY` to `TRANSMITTED_AUTHORIZED`.

### 2.7 Behavioral findings (documented, NOT bugs — do not "fix" blindly)

> Kept after the coverage items; the numbering below reflects the order in
> which the specs surfaced them.

1. **Terminal state depends on the dispatch path** (`FAILED` vs
   `PERMANENT_FAILURE`): `SyncService.IMMEDIATE_DISPATCH_TYPES`
   (`PRODUCT_CREATION`, `PRODUCT_UPDATE`, `AUDIT_LOG_BATCH`, `SHIFT_OPEN`)
   mark permanent failures as `FAILED` **without** `nextRetryAt` on the
   HTTP path, while the cron (`SyncProcessingJob`) marks them
   `PERMANENT_FAILURE`. Same semantics (never retried), different status
   vocabulary. The integrity verifier maps both to wire `FAILED`, so it is
   safe today — but any code that branches on status must handle both.
2. **`CLIENT_CREATION` and `SALE_CONFIRMATION` do not pass Zod in the
   dispatcher** (cast directly): a type-invalid payload yields a
   transient `FAILED` (cron retries) instead of an immediate
   `PERMANENT_FAILURE`. All other types go through `parsePayload` →
   `SyncPayloadValidationException` (DomainException → permanent).
3. **`AUDIT_LOG_BATCH` has NO per-row isolation**: one malformed row
   fails the ENTIRE batch (`FAILED`, no retry). The original 2.4 bullet
   assumed savepoint isolation per row — it does not exist for this type.
4. **`PAYLOAD_HASH_MISMATCH` is classified as `CONFLICT`** (not
   `VALIDATION`) by the POS `classifyFailure` — the error text matches the
   `mismatch` heuristic. Surfaces in the UI as a conflict.
5. **The server hashes the PARSED payload object** — whitespace-only
   mutations do NOT change the hash; a field mutation does.
6. **A late DIAN result beats the local expiry window**:
   `applyTransmissionResult` updates status without a state guard, so an
   `EXPIRED_CONTINGENCY` invoice becomes `TRANSMITTED_AUTHORIZED` when the
   authoritative result finally arrives. This is the DESIRED behavior (DIAN
   ruling > local bookkeeping); a later scheduler pass does not re-expire it.
7. **`Lot.currentStock` uses optimistic locking** (`updateMany` with
   `version`): concurrent stock ops surface as
   `ConcurrentStockModificationException` / `InsufficientStockException`
   (DomainException → permanent). The loser of a last-unit race lands
   `PERMANENT_FAILURE`, which is exactly what the concurrent-push spec
   asserts.

### 2.8 Performance / soak (optional, last)  🟢 LOW — OPEN (optional)

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

**Status 2026-09-24:** all four met — full integration suite 18/18 specs /
73/73 tests green twice consecutively; `tsc --noEmit` clean on the three
apps; `eslint` 0 errors on every touched file (only pre-existing prettier
quote-style warnings remain); bugs #7–#9 above fixed with regression
tests. Item 2.8 (large soak) remains open as an optional baseline metric.

## 5. Harness additions learned this session

- **Fiscal specs need server-side fiscal seeds:** a sale replay requires a
  `FiscalResolution` + `FiscalResolutionAllocation` per workstation
  (`No active resolution allocation found for workstation ...` otherwise)
  and a real `PurchaseReception` behind the lot (unit cost is resolved
  from it).
- **`Lot.currentStock` writes use `version` optimistic locking** — to seed
  two POS instances selling the same server lot, seed the lot once and
  pull it into both PGlite instances.
- **FK cleanup order:** `AuditLog` references `UserSession`; delete audit
  rows before sessions, and delete sessions by `workstationId` too
  (covers interrupted runs) before removing a workstation.
- **Local `SyncQueue` schema gotcha:** no `createdAt/updatedAt`; requires
  `payloadSize`, `sourceWorkstationId`, `clientSequence`, `retryCount`,
  `sourceCreatedAt` when hand-inserting rows.
- **Local fiscal DB rows need the server's taxScheme id** (FK on pull
  upsert): create the local `taxScheme` with the SAME id as the server row.
- **Container recreations wipe the migrations volume:** if specs fail with
  `The table public.Plan does not exist`, re-run the global-setup command
  from §3 (it re-applies every migration and role password).
