<#
.SYNOPSIS
Run RLS policy tests against local Supabase instance.

.DESCRIPTION
Starts Supabase local, applies migrations, runs RLS tests, and stops Supabase.

.PARAMETER SkipStart
Skip starting Supabase (assumes already running).

.PARAMETER SkipStop
Skip stopping Supabase after tests.

.EXAMPLE
.\scripts\test-rls.ps1

.EXAMPLE
.\scripts\test-rls.ps1 -SkipStart -SkipStop
#>
param(
    [switch]$SkipStart,
    [switch]$SkipStop
)

$ErrorActionPreference = "Stop"

Write-Host "🔐 RLS Policy Test Runner" -ForegroundColor Cyan
Write-Host "=============================="

# Check dependencies
if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Supabase CLI not found. Install with:" -ForegroundColor Red
    Write-Host "   wing install supabase-cli" -ForegroundColor Yellow
    exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "❌ npm not found. Install Node.js first." -ForegroundColor Red
    exit مجموعة 1
}

# Start Supabase local
if (-not $SkipStart) {
    Write-Host "Starting Supabase local..." -ForegroundColor Green
    supabase start
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to start Supabase" -ForegroundColor Red
        exit 1
    }
}

# Apply database schema
Write-Host "Applying database schema..." -ForegroundColor Green
supabase db push --db-url "$env:SUPABASE_DB_URL"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to apply schema" -ForegroundColor Red
    if (-not $SkipStop) { supabase stop }
    exit 1
}

# Run tests
Write-Host "Running RLS policy tests..." -ForegroundColor Green
npm run test:rls
$testExitCode = $LASTEXITCODE

# Stop Supabase local
if ((-not $SkipStop) -and (-not $SkipStart)) {
    Write-Host "Stopping Supabase local..." -ForegroundColor Green
    supabase stop
}

if ($testExitCode -eq 0) {
    Write-Host "✅ All tests passed!" -ForegroundColor Green
} else {
    Write-Host "❌ Tests failed with exit code $testExitCode" -ForegroundColor Red
    exit $testExitCode
}