# Musteri CSV aktarimi - Windows PowerShell 5.1, ASCII only
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$CsvDosya,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

if ($PSScriptRoot -match '[\\/]scripts$') {
  $Klasor = Split-Path -Parent $PSScriptRoot
} else {
  $Klasor = $PSScriptRoot
}

if (-not $CsvDosya) { throw 'CSV dosya yolu verin.' }
if ([IO.Path]::IsPathRooted($CsvDosya)) {
  $CsvTam = $CsvDosya
} else {
  $CsvTam = Join-Path $Klasor $CsvDosya
}
if (-not (Test-Path $CsvTam)) { throw "Dosya bulunamadi: $CsvTam" }

function Str([object]$v) {
  if ($null -eq $v) { return '' }
  return [string]$v
}

function Env-Oku {
  param([string]$Root)
  $aday = @(
    (Join-Path $env:LOCALAPPDATA 'Elektrik Otomasyon\.env'),
    (Join-Path $Root '.env')
  )
  $envMap = @{}
  foreach ($p in $aday) {
    if (-not (Test-Path $p)) { continue }
    Get-Content $p -Encoding UTF8 | ForEach-Object {
      $line = $_.Trim()
      if (-not $line -or $line.StartsWith('#')) { return }
      $i = $line.IndexOf('=')
      if ($i -lt 1) { return }
      $k = $line.Substring(0, $i).Trim()
      $v = $line.Substring($i + 1).Trim()
      $envMap[$k] = $v
    }
    if ($envMap.Count -gt 0) { return $envMap }
  }
  throw ".env bulunamadi. Klasor: $Root"
}

function Norm-Baslik {
  param([string]$h)
  $t = (Str $h).Trim().ToLowerInvariant()
  $t = $t -replace '\s',''
  return $t
}

function Parse-Tutar {
  param([string]$s)
  $t = (Str $s).Trim() -replace '\s',''
  $t = $t -replace 'TL','' -replace 'tl',''
  if ($t -match ',') {
    $t = $t -replace '\.',''
    $t = $t -replace ',','.'
  }
  $n = 0.0
  $ci = [System.Globalization.CultureInfo]::InvariantCulture
  if ([double]::TryParse($t, [System.Globalization.NumberStyles]::Float, $ci, [ref]$n)) {
    return [Math]::Round($n, 2)
  }
  return 0.0
}

function Parse-Tarih {
  param([string]$s)
  $t = (Str $s).Trim()
  if (-not $t) { return $null }
  $rx = '^\s*(\d{1,2})[\./](\d{1,2})[\./](\d{4})\s*$'
  if ($t -match $rx) {
    return Get-Date -Year ([int]$Matches[3]) -Month ([int]$Matches[2]) -Day ([int]$Matches[1]) -Hour 12 -Minute 0 -Second 0
  }
  try { return [DateTime]::Parse($t) } catch { return $null }
}

function Col-Get {
  param($cols, [int]$idx)
  if ($idx -lt 0 -or $idx -ge $cols.Count) { return '' }
  return Str $cols[$idx]
}

function Csv-Oku {
  param([string]$path)
  $raw = [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8)
  if ($raw.Length -gt 0 -and [int][char]$raw[0] -eq 0xFEFF) { $raw = $raw.Substring(1) }
  $lines = $raw -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  if ($lines.Count -lt 2) { return @() }

  $sep = ';'
  if ($lines[0].Contains(';')) { $sep = ';' }
  elseif ($lines[0].Contains([char]9)) { $sep = [char]9 }
  else { $sep = ',' }

  $headers = @()
  foreach ($h in $lines[0].Split($sep)) { $headers += (Norm-Baslik $h) }

  $iu = [array]::IndexOf($headers, 'unvan')
  if ($iu -lt 0) { $iu = [array]::IndexOf($headers, 'adsoyad') }
  if ($iu -lt 0) { $iu = 0 }
  $ib = [array]::IndexOf($headers, 'bakiye')
  if ($ib -lt 0) { $ib = [array]::IndexOf($headers, 'borc') }
  if ($ib -lt 0 -and $headers.Count -ge 2) { $ib = 1 }
  $it = [array]::IndexOf($headers, 'sonislem')
  if ($it -lt 0) { $it = [array]::IndexOf($headers, 'tarih') }
  if ($it -lt 0 -and $headers.Count -ge 3) { $it = 2 }
  $ip = [array]::IndexOf($headers, 'telefon')
  if ($ip -lt 0) { $ip = [array]::IndexOf($headers, 'tel') }

  $rows = @()
  for ($i = 1; $i -lt $lines.Count; $i++) {
    $cols = $lines[$i].Split($sep)
    $unvan = (Col-Get $cols $iu).Trim()
    if (-not $unvan) { continue }
    $telRaw = (Col-Get $cols $ip) -replace '\D',''
    $rows += [PSCustomObject]@{
      Unvan    = $unvan
      Bakiye   = if ($ib -ge 0) { Parse-Tutar (Col-Get $cols $ib) } else { 0 }
      SonIslem = if ($it -ge 0) { Parse-Tarih (Col-Get $cols $it) } else { $null }
      Telefon  = $telRaw
    }
  }
  return $rows
}

