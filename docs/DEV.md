# How to use - simple commands

## Option 1: One-command (recommended for first time)

```powershell
# From the project root - does EVERYTHING: Docker, dependencies, schema, seed
.\scripts\setup-dev.ps1
```

## Option 2: Step by step (more control)

```bash
# 1. Start databases
docker compose -f docker-compose.dev.yml up -d

# 2. Install dependencies (only the first time)
pnpm install

# 3. Generate Prisma client
pnpm db:generate

# 4. Push schema
pnpm dev:db:push

# 5. Seed test data
pnpm dev:db:seed

# 6. Start server
pnpm dev:start
```

## Option 3: Everything from root with a single command

```bash
pnpm setup:dev     # install + generate + infra + push + seed
pnpm dev           # start server + pos-desktop in parallel
```

---

### Test data included in the seed (idempotent)

| Entity | Quantity |
|--------|----------|
| Users | 5 (admin, cashier1, cashier2, inventory, accountant) |
| Workstations | 2 (Main Cashier, Secondary Cashier) |
| Categories | 10 (ANALGESICS, ANTIBIOTICS, etc.) |
| Pharmaceutical forms | 9 (TABLET, CAPSULE, SYRUP, etc.) |
| Tax schemes | 3 (VAT 19%, VAT 5%, Exempt) |
| Payment methods | 7 (Cash, Debit, Credit, PSE, Nequi, Daviplata) |
| Products | 25 (with prices, tax histories, and EAN13 barcodes) |
| Suppliers | 3 (Disfarma, Colvan, Cruz Verde) |
| Customers | 10 (8 individuals + 2 institutional) |
| Inventory batches | 25 (with initial stock and INITIAL_STOCK movements) |
| Cash shifts | 2 (1 open today, 1 closed yesterday with reconciliation) |

---

### Login credentials

| Username | Password | Role |
|----------|----------|------|
| admin | Admin123! | ADMIN |
| cashier1 | Cashier123! | CASHIER |
| inventory | Inventory123! | INVENTORY_ASSISTANT |
| accountant | Accountant123! | ACCOUNTANT |

---

### For the POS Desktop

The POS desktop uses **PGlite** (embedded PostgreSQL) - it does not need Docker. It only needs the server to be running:

```bash
cd apps/pos-desktop
pnpm dev
```

The Vite dev server starts at `http://localhost:5174` and connects to the server API at `http://localhost:3000` (configured in `apps/pos-desktop/.env`).

---

### For E2E tests

The existing script still works the same:

```powershell
.\scripts\test-e2e.ps1
```

It uses `docker-compose.test.yml` (ports 5433 and 6380, no persistence) and starts/stops automatically.