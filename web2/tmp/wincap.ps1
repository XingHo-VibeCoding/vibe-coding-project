# wincap.ps1 - capture ONLY the target window (not the whole desktop), optional OCR of the image.
#
# Why this exists / lessons baked in:
#   1) Set PER_MONITOR_AWARE_V2 FIRST. This box is 2560x1440 physical with 150% scaling;
#      a DPI-unaware process reports 1707x960 and every rect is off -> captures include
#      neighbours / desktop. That is exactly the bug this replaces.
#   2) PrintWindow(hwnd) grabs the window's own rendering: not occluded by other windows,
#      and no desktop background. Verify with a blankness sample.
#   3) If PrintWindow returns blank (some XAML windows), fall back to
#      "raise window + BitBlt only the window rect" - still target-window-only.
#   4) -Ocr dumps the text found in the PNG (Windows OCR, zh-Hans-CN available here).
#      Use it to PROVE the Chinese in a screenshot is not garbled; nobody has to eyeball it.
#   5) ASCII-only source on purpose: powershell.exe 5.1 reads .ps1 as the ANSI codepage,
#      so non-ASCII comments get mangled and can break the parser.
#
# Usage:
#   powershell -NoProfile -File wincap.ps1 -TitleLike "Notepad" -Out shot.png -Ocr
#   powershell -NoProfile -File wincap.ps1 -TitleLike "DAY26" -Out t.png -X 80 -Y 60 -Width 1100 -Height 700
param(
  [Parameter(Mandatory = $true)][string]$TitleLike,
  [Parameter(Mandatory = $true)][string]$Out,
  [switch]$Ocr,
  [int]$X = -2147483648,
  [int]$Y = -2147483648,
  [int]$Width = 0,
  [int]$Height = 0,
  [int]$SettleMs = 900,
  [switch]$Foreground,
  [string]$OcrLang = 'zh-Hans-CN'
)

$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WcapNative {
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hwnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hwnd, ref POINT p);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hwnd, int x, int y, int w, int h, bool repaint);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int cmd);
  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hwnd, IntPtr hdc);
  [DllImport("gdi32.dll")]  public static extern bool BitBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, int rop);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out RECT r, int size);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
}
"@
[void][WcapNative]::SetProcessDpiAwarenessContext([IntPtr](-4))   # PER_MONITOR_AWARE_V2
Add-Type -AssemblyName System.Drawing

function Get-WindowRectDwm([IntPtr]$h) {
  $r = New-Object WcapNative+RECT
  try { if ([WcapNative]::DwmGetWindowAttribute($h, 9, [ref]$r, 16) -eq 0) { return $r } } catch {}
  [void][WcapNative]::GetWindowRect($h, [ref]$r)
  return $r
}

function Find-Window([string]$like) {
  $procs = Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$like*" }
  if (-not $procs) { return $null }
  $best = $null; $bestArea = -1
  foreach ($p in $procs) {
    $r = Get-WindowRectDwm $p.MainWindowHandle
    $a = ($r.Right - $r.Left) * ($r.Bottom - $r.Top)
    if ($a -gt $bestArea) { $bestArea = $a; $best = $p }
  }
  return $best
}

$proc = $null
for ($i = 0; $i -lt 40; $i++) {
  $proc = Find-Window $TitleLike
  if ($proc) { break }
  Start-Sleep -Milliseconds 500
}
if (-not $proc) { Write-Error "no window whose title contains '$TitleLike'"; exit 2 }
$h = $proc.MainWindowHandle
Write-Host ("[find] pid=" + $proc.Id + " title=" + $proc.MainWindowTitle)

[void][WcapNative]::ShowWindow($h, 9)   # SW_RESTORE
if ($Width -gt 0 -and $Height -gt 0) {
  if ($X -eq -2147483648) { $X = 60 }
  if ($Y -eq -2147483648) { $Y = 60 }
  [void][WcapNative]::MoveWindow($h, $X, $Y, $Width, $Height, $true)
  Start-Sleep -Milliseconds 500
}
if ($Foreground) { [void][WcapNative]::SetForegroundWindow($h); Start-Sleep -Milliseconds 700 }
Start-Sleep -Milliseconds $SettleMs

