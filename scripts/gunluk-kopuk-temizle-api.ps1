param(
  [int]$Port = 0,
  [switch]$DryRun,
  [switch]$Uygula,
  [string]$Bas = '',
  [string]$Bit = '',
  [string]$KullaniciAdi = '',
  [string]$Sifre = '',
  [string]$MusteriFiltre = ''
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $Root '.env'

function Read-PortFromEnv {
  param([int]$Default = 3010)
  if (-not (Test-Path $envFile)) { return $Default }
  foreach ($line in Get-Content -LiteralPath $envFile -Encoding UTF8) {
    $t = $line.Trim()
    if ($t -match '^\s*PORT\s*=\s*(\d+)') { return [int]$Matches[1] }
  }
  return $Default
}

function Test-MusteriFiltreEsles {
  param([string]$Metin, [string]$Filtre)
  if (-not $Filtre) { return $true }
  $a = ($Metin + '').ToLower()
  $f = ($Filtre + '').ToLower().Trim()
  if (-not $f) { return $true }
  if ($a.Contains($f)) { return $true }
  foreach ($w in ($f -split '\s+')) {
    if ($w.Length -ge 2 -and -not $a.Contains($w)) { return $false }
  }
  return $true
}

function Invoke-LocalJsonPost {
  param([string]$Url, [string]$Json)
  if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
    $tmp = [System.IO.Path]::GetTempFileName()
    try {
      [System.IO.File]::WriteAllText($tmp, $Json, (New-Object System.Text.UTF8Encoding $false))
      $raw = & curl.exe -sS -X POST $Url -H 'Content-Type: application/json; charset=utf-8' --data-binary "@$tmp" -w "`nHTTP_CODE:%{http_code}" 2>&1
      if ($LASTEXITCODE -ne 0) { throw ($raw -join "`n") }
      $text = ($raw | Where-Object { $_ -notmatch '^HTTP_CODE:' }) -join "`n"
      $codeLine = ($raw | Where-Object { $_ -match '^HTTP_CODE:' }) -replace '^HTTP_CODE:', ''
      $code = if ($codeLine) { [int]$codeLine } else { 0 }
      if ($code -ge 400) {
        $errMsg = $text
        try {
          $ej = $text | ConvertFrom-Json
          if ($ej.message) { $errMsg = $ej.message }
        } catch {}
        throw $errMsg
      }
      return ($text | ConvertFrom-Json)
    } finally {
      Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    }
  }

  $prevProxy = [System.Net.WebRequest]::DefaultWebProxy
  try {
    [System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy
    return Invoke-RestMethod -Uri $Url -Method Post -Body $Json -ContentType 'application/json; charset=utf-8' -UseBasicParsing
  } finally {
    [System.Net.WebRequest]::DefaultWebProxy = $prevProxy
  }
}

function New-KopukBody {
  param(
    [bool]$IsDryRun,
    [bool]$IsUygula,
    [string]$User,
    [string]$Pass,
    [string]$BasT,
    [string]$BitT,
    [string]$Filtre
  )
  $bodyObj = @{
    kullaniciAdi = $User
    sifre        = $Pass
    dryRun       = [bool]$IsDryRun
    uygula       = [bool]$IsUygula
  }
  if ($BasT) { $bodyObj.bas = $BasT }
  if ($BitT) { $bodyObj.bit = $BitT } elseif ($BasT) { $bodyObj.bit = $BasT }
  if ($Filtre) { $bodyObj.musteriFiltre = $Filtre.Trim() }
  return ($bodyObj | ConvertTo-Json -Compress)
}

function Test-SunucuFiltreDestegi {
  param(
    [string]$Url,
    [string]$User,
    [string]$Pass,
    [string]$BasT,
    [string]$BitT,
    [string]$Filtre
  )
  $json = New-KopukBody -IsDryRun $true -IsUygula $false -User $User -Pass $Pass -BasT $BasT -BitT $BitT -Filtre $Filtre
  $resp = Invoke-LocalJsonPost -Url $Url -Json $json
  return [bool]$resp.musteriFiltre
}

function Apply-MusteriFiltreYerel {
  param($Resp, [string]$Filtre)
  if (-not $Filtre -or -not $Resp.kayitlar) { return $Resp }
  $filtered = @($Resp.kayitlar | Where-Object { Test-MusteriFiltreEsles $_ $Filtre })
  $Resp.kayitlar = $filtered
  $Resp.adet = $filtered.Count
  if ($Resp.dryRun -ne $false -and -not $Resp.uygula) {
    $Resp.message = "`"$Filtre`" icin $($filtered.Count) kopuk kayit bulundu."
  }
  return $Resp
}

if ($Port -le 0) { $Port = Read-PortFromEnv }

if (-not $MusteriFiltre -and $env:ELEKTRIK_MUSTERI_FILTRE) {
  $MusteriFiltre = $env:ELEKTRIK_MUSTERI_FILTRE.Trim()
}

$base = "http://127.0.0.1:$Port"
$url = "$base/api/bakim/gunluk-kopuk-temizle"

Write-Host "Sunucu: $url"

try {
  if (-not (Test-NetConnection -ComputerName 127.0.0.1 -Port $Port -WarningAction SilentlyContinue).TcpTestSucceeded) {
    throw "Port $Port kapali"
  }
} catch {
  Write-Host ''
  Write-Host "HATA: $base yanit vermiyor."
  Write-Host '  1) BASLAT.bat ile sunucuyu acin'
  Write-Host '  2) .env icindeki PORT degerini kontrol edin'
  exit 1
}

if (-not $KullaniciAdi) { $KullaniciAdi = Read-Host 'Kullanici adi' }
if (-not $Sifre) {
  $sec = Read-Host 'Sifre' -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { $Sifre = [Runtime.InteropServices.Marshal]::PtrToStringAuto($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

if (-not $MusteriFiltre -and $DryRun) {
  $gir = Read-Host 'Musteri filtresi (Murat = sadece Murat, Enter = tumu)'
  if ($gir) { $MusteriFiltre = $gir.Trim() }
}

if ($MusteriFiltre) {
  Write-Host "Musteri filtresi: $MusteriFiltre"
}

if ($Uygula -and $MusteriFiltre) {
  $destek = Test-SunucuFiltreDestegi -Url $url -User $KullaniciAdi -Pass $Sifre -BasT $Bas -BitT $Bit -Filtre $MusteriFiltre
  if (-not $destek) {
    Write-Host ''
    Write-Host 'HATA: Sunucu EXE eski — filtreli silme yapilamaz.' -ForegroundColor Red
    Write-Host '  dist\sunucu-paket klasorunu sunucuya kopyalayin, BASLAT.bat yeniden acin.'
    Write-Host '  Gerekli surum: v1.0.69+'
    exit 1
  }
}

$json = New-KopukBody -IsDryRun ([bool]$DryRun) -IsUygula ([bool]$Uygula) -User $KullaniciAdi -Pass $Sifre -BasT $Bas -BitT $Bit -Filtre $MusteriFiltre

try {
  $resp = Invoke-LocalJsonPost -Url $url -Json $json
} catch {
  $msg = $_.Exception.Message
  if ($_.ErrorDetails.Message) {
    try {
      $err = $_.ErrorDetails.Message | ConvertFrom-Json
      if ($err.message) { $msg = $err.message }
    } catch { $msg = $_.ErrorDetails.Message }
  }
  Write-Host ''
  Write-Host "HATA: $msg"
  exit 1
}

if ($MusteriFiltre -and $DryRun) {
  $resp = Apply-MusteriFiltreYerel -Resp $resp -Filtre $MusteriFiltre
}

Write-Host ''
Write-Host $resp.message
if ($resp.bas -and $resp.bit) {
  Write-Host "Tarih: $($resp.bas) - $($resp.bit)"
}
if ($MusteriFiltre) {
  Write-Host "Musteri filtresi: $MusteriFiltre"
}

if ($resp.kayitlar -and $resp.kayitlar.Count -gt 0) {
  $i = 1
  foreach ($k in $resp.kayitlar) {
    Write-Host ("  {0}. {1}" -f $i, $k)
    $i++
  }
} elseif ($DryRun -and $MusteriFiltre) {
  Write-Host '  (Bu filtreyle kayit yok)'
}

if ($resp.hatalar -and $resp.hatalar.Count -gt 0) {
  foreach ($h in $resp.hatalar) { Write-Host "HATA: $h" -ForegroundColor Red }
  exit 1
}
exit 0
