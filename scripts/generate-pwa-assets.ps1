Add-Type -AssemblyName System.Drawing

$publicPath = Join-Path $PSScriptRoot '..\public'
$brandPath = Join-Path $publicPath 'brand'
$iconPath = Join-Path $publicPath 'icons'
$splashPath = Join-Path $publicPath 'splash'
$sourceLogoPath = Join-Path $brandPath 'penitencia-logo-source.jpg'
$transparentLogoPath = Join-Path $brandPath 'penitencia-logo.png'

New-Item -ItemType Directory -Force -Path $brandPath, $iconPath, $splashPath | Out-Null

if (-not (Test-Path -LiteralPath $sourceLogoPath)) {
  throw "Logo source not found: $sourceLogoPath"
}

function New-TransparentLogo {
  param(
    [string]$SourcePath,
    [string]$OutputPath,
    [int]$MaxOutputWidth = 640
  )

  $source = [System.Drawing.Bitmap]::new($SourcePath)
  $bitmap = [System.Drawing.Bitmap]::new($source.Width, $source.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $minX = $source.Width
  $minY = $source.Height
  $maxX = 0
  $maxY = 0
  $hasVisiblePixel = $false

  for ($y = 0; $y -lt $source.Height; $y++) {
    for ($x = 0; $x -lt $source.Width; $x++) {
      $pixel = $source.GetPixel($x, $y)
      if ($pixel.R -gt 245 -and $pixel.G -gt 245 -and $pixel.B -gt 245) {
        $bitmap.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, 255, 255, 255))
      } else {
        $bitmap.SetPixel($x, $y, $pixel)
        $minX = [Math]::Min($minX, $x)
        $minY = [Math]::Min($minY, $y)
        $maxX = [Math]::Max($maxX, $x)
        $maxY = [Math]::Max($maxY, $y)
        $hasVisiblePixel = $true
      }
    }
  }

  if (-not $hasVisiblePixel) {
    $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bitmap.Dispose()
    $source.Dispose()
    return
  }

  $padding = 20
  $cropLeft = [Math]::Max(0, $minX - $padding)
  $cropTop = [Math]::Max(0, $minY - $padding)
  $cropRight = [Math]::Min($source.Width - 1, $maxX + $padding)
  $cropBottom = [Math]::Min($source.Height - 1, $maxY + $padding)
  $cropWidth = $cropRight - $cropLeft + 1
  $cropHeight = $cropBottom - $cropTop + 1
  $scale = [Math]::Min(1.0, $MaxOutputWidth / $cropWidth)
  $outputWidth = [Math]::Max(1, [int][Math]::Round($cropWidth * $scale))
  $outputHeight = [Math]::Max(1, [int][Math]::Round($cropHeight * $scale))

  $cropped = [System.Drawing.Bitmap]::new($outputWidth, $outputHeight, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($cropped)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::FromArgb(0, 255, 255, 255))
  $graphics.DrawImage(
    $bitmap,
    [System.Drawing.Rectangle]::new(0, 0, $outputWidth, $outputHeight),
    $cropLeft,
    $cropTop,
    $cropWidth,
    $cropHeight,
    [System.Drawing.GraphicsUnit]::Pixel
  )

  $cropped.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $cropped.Dispose()
  $bitmap.Dispose()
  $source.Dispose()
}

function Draw-CoverImage {
  param(
    [System.Drawing.Graphics]$Graphics,
    [System.Drawing.Image]$Image,
    [int]$Width,
    [int]$Height,
    [single]$Opacity = 1
  )

  $scale = [Math]::Max($Width / $Image.Width, $Height / $Image.Height)
  $drawWidth = $Image.Width * $scale
  $drawHeight = $Image.Height * $scale
  $left = ($Width - $drawWidth) / 2
  $top = ($Height - $drawHeight) / 2

  $matrix = [System.Drawing.Imaging.ColorMatrix]::new()
  $matrix.Matrix33 = $Opacity
  $attributes = [System.Drawing.Imaging.ImageAttributes]::new()
  $attributes.SetColorMatrix($matrix)

  $dest = [System.Drawing.RectangleF]::new($left, $top, $drawWidth, $drawHeight)
  $Graphics.DrawImage($Image, [System.Drawing.Rectangle]::Round($dest), 0, 0, $Image.Width, $Image.Height, [System.Drawing.GraphicsUnit]::Pixel, $attributes)
  $attributes.Dispose()
}

