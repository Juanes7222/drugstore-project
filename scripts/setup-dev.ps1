<#
.SYNOPSIS
  One-command full development environment launch.

.DESCRIPTION
  1. Starts PostgreSQL + Redis via Docker (docker-compose.dev.yml)
  2. Waits for services to be actually ready (direct connectivity checks)
  3. Regenerates Prisma client
  4. Pushes schema to the database (with auto‑healing & table existence verification)
  5. Seeds the database with test data (falls back to forced reset if needed)
  6. Shows login credentials

  Safe to run multiple times — the script preserves existing data whenever possible
  and only resets the database if tables are missing or a corruption is detected.

.PARAMETER SkipDocker
  Skip Docker infrastructure startup (use if already running).

.PARAMETER SkipInstall
  Skip dependency installation.

.PARAMETER SkipSeed
  Skip database seeding.

.PARAMETER Clean
  Tear down containers and volumes, then exit.

.EXAMPLE
  .\scripts\setup-dev.ps1
.EXAMPLE
  .\scripts\setup-dev.ps1 -SkipDocker
.EXAMPLE
  .\scripts\setup-dev.ps1 -Clean
#>

param(
    [switch]$SkipDocker,
    [switch]$SkipInstall,
    [switch]$SkipSeed,
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ComposeFile = Join-Path $ProjectRoot 'docker-compose.dev.yml'

# Database credentials (must match docker-compose.dev.yml)
$dbUser = 'pharmacy_dev'
$dbPass = 'pharmacy_dev'
$dbName = 'pharmacy_dev_db'
$dbHost = 'localhost'
$dbPort = 5432

$requiredCommands = @('docker', 'pnpm', 'node')
foreach ($cmd in $requiredCommands) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Host "Error: '$cmd' is not installed or not in PATH." -ForegroundColor Red
        exit 1
    }
}

if ($Clean) {
    Write-Host 'Tearing down containers and volumes...' -ForegroundColor Yellow
    docker compose -f $ComposeFile down -v
    Write-Host 'Environment cleaned.' -ForegroundColor Green
    exit 0
}

Write-Host '================================================' -ForegroundColor Cyan
Write-Host '  Pharmacy System — Development Setup' -ForegroundColor Cyan
Write-Host '================================================' -ForegroundColor Cyan
Write-Host ''

$script:step = 0
$totalSteps = 5
if ($SkipDocker) { $totalSteps-- }
if ($SkipInstall) { $totalSteps-- }
if ($SkipSeed) { $totalSteps-- }

function Step-Header {
    param([string]$Message)
    $script:step++
    Write-Host "[$script:step/$totalSteps] $Message" -ForegroundColor Yellow
}

function Wait-Service {
    param(
        [string]$ServiceName,
        [string[]]$CommandArgs,
        [string]$Description,
        [int]$MaxRetries = 15,
        [int]$RetryDelaySec = 2
    )

    Write-Host "    Waiting for $Description..." -ForegroundColor Gray
    for ($i = 0; $i -lt $MaxRetries; $i++) {
        docker compose -f $ComposeFile exec -T $ServiceName @CommandArgs *>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "    $Description is ready." -ForegroundColor Gray
            return
        }
        Start-Sleep -Seconds $RetryDelaySec
    }
    throw "$ServiceName did not become ready after $MaxRetries attempts."
}

