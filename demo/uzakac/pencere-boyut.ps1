param([string]$EnvPath = "")
$maxW = 1720
$maxH = 980
$minW = 1024
$minH = 700

if ($EnvPath -and (Test-Path $EnvPath)) {
  Get-Content $EnvPath | ForEach-Object {
    if ($_ -match '^\s*APP_WINDOW_WIDTH\s*=\s*(\d+)') { $maxW = [int]$Matches[1] }
    if ($_ -match '^\s*APP_WINDOW_HEIGHT\s*=\s*(\d+)') { $maxH = [int]$Matches[1] }
  }
}

Add-Type -AssemblyName System.Windows.Forms
$a = [Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$w = [Math]::Min($maxW, [Math]::Max($minW, $a.Width - 24))
$h = [Math]::Min($maxH, [Math]::Max($minH, $a.Height - 48))
Write-Output "$w,$h"
