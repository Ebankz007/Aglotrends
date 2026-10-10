# Provision the Aglotrends databases (run once, as the postgres superuser)
#
# The dev role `copinex` has no CREATEDB, so a superuser must create the
# databases. Either run these two lines, OR grant CREATEDB once and let the
# project create its own DBs thereafter:
#
#   ALTER ROLE copinex CREATEDB;
#
# Usage:
#   $env:PGPASSWORD = "<postgres superuser password>"
#   .\infrastructure\provision-db.ps1

param(
  [string]$PgUser = "postgres",
  [string]$PgHost = "localhost",
  [int]$PgPort = 5433
)

$ErrorActionPreference = "Stop"
$psql = "C:\Program Files\PostgreSQL\16\bin\psql.exe"

if (-not (Test-Path $psql)) { throw "psql not found at $psql" }
if (-not $env:PGPASSWORD) { throw "Set `$env:PGPASSWORD to the postgres superuser password first." }

foreach ($db in @("aglotrends", "aglotrends_test")) {
  $exists = & $psql -U $PgUser -h $PgHost -p $PgPort -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$db';"
  if ($exists -eq "1") {
    Write-Host "  $db already exists"
  } else {
    & $psql -U $PgUser -h $PgHost -p $PgPort -d postgres -c "CREATE DATABASE $db OWNER copinex;"
    Write-Host "  created $db (owner copinex)"
  }
}
Write-Host "Done."
