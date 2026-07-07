# Bu klasorde BASLAT.lnk + istege bagli masaustu kisayolu (dogru yol).
$Demo = (Resolve-Path $PSScriptRoot).Path
$Ico = Join-Path $Demo 'elektrik-baslat.ico'
$Lnk = Join-Path $Demo 'BASLAT.lnk'
$Vbs = Join-Path $Demo 'baslat.vbs'
$Wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'

if (-not (Test-Path $Vbs)) {
  Write-Error "baslat.vbs bulunamadi: $Demo"
  exit 1
}

# ICO yoksa PNG'den uret
if (-not (Test-Path $Ico)) {
  $Png = @(
    (Join-Path $Demo 'elektrik-baslat.png'),
    (Join-Path $Demo '..\assets\elektrik-baslat-icon.png')
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($Png) {
    Add-Type -AssemblyName System.Drawing
    $src = [System.Drawing.Image]::FromFile($Png)
    $bmp = New-Object System.Drawing.Bitmap 256, 256
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($src, 0, 0, 256, 256)
    $g.Dispose(); $src.Dispose()
    $fs = [System.IO.File]::Create($Ico)
    ([System.Drawing.Icon]::FromHandle($bmp.GetHicon())).Save($fs)
    $fs.Close(); $bmp.Dispose()
  }
}

function New-BaslatShortcut([string]$path) {
  $sh = New-Object -ComObject WScript.Shell
  $sc = $sh.CreateShortcut($path)
  $sc.TargetPath = $Wscript
  $sc.Arguments = "//nologo `"$Vbs`""
  $sc.WorkingDirectory = $Demo
  if (Test-Path $Ico) { $sc.IconLocation = "$Ico,0" }
  $sc.Description = 'Elektrik Otomasyon'
  $sc.WindowStyle = 7
  $sc.Save()
}

New-BaslatShortcut $Lnk

$desktop = [Environment]::GetFolderPath('Desktop')
if ($desktop) {
  New-BaslatShortcut (Join-Path $desktop 'Elektrik Otomasyon.lnk')
  Write-Host "OK: Masaustu -> Elektrik Otomasyon.lnk"
}

Write-Host "OK: $Lnk"
Write-Host "Klasor: $Demo"
