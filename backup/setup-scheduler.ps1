# =============================================================================
# setup-scheduler.ps1 - Windows 작업 스케줄러 등록
# 관리자 권한 PowerShell 에서 실행하세요.
#
# 등록 태스크:
#   MolitBackup-Daily  : 매일 새벽 02:00
#   MolitBackup-Weekly : 매주 일요일 새벽 03:00
# =============================================================================

# 관리자 권한 체크
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $isAdmin) {
    Write-Host "관리자 권한으로 실행해주세요." -ForegroundColor Red
    exit 1
}

$BACKUP_DIR    = "C:\git\2026_MOLIT_CONTEST\backup"
$DAILY_SCRIPT  = Join-Path $BACKUP_DIR "backup-daily.ps1"
$WEEKLY_SCRIPT = Join-Path $BACKUP_DIR "backup-weekly.ps1"
$PS_EXE        = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$TASK_PATH     = "\Molit\"

function New-BackupTask {
    param(
        [string]$Name,
        [string]$Script,
        [CimInstance]$Trigger,
        [string]$Desc
    )

    $existing = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $Name -Confirm:$false
        Write-Host "  기존 태스크 제거: $Name" -ForegroundColor Gray
    }

    $arg      = '-NonInteractive -NoProfile -ExecutionPolicy Bypass -File "' + $Script + '"'
    $action   = New-ScheduledTaskAction -Execute $PS_EXE -Argument $arg
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)
    $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $principal= New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Highest

    Register-ScheduledTask `
        -TaskName    $Name `
        -TaskPath    $TASK_PATH `
        -Action      $action `
        -Trigger     $Trigger `
        -Settings    $settings `
        -Principal   $principal `
        -Description $Desc `
        -Force | Out-Null

    Write-Host "  등록 완료: $Name" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Molit DB 백업 스케줄러 등록 ===" -ForegroundColor Cyan
Write-Host ""

# 일별 - 매일 02:00
Write-Host "[1/2] 일별 백업 태스크 (매일 02:00)..."
$dailyTrigger = New-ScheduledTaskTrigger -Daily -At "02:00"
New-BackupTask -Name "MolitBackup-Daily" -Script $DAILY_SCRIPT -Trigger $dailyTrigger `
    -Desc "Molit DB 일별 백업 (소형 테이블 전체, 대형 테이블 스키마만)"

# 주별 - 매주 일요일 03:00
Write-Host "[2/2] 주별 백업 태스크 (매주 일요일 03:00)..."
$weeklyTrigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Sunday -At "03:00"
New-BackupTask -Name "MolitBackup-Weekly" -Script $WEEKLY_SCRIPT -Trigger $weeklyTrigger `
    -Desc "Molit DB 주별 풀 백업 (t_apt_rent + t_apt_trade 포함)"

Write-Host ""
Write-Host "등록된 태스크:" -ForegroundColor Cyan
Get-ScheduledTask -TaskPath $TASK_PATH | Format-Table TaskName, State -AutoSize

Write-Host "수동 테스트:" -ForegroundColor Yellow
Write-Host '  Start-ScheduledTask -TaskPath "\Molit\" -TaskName "MolitBackup-Daily"'
Write-Host '  Start-ScheduledTask -TaskPath "\Molit\" -TaskName "MolitBackup-Weekly"'
Write-Host ""
Write-Host "태스크 제거:" -ForegroundColor Yellow
Write-Host '  Unregister-ScheduledTask -TaskPath "\Molit\" -TaskName "MolitBackup-Daily" -Confirm:$false'
Write-Host '  Unregister-ScheduledTask -TaskPath "\Molit\" -TaskName "MolitBackup-Weekly" -Confirm:$false'
