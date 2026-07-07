<#
.SYNOPSIS
  Run E2E tests for apps/server against a real PostgreSQL via Docker.

.DESCRIPTION
  1. Start docker-compose.test.yml (PostgreSQL + Redis).
  2. Wait for healthchecks.
  3. Push Prisma schema to the test DB.
  4. Run jest with jest.e2e.config.ts.
  5. Capture exit code.
  6. Stop docker containers.
  7. Exit with the jest exit code.
#>

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ComposeFile = Join-Path $ProjectRoot 'docker-compose.test.yml'

Write-Host '=== Starting test infrastructure (Docker) ===' -ForegroundColor Cyan
docker compose -f $ComposeFile up -d

Write-Host '=== Waiting for PostgreSQL to be healthy... ===' -ForegroundColor Cyan
docker compose -f $ComposeFile wait postgres-test

Write-Host '=== Waiting for Redis to be healthy... ===' -ForegroundColor Cyan
docker compose -f $ComposeFile wait redis-test

# Extra sleep for PG to be really ready after healthcheck
Start-Sleep -Seconds 2

Write-Host '=== Pushing Prisma schema to test DB ===' -ForegroundColor Cyan
$env:DATABASE_URL = 'postgresql://pharmacy_test:pharmacy_test@localhost:5433/pharmacy_test_db'
Push-Location (Join-Path $ProjectRoot 'apps/server')
npx prisma db push --accept-data-loss
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Prisma db push failed!' -ForegroundColor Red
    docker compose -f $ComposeFile down
    exit $LASTEXITCODE
}
Pop-Location

Write-Host '=== Running E2E tests ===' -ForegroundColor Cyan
Push-Location (Join-Path $ProjectRoot 'apps/server')
pnpm test:e2e
$ExitCode = $LASTEXITCODE
Pop-Location

Write-Host '=== Stopping test infrastructure ===' -ForegroundColor Cyan
docker compose -f $ComposeFile down

if ($ExitCode -eq 0) {
    Write-Host '=== All E2E tests passed! ===' -ForegroundColor Green
} else {
    Write-Host "=== E2E tests failed with exit code $ExitCode ===" -ForegroundColor Red
}

exit $ExitCode