function Yeni-Telefon {
  param(
    [System.Collections.Generic.HashSet[string]]$set,
    [ref]$seri
  )
  for ($n = $seri.Value; $n -lt ($seri.Value + 100000); $n++) {
    $pad = $n.ToString().PadLeft(7, '0')
    $tel = ('532{0}' -f $pad).Substring(0, 10)
    if (-not $set.Contains($tel)) {
      [void]$set.Add($tel)
      $seri.Value = $n + 1
      return $tel
    }
  }
  throw 'Bos telefon bulunamadi.'
}

$envMap = Env-Oku $Klasor
$server = $envMap['DB_SERVER']
$db = $envMap['DB_NAME']
$user = $envMap['DB_USER']
$pass = $envMap['DB_PASSWORD']
if (-not $server -or -not $db) { throw 'DB_SERVER ve DB_NAME .env icinde olmali.' }

$builder = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
$builder['Data Source'] = $server
$builder['Initial Catalog'] = $db
$builder['TrustServerCertificate'] = $true
if ($user) {
  $builder['User ID'] = $user
  $builder['Password'] = $pass
} else {
  $builder['Integrated Security'] = $true
}

$rows = Csv-Oku $CsvTam
Write-Host "Dosya: $CsvTam"
if ($DryRun) {
  Write-Host "Satir: $($rows.Count) (DRY-RUN)"
} else {
  Write-Host "Satir: $($rows.Count)"
}

$conn = New-Object System.Data.SqlClient.SqlConnection $builder.ConnectionString
$conn.Open()

$telSet = New-Object 'System.Collections.Generic.HashSet[string]'
$cmdTel = $conn.CreateCommand()
$cmdTel.CommandText = 'SELECT Telefon FROM Musteriler WHERE Telefon IS NOT NULL'
$rdr = $cmdTel.ExecuteReader()
while ($rdr.Read()) {
  $t = Str $rdr['Telefon']
  if ($t) { [void]$telSet.Add($t.Trim()) }
}
$rdr.Close()

$seri = 1
$ok = 0
$atla = 0

foreach ($row in $rows) {
  $cmdDup = $conn.CreateCommand()
  $cmdDup.CommandText = 'SELECT TOP 1 MusteriID FROM Musteriler WHERE LTRIM(RTRIM(AdSoyad)) = @Ad OR LTRIM(RTRIM(FirmaAdi)) = @Ad'
  $null = $cmdDup.Parameters.AddWithValue('@Ad', $row.Unvan)
  $mid = $cmdDup.ExecuteScalar()
  if ($mid) {
    Write-Host "  ATLA: $($row.Unvan)"
    $atla++
    continue
  }

  $tel = $row.Telefon -replace '^0',''
  if ($tel -notmatch '^[1-9][0-9]{9}$') { $tel = Yeni-Telefon $telSet ([ref]$seri) }
  if ($row.SonIslem) { $tarih = $row.SonIslem } else { $tarih = Get-Date }

  if ($DryRun) {
    Write-Host "  EKLE: $($row.Unvan) | bakiye=$($row.Bakiye) | tel=$tel"
    $ok++
    continue
  }

  $tx = $conn.BeginTransaction()
  try {
    $adKisa = $row.Unvan
    if ($adKisa.Length -gt 100) { $adKisa = $adKisa.Substring(0, 100) }

    $cmdIns = $conn.CreateCommand()
    $cmdIns.Transaction = $tx
    $cmdIns.CommandText = 'INSERT INTO Musteriler (AdSoyad, Telefon, tur, Bakiye) OUTPUT INSERTED.MusteriID VALUES (@Ad, @Tel, N''Gercek'', @Bakiye)'
    $null = $cmdIns.Parameters.AddWithValue('@Ad', $adKisa)
    $null = $cmdIns.Parameters.AddWithValue('@Tel', $tel)
    $null = $cmdIns.Parameters.AddWithValue('@Bakiye', $row.Bakiye)
    $musteriID = [int]$cmdIns.ExecuteScalar()

    if ($row.Bakiye -gt 0.005) {
      $cmdHar = $conn.CreateCommand()
      $cmdHar.Transaction = $tx
      $cmdHar.CommandText = @'
INSERT INTO MusteriHareketleri
  (MusteriID, Tur, ToplamTutar, OdenenTutar, KalanTutar, OdemeSekli, Aciklama, Kullanici, Referans, Tarih)
VALUES
  (@MID, N'Satis', @Toplam, 0, @Kalan, NULL,
   N'Eski programdan devir bakiyesi', N'aktarim', N'devir:import', @Tarih)
'@
      $null = $cmdHar.Parameters.AddWithValue('@MID', $musteriID)
      $null = $cmdHar.Parameters.AddWithValue('@Toplam', $row.Bakiye)
      $null = $cmdHar.Parameters.AddWithValue('@Kalan', $row.Bakiye)
      $null = $cmdHar.Parameters.AddWithValue('@Tarih', $tarih)
      [void]$cmdHar.ExecuteNonQuery()
    }

    $tx.Commit()
    Write-Host "  OK: $($row.Unvan) (#$musteriID, $($row.Bakiye) TL)"
    $ok++
  } catch {
    $tx.Rollback()
    Write-Host "  HATA: $($row.Unvan) - $($_.Exception.Message)"
  }
}

$conn.Close()
Write-Host ''
Write-Host "Tamam. Eklenen: $ok, atlanan: $atla"
