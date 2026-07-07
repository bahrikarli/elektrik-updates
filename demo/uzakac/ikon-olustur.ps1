# ELEKTRIK masaustu simgesi — buyuk simsek, kucuk boyutta da okunur.
param(
  [string]$Klasor = $PSScriptRoot,
  [switch]$Zorla
)

Add-Type -AssemblyName System.Drawing

$Png = Join-Path $Klasor 'elektrik-uzak.png'
$Ico = Join-Path $Klasor 'elektrik-uzak.ico'

if (-not $Zorla -and (Test-Path $Png) -and (Test-Path $Ico)) {
  return
}

function New-ElektrikBitmap([int]$size) {
  $bmp = New-Object Drawing.Bitmap $size, $size, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([Drawing.Color]::FromArgb(255, 13, 71, 161))

  $rect = New-Object Drawing.Rectangle 0, 0, $size, $size
  $ust = [Drawing.Color]::FromArgb(255, 25, 118, 210)
  $alt = [Drawing.Color]::FromArgb(255, 13, 71, 161)
  $bg = New-Object Drawing.Drawing2D.LinearGradientBrush $rect, $ust, $alt, 135
  $g.FillRectangle($bg, $rect)
  $bg.Dispose()

  $s = $size / 512.0

  # Buyuk simsek — klasik zigzag, simgenin ~%78'i
  $bolt = @(
    (New-Object Drawing.PointF (284 * $s), (58 * $s)),
    (New-Object Drawing.PointF (158 * $s), (252 * $s)),
    (New-Object Drawing.PointF (248 * $s), (252 * $s)),
    (New-Object Drawing.PointF (188 * $s), (454 * $s)),
    (New-Object Drawing.PointF (354 * $s), (218 * $s)),
    (New-Object Drawing.PointF (268 * $s), (218 * $s))
  )

  $path = New-Object Drawing.Drawing2D.GraphicsPath
  $path.AddPolygon($bolt)

  # Hafif golge (derinlik)
  $shadow = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(90, 0, 0, 0))
  $shadowM = New-Object Drawing.Drawing2D.Matrix
  $shadowM.Translate(6 * $s, 8 * $s)
  $shadowPath = $path.Clone()
  $shadowPath.Transform($shadowM)
  $g.FillPath($shadow, $shadowPath)
  $shadow.Dispose()
  $shadowPath.Dispose()
  $shadowM.Dispose()

  # Beyaz cerceve — kucuk simgede kontrast
  $cerceve = New-Object Drawing.Pen ([Drawing.Color]::FromArgb(255, 255, 255, 255)), (20 * $s)
  $cerceve.LineJoin = [Drawing.Drawing2D.LineJoin]::Miter
  $cerceve.MiterLimit = 3
  $g.DrawPath($cerceve, $path)

  # Altin dolgu
  $dolguRect = New-Object Drawing.RectangleF (150 * $s), (50 * $s), (220 * $s), (420 * $s)
  $dolgu = New-Object Drawing.Drawing2D.LinearGradientBrush $dolguRect,
    ([Drawing.Color]::FromArgb(255, 255, 241, 118)),
    ([Drawing.Color]::FromArgb(255, 255, 179, 0)),
    105
  $g.FillPath($dolgu, $path)
  $dolgu.Dispose()
  $cerceve.Dispose()
  $path.Dispose()

  $g.Dispose()
  return $bmp
}

function Save-IconMultiSize([string]$path, [Drawing.Bitmap]$source512) {
  $sizes = @(256, 48, 32, 16)
  $ms = New-Object IO.MemoryStream
  $bw = New-Object IO.BinaryWriter $ms

  $bw.Write([uint16]0)
  $bw.Write([uint16]1)
  $bw.Write([uint16]$sizes.Count)

  $images = New-Object System.Collections.Generic.List[byte[]]
  foreach ($sz in $sizes) {
    $scaled = New-Object Drawing.Bitmap $sz, $sz, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $sg = [Drawing.Graphics]::FromImage($scaled)
    $sg.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $sg.DrawImage($source512, 0, 0, $sz, $sz)
    $sg.Dispose()

    $imgMs = New-Object IO.MemoryStream
    $scaled.Save($imgMs, [Drawing.Imaging.ImageFormat]::Png)
    $images.Add($imgMs.ToArray())
    $imgMs.Dispose()
    $scaled.Dispose()
  }

  $offset = 6 + (16 * $sizes.Count)
  foreach ($i in 0..($sizes.Count - 1)) {
    $sz = $sizes[$i]
    $dim = if ($sz -ge 256) { [byte]0 } else { [byte]$sz }
    $bw.Write($dim)
    $bw.Write($dim)
    $bw.Write([byte]0)
    $bw.Write([byte]0)
    $bw.Write([uint16]1)
    $bw.Write([uint16]32)
    $bw.Write([uint32]$images[$i].Length)
    $bw.Write([uint32]$offset)
    $offset += $images[$i].Length
  }
  foreach ($img in $images) { $bw.Write($img) }

  [IO.File]::WriteAllBytes($path, $ms.ToArray())
  $bw.Dispose()
  $ms.Dispose()
}

$master = New-ElektrikBitmap 512
$master.Save($Png, [Drawing.Imaging.ImageFormat]::Png)
Save-IconMultiSize $Ico $master
$master.Dispose()

Write-Host "Simge olusturuldu: $Png"
Write-Host "Simge olusturuldu: $Ico"
