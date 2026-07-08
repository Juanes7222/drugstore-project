<#
.SYNOPSIS
  Run the database seed script standalone (requires a running PostgreSQL).

.DESCRIPTION
  Assumes DATABASE_URL is set in apps/server/.env or as an environment variable.
  If not set, defaults to the dev database from docker-compose.dev.yml.

.EXAMPLE
  .\scripts\seed-db.ps1
  .\scripts\seed-db.ps1 -Reset  (drop all data first, then re-seed)
#>

param(
    [switch]$Reset
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

if (-not $env:DATABASE_URL) {
    $env:DATABASE_URL = 'postgresql://pharmacy_dev:pharmacy_dev@localhost:5432/pharmacy_dev_db'
    Write-Host "Using default DATABASE_URL: $env:DATABASE_URL" -ForegroundColor Gray
}

Push-Location (Join-Path $ProjectRoot 'apps/server')

if ($Reset) {
    Write-Host 'Resetting database (force push + re-seed)...' -ForegroundColor Yellow
    npx prisma db push --force-reset --schema ../../packages/database/prisma/schema/schema.prisma
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Reset failed!' -ForegroundColor Red
        Pop-Location
        exit 1
    }
}

Write-Host 'Seeding database...' -ForegroundColor Yellow
npx tsx prisma/seed.ts
$ExitCode = $LASTEXITCODE

Pop-Location

if ($ExitCode -eq 0) {
    Write-Host 'Seed completed successfully.' -ForegroundColor Green
} else {
    Write-Host 'Seed failed!' -ForegroundColor Red
}

exit $ExitCode