Push-Location $ProjectRoot
try {
    # 1. Docker infrastructure (skip if -SkipDocker)
    if (-not $SkipDocker) {
        Step-Header 'Starting Docker infrastructure...'

        try {
            docker compose -f $ComposeFile up -d --remove-orphans
        } catch {
            Write-Host "Error starting Docker containers: $_" -ForegroundColor Red
            exit 1
        }

        # Direct readiness checks (does not rely on healthcheck state)
        Wait-Service -ServiceName 'postgres-dev' `
            -CommandArgs @('pg_isready', '-U', $dbUser, '-d', $dbName, '-h', 'localhost', '-p', $dbPort) `
            -Description 'PostgreSQL' `
            -MaxRetries 15 -RetryDelaySec 2

        Wait-Service -ServiceName 'redis-dev' `
            -CommandArgs @('redis-cli', 'ping') `
            -Description 'Redis' `
            -MaxRetries 10 -RetryDelaySec 1

        Write-Host '    Infrastructure ready.' -ForegroundColor Green
        Write-Host ''
    }

    # 2. Install dependencies (skip if -SkipInstall)
    if (-not $SkipInstall) {
        Step-Header 'Installing dependencies...'
        Push-Location $ProjectRoot
        try {
            Write-Host '    Checking pnpm lockfile...' -ForegroundColor Gray
            pnpm install --frozen-lockfile 2>&1
            if ($LASTEXITCODE -ne 0) {
                Write-Host '    Lockfile is outdated, updating dependencies...' -ForegroundColor Yellow
                pnpm install --no-frozen-lockfile
                if ($LASTEXITCODE -ne 0) {
                    throw 'Dependency installation failed even after lockfile update.'
                }
            }
            Write-Host '    Dependencies installed.' -ForegroundColor Green
        } catch {
            Write-Host "Dependency installation failed: $_" -ForegroundColor Red
            exit 1
        } finally {
            Pop-Location
        }
        Write-Host ''
    }

    # 3. Generate Prisma client
    Step-Header 'Generating Prisma client...'
    Push-Location (Join-Path $ProjectRoot 'packages/database')
    try {
        pnpm db:generate:full
        Write-Host '    Prisma client generated.' -ForegroundColor Green
    } catch {
        Write-Host "Prisma client generation failed: $_" -ForegroundColor Red
        exit 1
    } finally {
        Pop-Location
    }
    Write-Host ''

    # 4. Push schema and seed (with auto‑healing)
    Step-Header 'Setting up database...'
    Push-Location (Join-Path $ProjectRoot 'apps/server')
    try {
        $dbUrl = "postgresql://${dbUser}:${dbPass}@${dbHost}:${dbPort}/${dbName}"
        $schemaPath = '../../packages/database/prisma/schema'

        # Helper: run a SQL query via psql and return exit code
        function Test-DatabaseTable {
            param([string]$CheckQuery)
            docker compose -f $ComposeFile exec -T postgres-dev psql -U $dbUser -d $dbName -c $CheckQuery *>$null
            return $LASTEXITCODE
        }

        # Normal schema push (preserves existing data)
        Write-Host '    Pushing schema...' -ForegroundColor Gray
        npx prisma db push --schema $schemaPath --url $dbUrl --accept-data-loss
        if ($LASTEXITCODE -ne 0) {
            throw 'Schema push failed!'
        }
        Write-Host '    Schema pushed.' -ForegroundColor Green

        if (-not $SkipSeed) {
            $seedFile = Join-Path $ProjectRoot 'apps/server/seed/main.ts'
            if (-not (Test-Path $seedFile)) {
                throw "Seed file not found at $seedFile"
            }

            # Ensure DATABASE_URL is set (needed by seed)
            $env:DATABASE_URL = $dbUrl

            Write-Host '    Seeding database...' -ForegroundColor Gray
            npx tsx $seedFile
            $seedExitCode = $LASTEXITCODE

            if ($seedExitCode -ne 0) {
                Write-Host '    Seed failed. Checking if tables are missing...' -ForegroundColor Yellow
                # Quick check: does a known table exist? (adjust table name if necessary)
                $tableCheck = Test-DatabaseTable 'SELECT 1 FROM "Category" LIMIT 0'
                if ($tableCheck -ne 0) {
                    # Table missing -> force reset
                    Write-Host '    Tables missing. Resetting database...' -ForegroundColor Yellow
                    npx prisma db push --force-reset --schema $schemaPath --url $dbUrl --accept-data-loss
                    if ($LASTEXITCODE -ne 0) {
                        throw 'Force reset of schema failed!'
                    }

                    # Double-check after reset
                    Write-Host '    Verifying table creation...' -ForegroundColor Gray
                    $verify = Test-DatabaseTable 'SELECT 1 FROM "Category" LIMIT 0'
                    if ($verify -ne 0) {
                        Write-Host '    Table still missing! Trying SQL initialization via Prisma...' -ForegroundColor Yellow
                        # Use prisma db execute as a last resort (requires a SQL file)
                        $initSql = Join-Path $ProjectRoot 'scripts/init-db.sql'
                        if (Test-Path $initSql) {
                            npx prisma db execute --schema $schemaPath --url $dbUrl --file $initSql
                            if ($LASTEXITCODE -ne 0) {
                                throw 'Failed to initialize database with custom SQL.'
                            }
                        } else {
                            throw 'Table creation failed and no fallback SQL file found. Please check your schema.'
                        }
                    }

                    Write-Host '    Retrying seed...' -ForegroundColor Gray
                    $env:DATABASE_URL = $dbUrl
                    npx tsx $seedFile
                    if ($LASTEXITCODE -ne 0) {
                        throw 'Seed failed even after schema reset and verification.'
                    }
                } else {
                    # Tables exist but seed still fails -> another issue
                    throw 'Tables exist but seed failed. Check seed data or schema mapping.'
                }
            }
            Write-Host '    Database seeded.' -ForegroundColor Green
        }
    } catch {
        Write-Host "Error: $_" -ForegroundColor Red
        exit 1
    } finally {
        Pop-Location  # back to project root
    }
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
    Write-Host "  PostgreSQL: ${dbHost}:${dbPort} (${dbUser} / ${dbPass} / ${dbName})" -ForegroundColor White
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
    Write-Host '  Troubleshooting:' -ForegroundColor DarkYellow
    Write-Host '    - If Prisma push fails, check that PostgreSQL container is healthy.' -ForegroundColor Gray
    Write-Host '    - Run "docker compose logs postgres-dev" to see database logs.' -ForegroundColor Gray
    Write-Host '    - To manually connect to DB: psql -h localhost -U pharmacy_dev -d pharmacy_dev_db' -ForegroundColor Gray
    Write-Host ''

} finally {
    Pop-Location
}