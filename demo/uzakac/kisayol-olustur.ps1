# ELEKTRIK uzak baglanti — masaustu kisayolu (ozel ikon + onbellek yenileme).
$Klasor = (Resolve-Path $PSScriptRoot).Path
$Png = Join-Path $Klasor 'elektrik-uzak.png'
$Ico = Join-Path $Klasor 'elektrik-uzak.ico'
$Vbs = Join-Path $Klasor 'uzak-ac.vbs'
$LnkYerel = Join-Path $Klasor 'ELEKTRIK.lnk'
$Wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$IkonScript = Join-Path $Klasor 'ikon-olustur.ps1'

if (-not (Test-Path $Vbs)) {
  Write-Error "uzak-ac.vbs bulunamadi: $Klasor"
  exit 1
}

if (Test-Path $IkonScript) {
  & $IkonScript -Klasor $Klasor -Zorla
}

if (-not (Test-Path $Ico)) {
  Write-Error "elektrik-uzak.ico olusturulamadi: $Ico"
  exit 1
}

$IcoTam = (Resolve-Path $Ico).Path

function Remove-ShortcutIfExists([string]$path) {
  if (Test-Path $path) {
    Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
  }
}

function New-ElektrikShortcut([string]$path) {
  Remove-ShortcutIfExists $path
  $sh = New-Object -ComObject WScript.Shell
  $sc = $sh.CreateShortcut($path)
  $sc.TargetPath = $Wscript
  $sc.Arguments = "//nologo `"$Vbs`""
  $sc.WorkingDirectory = $Klasor
  $sc.IconLocation = "$IcoTam,0"
  $sc.Description = 'ELEKTRIK — uzak sunucu'
  $sc.WindowStyle = 7
  $sc.Save()
}

function Refresh-DesktopIcons {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ShellNotify {
  [DllImport("shell32.dll")]
  public static extern void SHChangeNotify(int eventId, int flags, IntPtr item1, IntPtr item2);
}
"@
  [ShellNotify]::SHChangeNotify(0x08000000, 0x00001000, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
  $ie4 = Join-Path $env:SystemRoot 'System32\ie4uinit.exe'
  if (Test-Path $ie4) {
    Start-Process -FilePath $ie4 -ArgumentList '-show' -WindowStyle Hidden -ErrorAction SilentlyContinue
  }
}

New-ElektrikShortcut $LnkYerel

$desktop = [Environment]::GetFolderPath('Desktop')
if ($desktop) {
  $masaustu = Join-Path $desktop 'ELEKTRIK.lnk'
  New-ElektrikShortcut $masaustu
  Write-Host "OK: Masaustu -> $masaustu"
}

Start-Sleep -Milliseconds 400
Refresh-DesktopIcons

Write-Host "OK: $LnkYerel"
Write-Host "Simge: $IcoTam"
Write-Host "Klasor: $Klasor"
Write-Host ""
Write-Host "Masaustu simgesi degismediyse:"
Write-Host "  1) Eski ELEKTRIK kisayolunu silin"
Write-Host "  2) Bu scripti tekrar calistirin"
Write-Host "  3) Hala eskiyse bilgisayari yeniden baslatin"
