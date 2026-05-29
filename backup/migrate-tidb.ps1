# =============================================================================
# migrate-tidb.ps1 - 로컬 MySQL 덤프 -> TiDB Cloud 이관
# 사용법: .\migrate-tidb.ps1 -DumpFile "C:\경로\dump.sql"
#         (압축파일이면 먼저 압축 해제 후 .sql 파일 경로 지정)
# =============================================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$DumpFile
)

$TIDB_HOST = "gateway01.ap-northeast-1.prod.aws.tidbcloud.com"
$TIDB_PORT = 4000
$TIDB_USER = "3JxichyPsmfg97P.root"
$TIDB_DB   = "molit_contest"
$OUTPUT    = Join-Path (Split-Path $DumpFile) "dump_tidb_ready.sql"

# ── 입력 파일 확인 ────────────────────────────────────────────────────────────
if (-not (Test-Path $DumpFile)) {
    Write-Host "파일을 찾을 수 없습니다: $DumpFile" -ForegroundColor Red
    exit 1
}

$sizeMB = [math]::Round((Get-Item $DumpFile).Length / 1MB, 0)
Write-Host ""
Write-Host "=== TiDB 이관 전처리 시작 ===" -ForegroundColor Cyan
Write-Host "입력: $DumpFile ($sizeMB MB)"
Write-Host "출력: $OUTPUT"
Write-Host ""
Write-Host "전처리 중... (파일 크기에 따라 1~3분 소요)" -ForegroundColor Yellow

# ── StreamReader/Writer 로 라인별 처리 (메모리 효율) ──────────────────────────
$reader  = [System.IO.StreamReader]::new($DumpFile, [System.Text.Encoding]::UTF8)
$writer  = [System.IO.StreamWriter]::new($OUTPUT, $false, [System.Text.Encoding]::UTF8)
$lineNo  = 0
$skipped = 0

# TiDB 호환을 위한 헤더 추가
$writer.WriteLine("SET NAMES utf8mb4;")
$writer.WriteLine("SET FOREIGN_KEY_CHECKS = 0;")
$writer.WriteLine("")

while (-not $reader.EndOfStream) {
    $line = $reader.ReadLine()
    $lineNo++

    # ── 제거할 구문 (TiDB 비호환 또는 권한 부족) ─────────────────────────────
    if ($line -match '^\s*SET GLOBAL'              ) { $skipped++; continue }
    if ($line -match 'SQL_LOG_BIN'                 ) { $skipped++; continue }
    if ($line -match '^\s*SET @@SESSION\.GTID'     ) { $skipped++; continue }
    if ($line -match '^\s*-- GTID'                 ) { $skipped++; continue }

    # ── 인라인 치환 ──────────────────────────────────────────────────────────
    # ROW_FORMAT 제거 (TiDB 무시하지만 오류 방지)
    $line = $line -replace '\s*ROW_FORMAT=\w+', ''

    # DEFINER 제거 (뷰/트리거/프로시저 계정 불일치 방지)
    $line = $line -replace '/\*!50013 DEFINER=`[^`]+`@`[^`]+`\s*\*/', ''
    $line = $line -replace 'DEFINER\s*=\s*`[^`]+`@`[^`]+`\s*', ''

    # DATA DIRECTORY / INDEX DIRECTORY 제거
    $line = $line -replace "\s*(DATA|INDEX) DIRECTORY\s*=\s*'[^']*'", ''

    $writer.WriteLine($line)

    # 진행률 표시 (50만 줄마다)
    if ($lineNo % 500000 -eq 0) {
        Write-Host "  처리 중: $([math]::Round($lineNo/1000000,1))M 줄..." -ForegroundColor Gray
    }
}

$reader.Close()
$writer.Flush()
$writer.Close()

$outMB = [math]::Round((Get-Item $OUTPUT).Length / 1MB, 0)
Write-Host ""
Write-Host "전처리 완료: $outMB MB ($lineNo 줄, $skipped 줄 제거)" -ForegroundColor Green
Write-Host ""

# ── mysql 클라이언트 확인 ────────────────────────────────────────────────────
$mysqlPath = Get-Command mysql -ErrorAction SilentlyContinue
if (-not $mysqlPath) {
    Write-Host "[주의] mysql 클라이언트가 PATH에 없습니다." -ForegroundColor Yellow
    Write-Host "MySQL 설치 경로(예: C:\Program Files\MySQL\MySQL Server 8.0\bin)를 PATH에 추가하거나,"
    Write-Host "Docker 로컬 컨테이너를 경유해서 임포트할 수 있습니다."
    Write-Host ""
}

# ── 임포트 명령 출력 ────────────────────────────────────────────────────────
Write-Host "=== 임포트 명령 (복사 후 실행) ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "# 방법 1 — 로컬 mysql 클라이언트 (권장)" -ForegroundColor White
Write-Host "mysql -h $TIDB_HOST -P $TIDB_PORT -u $TIDB_USER -p --ssl-mode=REQUIRED $TIDB_DB < `"$OUTPUT`""
Write-Host ""
Write-Host "# 방법 2 — Docker 컨테이너 경유 (로컬 mysql 없을 때)" -ForegroundColor White
Write-Host "docker cp `"$OUTPUT`" molit-mysql:/tmp/dump_tidb_ready.sql"
Write-Host "docker exec -it molit-mysql mysql -h $TIDB_HOST -P $TIDB_PORT -u $TIDB_USER -p --ssl-mode=REQUIRED $TIDB_DB < /tmp/dump_tidb_ready.sql"
Write-Host ""
Write-Host "[팁] 임포트 중 오류가 나면 --force 옵션 추가 (비호환 구문 건너뛰기)" -ForegroundColor Gray
Write-Host "     mysql ... --force $TIDB_DB < `"$OUTPUT`""
