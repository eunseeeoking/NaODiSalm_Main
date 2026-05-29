# =============================================================================
# backup-weekly.ps1 - 매주 자동 실행 (일요일 새벽 03:00)
# 목적: t_apt_rent / t_apt_trade 포함 전체 풀 덤프
# 보관: 최근 4주치 유지, 초과분 자동 삭제
# =============================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$BACKUP_ROOT = "C:\git\Molit_Sql_Backup\weekly"
$ENV_FILE    = "C:\git\2026_MOLIT_CONTEST\.env"
$CONTAINER   = "molit-mysql"
$DB_NAME     = "molit_contest"
$DB_USER     = "molit"
$KEEP_WEEKS  = 4

function Read-EnvValue([string]$Key) {
    $line = Get-Content $ENV_FILE | Where-Object { $_ -match "^\s*$Key\s*=" } | Select-Object -First 1
    if (-not $line) { throw ".env 에서 $Key 를 찾을 수 없습니다." }
    return ($line -split '=', 2)[1].Trim()
}

$timestamp = Get-Date -Format "yyyyMMdd"
$outFile   = Join-Path $BACKUP_ROOT "weekly_$timestamp.sql.gz"
$tmpSql    = Join-Path $env:TEMP    "molit_weekly_$timestamp.sql"

# 백업 디렉터리 없으면 자동 생성
if (-not (Test-Path $BACKUP_ROOT)) { New-Item -ItemType Directory -Path $BACKUP_ROOT -Force | Out-Null }

Write-Host "[$(Get-Date -Format 'HH:mm:ss')] === 주별 풀 백업 시작 ===" -ForegroundColor Cyan

$state = docker inspect --format "{{.State.Running}}" $CONTAINER 2>$null
if ($state -ne "true") { throw "컨테이너 '$CONTAINER' 가 실행 중이 아닙니다." }

$DB_PASS = Read-EnvValue "MYSQL_PASSWORD"

Write-Host "[$(Get-Date -Format 'HH:mm:ss')] 전체 덤프 실행 중 (t_apt_rent + t_apt_trade 포함)..." -ForegroundColor Yellow

$cmd = "mysqldump -u $DB_USER --single-transaction --routines --events $DB_NAME 2>/dev/null"
docker exec -e "MYSQL_PWD=$DB_PASS" $CONTAINER bash -c $cmd > $tmpSql

if ($LASTEXITCODE -ne 0) { throw "mysqldump 실패 (exit $LASTEXITCODE)" }

$rawMB = [math]::Round((Get-Item $tmpSql).Length / 1MB, 0)
Write-Host "[$(Get-Date -Format 'HH:mm:ss')] 압축 전: $rawMB MB — 압축 중..." -ForegroundColor Yellow

Add-Type -AssemblyName System.IO.Compression.FileSystem
$inputStream  = [System.IO.File]::OpenRead($tmpSql)
$outputStream = [System.IO.File]::Create($outFile)
$gzip = New-Object System.IO.Compression.GZipStream($outputStream, [System.IO.Compression.CompressionLevel]::Optimal)
$inputStream.CopyTo($gzip)
$gzip.Dispose(); $outputStream.Dispose(); $inputStream.Dispose()
Remove-Item $tmpSql

$sizeMB = [math]::Round((Get-Item $outFile).Length / 1MB, 1)
Write-Host "[$(Get-Date -Format 'HH:mm:ss')] 저장 완료 -> $outFile ($sizeMB MB)" -ForegroundColor Green

$old = Get-ChildItem "$BACKUP_ROOT\weekly_*.sql.gz" |
       Sort-Object LastWriteTime -Descending |
       Select-Object -Skip $KEEP_WEEKS
if ($old) {
    $old | Remove-Item
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] 오래된 백업 $($old.Count)개 삭제" -ForegroundColor Gray
}

Write-Host "[$(Get-Date -Format 'HH:mm:ss')] === 주별 풀 백업 완료 ===" -ForegroundColor Cyan