function Draw-ContainedLogo {
  param(
    [System.Drawing.Graphics]$Graphics,
    [System.Drawing.Image]$Logo,
    [single]$CenterX,
    [single]$CenterY,
    [single]$MaxWidth,
    [single]$MaxHeight
  )

  $scale = [Math]::Min($MaxWidth / $Logo.Width, $MaxHeight / $Logo.Height)
  $drawWidth = $Logo.Width * $scale
  $drawHeight = $Logo.Height * $scale
  $left = $CenterX - ($drawWidth / 2)
  $top = $CenterY - ($drawHeight / 2)

  $Graphics.DrawImage($Logo, [System.Drawing.RectangleF]::new($left, $top, $drawWidth, $drawHeight))
}

function New-BrandIcon {
  param(
    [int]$Size,
    [string]$OutputPath,
    [switch]$Maskable
  )

  $logo = [System.Drawing.Image]::FromFile($transparentLogoPath)
  $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#3e4c37'))

  $maxWidth = if ($Maskable) { $Size * 0.72 } else { $Size * 0.84 }
  $maxHeight = if ($Maskable) { $Size * 0.38 } else { $Size * 0.46 }
  Draw-ContainedLogo -Graphics $graphics -Logo $logo -CenterX ($Size / 2) -CenterY ($Size / 2) -MaxWidth $maxWidth -MaxHeight $maxHeight

  $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()
  $logo.Dispose()
}

function New-BrandSplash {
  param(
    [int]$Width,
    [int]$Height,
    [string]$OutputPath
  )

  $source = [System.Drawing.Image]::FromFile($sourceLogoPath)
  $logo = [System.Drawing.Image]::FromFile($transparentLogoPath)
  $bitmap = [System.Drawing.Bitmap]::new($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#020b02'))

  Draw-CoverImage -Graphics $graphics -Image $source -Width $Width -Height $Height -Opacity 0.16

  $overlay = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(178, 2, 11, 2))
  $graphics.FillRectangle($overlay, 0, 0, $Width, $Height)
  $overlay.Dispose()

  Draw-ContainedLogo -Graphics $graphics -Logo $logo -CenterX ($Width / 2) -CenterY ($Height * 0.44) -MaxWidth ($Width * 0.72) -MaxHeight ($Height * 0.20)

  $brush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#f3efe4'))
  $font = [System.Drawing.Font]::new('Arial', [Math]::Max(22, $Width * 0.035), [System.Drawing.FontStyle]::Bold)
  $format = [System.Drawing.StringFormat]::new()
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $tagline = 'Onde a penit' + [char]0x00EA + 'ncia vira recompensa'
  $graphics.DrawString($tagline, $font, $brush, [System.Drawing.RectangleF]::new(0, $Height * 0.58, $Width, $Height * 0.08), $format)

  $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $format.Dispose()
  $font.Dispose()
  $brush.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
  $logo.Dispose()
  $source.Dispose()
}

New-TransparentLogo -SourcePath $sourceLogoPath -OutputPath $transparentLogoPath
New-BrandIcon -Size 180 -OutputPath (Join-Path $publicPath 'apple-touch-icon.png')
New-BrandIcon -Size 192 -OutputPath (Join-Path $iconPath 'icon-192.png')
New-BrandIcon -Size 512 -OutputPath (Join-Path $iconPath 'icon-512.png')
New-BrandIcon -Size 512 -OutputPath (Join-Path $iconPath 'icon-maskable-512.png') -Maskable

@(
  @{ Width = 1179; Height = 2556; Name = 'iphone-1179x2556.png' },
  @{ Width = 1290; Height = 2796; Name = 'iphone-1290x2796.png' },
  @{ Width = 1206; Height = 2622; Name = 'iphone-1206x2622.png' },
  @{ Width = 750; Height = 1334; Name = 'iphone-750x1334.png' }
) | ForEach-Object {
  New-BrandSplash -Width $_.Width -Height $_.Height -OutputPath (Join-Path $splashPath $_.Name)
}
