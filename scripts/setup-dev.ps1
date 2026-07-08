<#
.SYNOPSIS
  One-command full development environment launch.

.DESCRIPTION
  1. Starts PostgreSQL + Redis via Docker (docker-compose.dev.yml)
  2. Waits for services to be healthy
  3. Regenerates Prisma client
  4. Pushes schema to the database
  5. Seeds the database with test data
  6. Shows login credentials

  Safe to run multiple times — seed is idempotent.

.EXAMPLE
  .\scripts\setup-dev.ps1
#>

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ComposeFile = Join-Path $ProjectRoot 'docker-compose.dev.yml'

Write-Host '================================================' -ForegroundColor Cyan
Write-Host '  Pharmacy System — Development Setup' -ForegroundColor Cyan
Write-Host '================================================' -ForegroundColor Cyan
Write-Host ''

# Step 1: Start Docker infrastructure
Write-Host '[1/5] Starting Docker infrastructure...' -ForegroundColor Yellow
docker compose -f $ComposeFile up -d

Write-Host '    Waiting for PostgreSQL...' -ForegroundColor Gray
docker compose -f $ComposeFile wait postgres-dev

Write-Host '    Waiting for Redis...' -ForegroundColor Gray
docker compose -f $ComposeFile wait redis-dev

Start-Sleep -Seconds 2
Write-Host '    Infrastructure ready.' -ForegroundColor Green
Write-Host ''

# Step 2: Install dependencies if needed
Write-Host '[2/5] Installing dependencies...' -ForegroundColor Yellow
Push-Location $ProjectRoot
pnpm install --frozen-lockfile
Pop-Location
Write-Host '    Dependencies installed.' -ForegroundColor Green
Write-Host ''

# Step 3: Generate Prisma client
Write-Host '[3/5] Generating Prisma client...' -ForegroundColor Yellow
Push-Location (Join-Path $ProjectRoot 'packages/database')
pnpm db:generate:full
Pop-Location
Write-Host '    Prisma client generated.' -ForegroundColor Green
Write-Host ''

# Step 4: Push schema to database
Write-Host '[4/5] Pushing schema to database...' -ForegroundColor Yellow
Push-Location (Join-Path $ProjectRoot 'apps/server')
$env:DATABASE_URL = 'postgresql://pharmacy_dev:pharmacy_dev@localhost:5432/pharmacy_dev_db'
npx prisma db push --schema ../../packages/database/prisma/schema/schema.prisma
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Schema push failed!' -ForegroundColor Red
    exit 1
}
Write-Host '    Schema pushed.' -ForegroundColor Green
Write-Host ''

# Step 5: Seed database
Write-Host '[5/5] Seeding database...' -ForegroundColor Yellow
npx tsx prisma/seed.ts
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Seed failed!' -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location
Write-Host ''

Write-Host '================================================' -ForegroundColor Green
Write-Host '  Development environment ready!' -ForegroundColor Green
Write-Host '================================================' -ForegroundColor Green
Write-Host ''
Write-Host '  Next steps:' -ForegroundColor White
Write-Host '    pnpm dev           — start all apps (server + POS)' -ForegroundColor Gray
Write-Host '    pnpm dev:start     — start server only' -ForegroundColor Gray
Write-Host '    cd apps/pos-desktop && pnpm dev  — start POS only' -ForegroundColor Gray
Write-Host ''
Write-Host '  API:        http://localhost:3000' -ForegroundColor White
Write-Host '  Swagger:    http://localhost:3000/api' -ForegroundColor White
Write-Host '  PostgreSQL: localhost:5432 (pharmacy_dev / pharmacy_dev / pharmacy_dev_db)' -ForegroundColor White
Write-Host '  Redis:      localhost:6379' -ForegroundColor White
Write-Host ''
Write-Host '  Login credentials (from seed data):' -ForegroundColor White
Write-Host '    admin      / Admin123!     (ADMIN)' -ForegroundColor Gray
Write-Host '    cashier1   / Cashier123!   (CASHIER)' -ForegroundColor Gray
Write-Host '    inventory  / Inventory123! (INVENTORY_ASSISTANT)' -ForegroundColor Gray
Write-Host '    accountant / Accountant123!(ACCOUNTANT)' -ForegroundColor Gray
Write-Host ''
Write-Host '  To stop everything:  docker compose -f docker-compose.dev.yml down' -ForegroundColor Gray
Write-Host '  To reset database:   docker compose -f docker-compose.dev.yml down -v && .\scripts\setup-dev.ps1' -ForegroundColor Gray
Write-Host ''
