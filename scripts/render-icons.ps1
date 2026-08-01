param(
  [string]$OutDir = (Join-Path $PSScriptRoot "..\src\icons")
)

Add-Type -AssemblyName System.Drawing

function Convert-Color {
  param([string]$Hex)
  return [System.Drawing.ColorTranslator]::FromHtml($Hex)
}

function New-RoundedRectPath {
  param([float]$X, [float]$Y, [float]$W, [float]$H, [float]$R)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = 2 * $R
  $path.AddArc($X, $Y, $d, $d, 180, 90)
  $path.AddArc($X + $W - $d, $Y, $d, $d, 270, 90)
  $path.AddArc($X + $W - $d, $Y + $H - $d, $d, $d, 0, 90)
  $path.AddArc($X, $Y + $H - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-FlameOuterPath {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.StartFigure()
  $path.AddBezier(64, 16, 59, 36, 46, 48, 39, 62)
  $path.AddBezier(39, 62, 33, 76, 36, 90, 48, 96)
  $path.AddBezier(48, 96, 56, 100, 72, 100, 80, 96)
  $path.AddBezier(80, 96, 92, 90, 95, 76, 89, 62)
  $path.AddBezier(89, 62, 82, 48, 69, 36, 64, 16)
  $path.CloseFigure()
  return $path
}

function New-FlameMidPath {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.StartFigure()
  $path.AddBezier(64, 38, 60, 54, 51, 62, 46, 72)
  $path.AddBezier(46, 72, 43, 80, 47, 88, 55, 91)
  $path.AddBezier(55, 91, 61, 94, 67, 94, 73, 91)
  $path.AddBezier(73, 91, 81, 88, 85, 80, 82, 72)
  $path.AddBezier(82, 72, 77, 62, 68, 54, 64, 38)
  $path.CloseFigure()
  return $path
}

function Render-Icon {
  param(
    [int]$Size,
    [string]$Path,
    [hashtable]$Palette
  )

  $bitmap = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $scale = $Size / 128.0
  $graphics.ScaleTransform($scale, $scale)

  $trayBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.RectangleF(28, 84, 72, 37)),
    (Convert-Color $Palette.trayTop),
    (Convert-Color $Palette.trayBottom),
    90
  )
  $mouthBrush = New-Object System.Drawing.SolidBrush((Convert-Color $Palette.mouth))
  $lipBrush = New-Object System.Drawing.SolidBrush((Convert-Color $Palette.lip))
  $flameBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.RectangleF(28, 16, 72, 84)),
    (Convert-Color $Palette.flameTop),
    (Convert-Color $Palette.flameBottom),
    90
  )
  $midBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.RectangleF(28, 38, 72, 56)),
    (Convert-Color $Palette.midTop),
    (Convert-Color $Palette.midBottom),
    90
  )
  $coreBrush = New-Object System.Drawing.SolidBrush((Convert-Color $Palette.core))
  $emberBrush = New-Object System.Drawing.SolidBrush((Convert-Color $Palette.ember))

  $graphics.FillPath($trayBrush, (New-RoundedRectPath 28 84 72 37 13))
  $graphics.FillEllipse($mouthBrush, 30, 76, 68, 14)
  $graphics.FillPath($lipBrush, (New-RoundedRectPath 30 83 68 5 2.5))
  $graphics.FillPath($flameBrush, (New-FlameOuterPath))

  if ($Size -ge 32) {
    $graphics.FillPath($midBrush, (New-FlameMidPath))
    $graphics.FillEllipse($coreBrush, 57.5, 63, 13, 18)
  }

  if ($Size -ge 48) {
    $graphics.FillEllipse($emberBrush, 87.5, 37.5, 5, 5)
    $graphics.FillEllipse($emberBrush, 34, 56, 4, 4)
    $graphics.FillEllipse($emberBrush, 72.4, 24.4, 3.2, 3.2)
  }

  $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)

  $graphics.Dispose()
  $bitmap.Dispose()
  $trayBrush.Dispose()
  $mouthBrush.Dispose()
  $lipBrush.Dispose()
  $flameBrush.Dispose()
  $midBrush.Dispose()
  $coreBrush.Dispose()
  $emberBrush.Dispose()
}

$Brand = @{
  trayTop    = "#1c9aa8"
  trayBottom = "#0b5f6a"
  mouth      = "#0a525b"
  lip        = "#35b9c4"
  flameTop   = "#ff9d3d"
  flameBottom = "#e85d14"
  midTop     = "#ffc15e"
  midBottom  = "#ff8f2e"
  core       = "#fff6df"
  ember      = "#ffb23e"
}

$ToolbarLight = @{
  trayTop    = "#59cdd2"
  trayBottom = "#1d9dac"
  mouth      = "#0b6f7a"
  lip        = "#83e4e2"
  flameTop   = "#ffd9a0"
  flameBottom = "#ffab57"
  midTop     = "#ffe7bd"
  midBottom  = "#ffc15e"
  core       = "#fffdf4"
  ember      = "#ffd27a"
}

$ToolbarDark = @{
  trayTop    = "#0b5f6a"
  trayBottom = "#073f47"
  mouth      = "#04282e"
  lip        = "#14838f"
  flameTop   = "#f2761c"
  flameBottom = "#c94f0e"
  midTop     = "#f7a93f"
  midBottom  = "#e06f1c"
  core       = "#ffefd0"
  ember      = "#f7a93f"
}

$IconDir = Resolve-Path $OutDir

Render-Icon 128 (Join-Path $IconDir "icon-128.png") $Brand
Render-Icon 96 (Join-Path $IconDir "icon-96.png") $Brand
Render-Icon 64 (Join-Path $IconDir "icon-64.png") $Brand
Render-Icon 48 (Join-Path $IconDir "icon-48.png") $Brand
Render-Icon 32 (Join-Path $IconDir "icon-32.png") $Brand
Render-Icon 16 (Join-Path $IconDir "icon-16.png") $Brand
Render-Icon 32 (Join-Path $IconDir "toolbar-light-32.png") $ToolbarLight
Render-Icon 32 (Join-Path $IconDir "toolbar-dark-32.png") $ToolbarDark

Write-Output "Rendered 8 icons to $IconDir"
