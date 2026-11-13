# Rebuild the code-drawn Ordo icon on Windows. No external media is used.
Add-Type -AssemblyName System.Drawing
$ordoRoot = Split-Path -Parent $PSScriptRoot
$ordoBuild = Join-Path $ordoRoot 'build'
New-Item -ItemType Directory -Path $ordoBuild -Force | Out-Null
$ordoBitmap = [System.Drawing.Bitmap]::new(256, 256)
$ordoGraphics = [System.Drawing.Graphics]::FromImage($ordoBitmap)
$ordoGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$ordoGraphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#192d29'))
$ordoPen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#d6e1c2'), 6)
$ordoPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
$ordoPath.AddArc(54, 28, 148, 148, 180, 180)
$ordoPath.AddLine(202, 102, 202, 222)
$ordoPath.AddLine(202, 222, 54, 222)
$ordoPath.CloseFigure()
$ordoGraphics.DrawPath($ordoPen, $ordoPath)
$ordoGraphics.DrawEllipse($ordoPen, 92, 99, 72, 84)
$ordoPng = [System.IO.MemoryStream]::new()
$ordoBitmap.Save($ordoPng, [System.Drawing.Imaging.ImageFormat]::Png)
$ordoBytes = $ordoPng.ToArray()
$ordoFile = [System.IO.File]::Create((Join-Path $ordoBuild 'icon.ico'))
$ordoWriter = [System.IO.BinaryWriter]::new($ordoFile)
$ordoWriter.Write([uint16]0); $ordoWriter.Write([uint16]1); $ordoWriter.Write([uint16]1)
$ordoWriter.Write([byte]0); $ordoWriter.Write([byte]0); $ordoWriter.Write([byte]0); $ordoWriter.Write([byte]0)
$ordoWriter.Write([uint16]1); $ordoWriter.Write([uint16]32)
$ordoWriter.Write([uint32]$ordoBytes.Length); $ordoWriter.Write([uint32]22)
$ordoWriter.Write($ordoBytes)
$ordoWriter.Dispose(); $ordoFile.Dispose(); $ordoPng.Dispose(); $ordoPath.Dispose(); $ordoPen.Dispose(); $ordoGraphics.Dispose(); $ordoBitmap.Dispose()
