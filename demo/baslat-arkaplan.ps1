# Sunucu + masaustu uygulama penceresi (tarayici sekmesi degil); kapaninca sunucu durur.
$ErrorActionPreference = 'Continue'
$Demo = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$Exe = Join-Path $Demo 'Elektrik-Otomasyon.exe'
$EnvOrnek = Join-Path $Demo '.env.ornek'
$EnvLocal = Join-Path $Demo '.env'
$Url = 'http://127.0.0.1:3010/'
$Log = Join-Path $Demo 'son-calistirma.log'

function Write-Log([string]$msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  try { Add-Content -Path $Log -Value $line -Encoding UTF8 } catch { }
}

function Show-Hata([string]$msg) {
  Write-Log "HATA: $msg"
  $kisa = if ($msg.Length -gt 900) { $msg.Substring(0, 900) + '...' } else { $msg }
  try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
    [void][System.Windows.Forms.MessageBox]::Show($kisa, 'Elektrik Otomasyon', 'OK', 'Warning')
  } catch {
    cmd.exe /c "msg %username% /time:25 `"$($kisa -replace '"','''')`"" 2>$null
  }
}

function Ensure-EnvUygulamaModu([string]$envPath) {
  $lines = @(Get-Content $envPath -ErrorAction SilentlyContinue)
  $keys = @{ OPEN_APP = '1'; OPEN_BROWSER = '1' }
  foreach ($k in $keys.Keys) {
    $hit = $false
    for ($i = 0; $i -lt $lines.Count; $i++) {
      if ($lines[$i] -match "^\s*$k\s*=") {
        $lines[$i] = "$k=$($keys[$k])"
        $hit = $true
        break
      }
    }
    if (-not $hit) { $lines += "$k=$($keys[$k])" }
  }
  Set-Content -Path $envPath -Value $lines -Encoding UTF8
}

function Stop-Elektrik {
  foreach ($n in @('Elektrik-Otomasyon', 'elektrik-otomasyon', 'electron')) {
    Get-Process -Name $n -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  }
  try {
    Get-NetTCPConnection -LocalPort 3010 -State Listen -ErrorAction SilentlyContinue |
      ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  } catch {
    netstat -ano 2>$null | Select-String ':3010\s+.*LISTENING' | ForEach-Object {
      if ($_ -match '\s+(\d+)\s*$') { taskkill /F /PID $Matches[1] 2>$null | Out-Null }
    }
  }
}

function Test-ServerReady {
  try {
    $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 4
    return $r.StatusCode -ge 200
  } catch { }
  try {
    $wc = New-Object System.Net.WebClient
    $wc.DownloadString($Url) | Out-Null
    return $true
  } catch { return $false }
}

function Test-AppRunning {
  try {
    $q = Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" -ErrorAction Stop
    foreach ($x in $q) {
      if ($x.CommandLine -match '--app=.*3010|127\.0\.0\.1:3010') { return $true }
    }
  } catch { }
  foreach ($n in @('msedge', 'chrome')) {
    foreach ($p in (Get-Process -Name $n -ErrorAction SilentlyContinue)) {
      if ($p.MainWindowHandle -ne [IntPtr]::Zero) {
        $t = $p.MainWindowTitle
        if ($t -match 'Elektrik') { return $true }
      }
    }
  }
  return $false
}

function Open-UygulamaPenceresi {
  Write-Log 'Masaustu uygulama penceresi aciliyor (app modu)...'
  $pencerePs1 = Join-Path $Demo 'pencere-ac.ps1'
  if (-not (Test-Path $pencerePs1)) {
    Write-Log 'HATA: pencere-ac.ps1 eksik'
    return $false
  }
  try {
    & $pencerePs1 -EnvPath $EnvLocal -Url $Url
    Start-Sleep -Seconds 3
    return (Test-AppRunning)
  } catch {
    Write-Log ("pencere-ac: " + $_.Exception.Message)
    return $false
  }
}

function Start-Sunucu {
  # Konsol penceresi yok (sunucu-gizli.vbs, WScript style 0)
  $vbs = Join-Path $Demo 'sunucu-gizli.vbs'
  if (Test-Path $vbs) {
    Start-Process -FilePath 'wscript.exe' -ArgumentList "//nologo `"$vbs`"" -WindowStyle Hidden | Out-Null
    return
  }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $Exe
  $psi.WorkingDirectory = $Demo
  $psi.CreateNoWindow = $true
  $psi.UseShellExecute = $false
  $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  $env:OPEN_BROWSER = '0'
  $env:OPEN_APP = '1'
  [void][System.Diagnostics.Process]::Start($psi)
}

try {
  Write-Log '=== BASLAT ==='

  if (-not (Test-Path $Exe)) {
    Show-Hata "Elektrik-Otomasyon.exe bulunamadi.`n`nKlasor: $Demo"
    exit 1
  }
  if (-not (Test-Path (Join-Path $Demo 'public\index.html'))) {
    Show-Hata 'public\index.html eksik.'
    exit 1
  }
  if (-not (Test-Path (Join-Path $Demo 'pencere-ac.ps1'))) {
    Show-Hata 'pencere-ac.ps1 eksik — demo klasoru tam degil.'
    exit 1
  }

  if (-not (Test-Path $EnvLocal)) {
    if (Test-Path $EnvOrnek) { Copy-Item $EnvOrnek $EnvLocal -Force }
  }
  if (-not (Test-Path $EnvLocal)) {
    Show-Hata '.env yok. .env.ornek dosyasini .env yapip SQL bilgilerini yazin.'
    exit 1
  }

  Ensure-EnvUygulamaModu $EnvLocal

  $envDst = Join-Path $env:LOCALAPPDATA 'Elektrik Otomasyon'
  New-Item -ItemType Directory -Force -Path $envDst | Out-Null
  Copy-Item $EnvLocal (Join-Path $envDst '.env') -Force

  Stop-Elektrik
  Start-Sleep -Milliseconds 600
  Start-Sunucu
  Write-Log 'Sunucu bekleniyor...'

  $ready = $false
  for ($i = 1; $i -le 180; $i++) {
    if (Test-ServerReady) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) {
    Stop-Elektrik
    Show-Hata "Sunucu acilmadi. SQL ve .env kontrol edin.`nLog: $Log"
    exit 1
  }
  Write-Log 'Sunucu hazir.'

  $opened = Open-UygulamaPenceresi
  if (-not $opened) { Start-Sleep -Seconds 2; $opened = Open-UygulamaPenceresi }

  if (-not $opened) {
    Write-Log 'UYARI: Uygulama penceresi acilamadi.'
    Show-Hata @"
Pencere acilamadi.

Edge veya Chrome kurulu olmali.
BASLAT-DENETLE.bat calistirin.
Log: $Log
"@
    exit 0
  }

  Write-Log 'Uygulama acildi, kapanis izleniyor...'
  $kapaliSay = 0
  while ($true) {
    if (Test-AppRunning) { $kapaliSay = 0 }
    else {
      $kapaliSay++
      if ($kapaliSay -ge 5) { break }
    }
    Start-Sleep -Milliseconds 1000
  }

  Write-Log 'Uygulama kapandi, sunucu durduruluyor.'
  Stop-Elektrik
  Write-Log '=== BITTI ==='
} catch {
  Stop-Elektrik
  Show-Hata ("Baslatma hatasi: " + ($_.Exception.Message))
  exit 1
}