$r = Get-WindowRectDwm $h
$w = $r.Right - $r.Left; $hh = $r.Bottom - $r.Top
Write-Host ("[rect] x=" + $r.Left + " y=" + $r.Top + " w=" + $w + " h=" + $hh)
if ($w -le 0 -or $hh -le 0) { Write-Error "bad window rect"; exit 3 }

function Test-BitmapLooksBlank($bm) {
  $seen = @{}
  foreach ($fx in 0.08,0.25,0.42,0.58,0.75,0.92) {
    foreach ($fy in 0.08,0.25,0.42,0.58,0.75,0.92) {
      $px = $bm.GetPixel([int]($bm.Width * $fx), [int]($bm.Height * $fy))
      $seen[("" + $px.R + "," + $px.G + "," + $px.B)] = $true
    }
  }
  return ($seen.Count -le 2)
}

$bmp = New-Object System.Drawing.Bitmap($w, $hh, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$ok = $false
try { $ok = [WcapNative]::PrintWindow($h, $hdc, 2) } finally { $g.ReleaseHdc($hdc) }
$blank = Test-BitmapLooksBlank $bmp
Write-Host ("[printwindow] ok=" + $ok + " blank=" + $blank)

if ((-not $ok) -or $blank) {
  Write-Host "[fallback] raise window, BitBlt window rect only"
  [void][WcapNative]::SetForegroundWindow($h)
  Start-Sleep -Milliseconds 1000
  $r = Get-WindowRectDwm $h
  $w = $r.Right - $r.Left; $hh = $r.Bottom - $r.Top
  $bmp.Dispose(); $g.Dispose()
  $bmp = New-Object System.Drawing.Bitmap($w, $hh, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $srcDc = [WcapNative]::GetDC([IntPtr]::Zero)
  $dstDc = $g.GetHdc()
  try { [void][WcapNative]::BitBlt($dstDc, 0, 0, $w, $hh, $srcDc, $r.Left, $r.Top, 0x00CC0020) }
  finally { $g.ReleaseHdc($dstDc); [void][WcapNative]::ReleaseDC([IntPtr]::Zero, $srcDc) }
}

$outFull = [System.IO.Path]::GetFullPath($Out)
$dir = [System.IO.Path]::GetDirectoryName($outFull)
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$bmp.Save($outFull, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
$kb = [Math]::Round((Get-Item $outFull).Length / 1024, 1)
Write-Host ("[saved] " + $outFull + " (" + $kb + " KB, " + $w + "x" + $hh + ")")

if ($Ocr) {
  try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    # Load the WinRT types explicitly; on Windows PowerShell 5.1 they are not resolvable
    # just by naming them (the projection assembly has to be pulled in first).
    $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
    $null = [Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime]
    $null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
    $null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
      Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
    function Await($op, $t) {
      $m = $asTaskGeneric.MakeGenericMethod($t)
      $task = $m.Invoke($null, @($op))
      $task.Wait(-1) | Out-Null
      $task.Result
    }
    $sf = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($outFull)) ([Windows.Storage.StorageFile])
    $st = Await ($sf.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($st)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $sb = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $lang = New-Object Windows.Globalization.Language $OcrLang
    $eng = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
    if (-not $eng) { $eng = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
    if (-not $eng) { Write-Host "[ocr] no engine available"; exit 0 }
    $res = Await ($eng.RecognizeAsync($sb)) ([Windows.Media.Ocr.OcrResult])
    Write-Host ("[ocr-lang] " + $eng.RecognizerLanguage.LanguageTag)
    Write-Host "[ocr-begin]"
    Write-Host $res.Text
    Write-Host "[ocr-end]"
  } catch {
    Write-Host ("[ocr] failed (capture is still fine): " + $_.Exception.Message)
  }
}
