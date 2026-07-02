Add-Type -AssemblyName System.Drawing

$publicPath = Join-Path $PSScriptRoot '..\public'
$iconPath = Join-Path $publicPath 'icons'
$splashPath = Join-Path $publicPath 'splash'
New-Item -ItemType Directory -Force -Path $iconPath, $splashPath | Out-Null

function New-BrandCanvas {
  param(
    [int]$Width,
    [int]$Height,
    [string]$OutputPath,
    [switch]$Maskable
  )

  $bitmap = [System.Drawing.Bitmap]::new($Width, $Height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#020b02'))

  $size = [Math]::Min($Width, $Height)
  $logoSize = if ($Maskable) { $size * 0.56 } else { $size * 0.68 }
  $left = ($Width - $logoSize) / 2
  $top = ($Height - $logoSize) / 2
  $penWidth = [Math]::Max(4, $size * 0.055)
  $pen = [System.Drawing.Pen]::new(
    [System.Drawing.ColorTranslator]::FromHtml('#12c312'),
    $penWidth
  )
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

  $points = @(
    [System.Drawing.PointF]::new($left + $logoSize * 0.06, $top + $logoSize * 0.82),
    [System.Drawing.PointF]::new($left + $logoSize * 0.34, $top + $logoSize * 0.18),
    [System.Drawing.PointF]::new($left + $logoSize * 0.50, $top + $logoSize * 0.55),
    [System.Drawing.PointF]::new($left + $logoSize * 0.70, $top + $logoSize * 0.08),
    [System.Drawing.PointF]::new($left + $logoSize * 0.94, $top + $logoSize * 0.82)
  )
  $graphics.DrawLines($pen, $points)
  $graphics.DrawLine(
    $pen,
    [float]($left + $logoSize * 0.06),
    [float]($top + $logoSize * 0.82),
    [float]($left + $logoSize * 0.94),
    [float]($top + $logoSize * 0.82)
  )

  $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $pen.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}

New-BrandCanvas -Width 180 -Height 180 -OutputPath (Join-Path $publicPath 'apple-touch-icon.png')
New-BrandCanvas -Width 192 -Height 192 -OutputPath (Join-Path $iconPath 'icon-192.png')
New-BrandCanvas -Width 512 -Height 512 -OutputPath (Join-Path $iconPath 'icon-512.png')
New-BrandCanvas -Width 512 -Height 512 -OutputPath (Join-Path $iconPath 'icon-maskable-512.png') -Maskable

@(
  @{ Width = 1179; Height = 2556; Name = 'iphone-1179x2556.png' },
  @{ Width = 1290; Height = 2796; Name = 'iphone-1290x2796.png' },
  @{ Width = 1206; Height = 2622; Name = 'iphone-1206x2622.png' },
  @{ Width = 750; Height = 1334; Name = 'iphone-750x1334.png' }
) | ForEach-Object {
  New-BrandCanvas -Width $_.Width -Height $_.Height -OutputPath (Join-Path $splashPath $_.Name)
}
