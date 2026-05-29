# =============================================================================
# backup-daily.ps1 - 매일 자동 실행
# 목적: 소형 중요 테이블 전체 + 대형 2테이블은 스키마(DDL)만 보존
#       t_apt_rent / t_apt_trade 데이터는 국토부 API 재시딩 가능 -> 제외
# 보관: 최근 7일치 유지, 초과분 자동 삭제
# =============================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$BACKUP_ROOT  = "C:\git\Molit_Sql_Backup\daily"
$ENV_FILE     = "C:\git\2026_MOLIT_CONTEST\.env"
$CONTAINER    = "molit-mysql"
$DB_NAME      = "molit_contest"
$DB_USER      = "molit"
$KEEP_DAYS    = 7
$LARGE_TABLES = @("t_apt_rent", "t_apt_trade")

function Read-EnvValue([string]$Key) {
    $line = Get-Content $ENV_FILE | Where-Object { $_ -match "^\s*$Key\s*=" } | Select-Object -First 1
    if (-not $line) { throw ".env 에서 $Key 를 찾을 수 없습니다." }
    return ($line -split '=', 2)[1].Trim()
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$outFile   = Join-Path $BACKUP_ROOT "daily_$timestamp.sql.gz"
$tmpSql    = Join-Path $env:TEMP    "molit_daily_$timestamp.sql"

# 백업 디렉터리 없으면 자동 생성
if (-not (Test-Path $BACKUP_ROOT)) { New-Item -ItemType Directory -Path $BACKUP_ROOT -Force | Out-Null }

Write-Host "[$(Get-Date -Format 'HH:mm:ss')] === 일별 백업 시작 ===" -ForegroundColor Cyan

# Docker 실행 확인
$state = docker inspect --format "{{.State.Running}}" $CONTAINER 2>$null
if ($state -ne "true") { throw "컨테이너 '$CONTAINER' 가 실행 중이 아닙니다." }

$DB_PASS = Read-EnvValue "MYSQL_PASSWORD"

# --ignore-table 플래그 조립
$ignoreFlags = ($LARGE_TABLES | ForEach-Object { "--ignore-table=$DB_NAME.$_" }) -join " "

Write-Host "[$(Get-Date -Format 'HH:mm:ss')] 1단계: 소형 테이블 전체 덤프 중..." -ForegroundColor Yellow

# 1단계: 대형 2테이블 제외한 전체 데이터 덤프
# MYSQL_PWD 환경변수로 비밀번호 전달 (특수문자 안전, 파일 불필요)
# 2>/dev/null 로 MySQL 경고 메시지 억제 (exit code 는 그대로 반영)
$cmd1 = "mysqldump -u $DB_USER --single-transaction --routines --events $ignoreFlags $DB_NAME 2>/dev/null"
docker exec -e "MYSQL_PWD=$DB_PASS" $CONTAINER bash -c $cmd1 > $tmpSql

if ($LASTEXITCODE -ne 0) { throw "1단계 mysqldump 실패 (exit $LASTEXITCODE)" }

Write-Host "[$(Get-Date -Format 'HH:mm:ss')] 2단계: 대형 테이블 스키마(DDL)만 추가 중..." -ForegroundColor Yellow

# 2단계: 대형 2테이블 스키마(DDL)만 추가
$tableList = $LARGE_TABLES -join " "
$cmd2 = "mysqldump -u $DB_USER --no-data $DB_NAME $tableList 2>/dev/null"
docker exec -e "MYSQL_PWD=$DB_PASS" $CONTAINER bash -c $cmd2 >> $tmpSql

if ($LASTEXITCODE -ne 0) { throw "2단계 스키마 덤프 실패 (exit $LASTEXITCODE)" }

Write-Host "[$(Get-Date -Format 'HH:mm:ss')] 압축 중..." -ForegroundColor Yellow

# gzip 압축 (.NET GZipStream)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$inputStream  = [System.IO.File]::OpenRead($tmpSql)
$outputStream = [System.IO.File]::Create($outFile)
$gzip = New-Object System.IO.Compression.GZipStream($outputStream, [System.IO.Compression.CompressionLevel]::Optimal)
$inputStream.CopyTo($gzip)
$gzip.Dispose(); $outputStream.Dispose(); $inputStream.Dispose()
Remove-Item $tmpSql

$sizeMB = [math]::Round((Get-Item $outFile).Length / 1MB, 1)
Write-Host "[$(Get-Date -Format 'HH:mm:ss')] 저장 완료 -> $outFile ($sizeMB MB)" -ForegroundColor Green

# rotation: 7일 초과분 삭제
$old = Get-ChildItem "$BACKUP_ROOT\daily_*.sql.gz" |
       Sort-Object LastWriteTime -Descending |
       Select-Object -Skip $KEEP_DAYS
if ($old) {
    $old | Remove-Item
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] 오래된 백업 $($old.Count)개 삭제" -ForegroundColor Gray
}

Write-Host "[$(Get-Date -Format 'HH:mm:ss')] === 일별 백업 완료 ===" -ForegroundColor Cyan
