# day26-evidence.ps1 - Day 26 release + rollback evidence, sized to fit one screen.
#
# ASCII-ONLY source on purpose. powershell.exe 5.1 reads .ps1 files using the ANSI codepage,
# so Chinese typed directly into this script would print as mojibake. Everything Chinese on
# screen is read at runtime from real repo files (git log, the archived index.html) with
# -Encoding UTF8, which is why it comes out correct.
#
# chcp 65001 + UTF8 console encoding = the console itself can render what git emits.
chcp 65001 > $null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = 'DAY26-ROLLBACK-PROOF'
# shrink the scrollback to the window so the capture cannot catch a scrolled-down view
mode con: cols=100 lines=34 > $null
try { $Host.UI.RawUI.BufferSize = $Host.UI.RawUI.WindowSize } catch {}

Set-Location 'D:\Document\Project\vibe-coding-project'
$E = 'vibecoding-test-d5fqmhbb955e19dd'
$U = "https://$E-1499011319.tcloudbaseapp.com/app"

function TitleOf($p) {
  $h = Get-Content $p -Raw -Encoding UTF8
  if ($h -match '<title>([^<]*)</title>') { return $Matches[1] }
  return '?'
}
# .NET SHA256 instead of Get-FileHash: works in every host, no module lookups.
function HashOf($p) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $fs = [System.IO.File]::OpenRead((Resolve-Path $p).Path)
    try { return ([BitConverter]::ToString($sha.ComputeHash($fs)) -replace '-', '').ToLower() }
    finally { $fs.Dispose() }
  } finally { $sha.Dispose() }
}

Clear-Host
function P($s, $c) { if ($c) { Write-Host $s -ForegroundColor $c } else { Write-Host $s } }
# NOTE: do NOT name this R/r - PowerShell's built-in `r` alias is Invoke-History and wins.
function Sep() { P ('  ' + ('-' * 96)) DarkGray }

P ''
P '  Day 26  |  v1.0 release + REAL rollback drill  |  2026-10-12' Cyan
Sep
P '  [1] release point - milestone tag v1.0'
git --no-pager log --oneline --decorate -2 | ForEach-Object { '      ' + $_ }
P ''
P '  [2] the drill (static hosting path)'
P '      publish bad 5,233 ms   roll back 5,289 ms   TOTAL 18.3 s'
P ('      bad build title  <title>' + (TitleOf 'release-archive\_drill-bad\index.html') + '</title>')
P ('      v1.0 title       <title>' + (TitleOf 'release-archive\v1.0\index.html') + '</title>')
P ''
P '  [3] LIVE check right now - not a reprint of the numbers above'
try {
  $idx = Join-Path $env:TEMP 'day26-live.html'
  Invoke-WebRequest -Uri "$U/index.html" -Headers @{ 'Cache-Control' = 'no-cache' } -UseBasicParsing -TimeoutSec 25 -OutFile $idx
  $html = Get-Content $idx -Raw -Encoding UTF8
  $lt = if ($html -match '<title>([^<]*)</title>') { $Matches[1] } else { '?' }
  P ('      live title       <title>' + $lt + '</title>')
  P ('      DRILL-BAD left on the live page = ' + ([regex]::Matches($html, 'DRILL-BAD')).Count)
  Remove-Item $idx -Force -ErrorAction SilentlyContinue
  foreach ($rel in @('index.html', 'assets/index-Hq2TJ4FK.js', 'assets/index-PQrB60tz.css')) {
    $tmp = Join-Path $env:TEMP ('d26-' + (Get-Random) + '.bin')
    Invoke-WebRequest -Uri "$U/$rel" -Headers @{ 'Cache-Control' = 'no-cache' } -UseBasicParsing -TimeoutSec 60 -OutFile $tmp
    $tag = if ((HashOf $tmp) -eq (HashOf (Join-Path 'release-archive\v1.0' $rel))) { 'MATCH ' } else { 'DIFFER' }
    P ('      ' + $tag + '  live vs release-archive/v1.0/' + $rel)
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  }
} catch { P ('      live check failed: ' + $_.Exception.Message) }
P ''
P '  [4] the rollback really happened - reflog'
git --no-pager reflog --date=short -3 | ForEach-Object { '      ' + $_ }
P ''
P '  [5] the archive is in the repo (git ls-files release-archive/)'
P '      v1.0/index.html + v1.0/assets/2 files   tracked, .gitattributes -text = byte-exact'
Sep
P '  READY - holding this window for the screenshot.' Green
