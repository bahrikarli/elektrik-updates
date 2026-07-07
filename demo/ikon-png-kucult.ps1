Add-Type -AssemblyName System.Drawing
$p = Join-Path $PSScriptRoot 'elektrik-baslat.png'
$i = [Drawing.Image]::FromFile($p)
$b = New-Object Drawing.Bitmap 512, 512
$g = [Drawing.Graphics]::FromImage($b)
$g.InterpolationMode = 'HighQualityBicubic'
$g.DrawImage($i, 0, 0, 512, 512)
$g.Dispose(); $i.Dispose()
$b.Save($p, [Drawing.Imaging.ImageFormat]::Png)
$b.Dispose()
