param(
  [string]$EnvPath = "",
  [string]$Url = "http://127.0.0.1:3010/"
)

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
$area = [Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$w = [Math]::Min($maxW, [Math]::Max($minW, $area.Width - 24))
$h = [Math]::Min($maxH, [Math]::Max($minH, $area.Height - 48))

$profileDir = Join-Path $env:LOCALAPPDATA "Elektrik Otomasyon\app-pencere"
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

$browser = $null
$candidates = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
)
foreach ($c in $candidates) {
  if (Test-Path $c) { $browser = $c; break }
}
if (-not $browser) {
  Start-Process $Url
  exit 0
}

$args = @(
  "--user-data-dir=$profileDir",
  "--window-size=$w,$h",
  "--app=$Url",
  "--disable-features=TranslateUI",
  "--no-first-run",
  "--no-default-browser-check"
)

Start-Process -FilePath $browser -ArgumentList $args | Out-Null

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinResize {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr ins, int X, int Y, int cx, int cy, uint flags);
  public const uint SWP_SHOWWINDOW = 0x0040;
}
"@

function Set-AppWindowSize([int]$width, [int]$height) {
  $target = [IntPtr]::Zero
  $cb = [WinResize+EnumProc]{
    param($hwnd, $lp)
    if (-not [WinResize]::IsWindowVisible($hwnd)) { return $true }
    $sb = New-Object System.Text.StringBuilder 512
    [void][WinResize]::GetWindowText($hwnd, $sb, 512)
    $t = $sb.ToString()
    if ($t -match 'ELEKTRIK|127\.0\.0\.1:3010') {
      $script:target = $hwnd
      return $false
    }
    return $true
  }
  [void][WinResize]::EnumWindows($cb, [IntPtr]::Zero)
  if ($target -eq [IntPtr]::Zero) { return $false }
  $x = [Math]::Max(0, [int](($area.Width - $width) / 2))
  $y = [Math]::Max(0, [int](($area.Height - $height) / 2))
  [void][WinResize]::SetWindowPos($target, [IntPtr]::Zero, $x, $y, $width, $height, [WinResize]::SWP_SHOWWINDOW)
  return $true
}

1..12 | ForEach-Object {
  Start-Sleep -Milliseconds 400
  if (Set-AppWindowSize -width $w -height $h) { break }
}

Write-Host "Pencere: ${w}x${h}"
