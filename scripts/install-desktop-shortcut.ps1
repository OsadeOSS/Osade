# Puts an Osade shortcut on this machine's Desktop so the window opens like a normal app.
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$appDir = Join-Path $root 'apps\desktop'
$png = Join-Path $root 'assets\osade.png'
$ico = Join-Path $root 'build\icon.ico'
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop 'Osade.lnk'

$electronCandidates = @(
  (Join-Path $appDir 'node_modules\electron\dist\electron.exe'),
  (Join-Path $root 'node_modules\electron\dist\electron.exe')
)
$electron = $electronCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $electron) {
  throw "Electron is not installed. Run pnpm install first."
}
if (-not (Test-Path (Join-Path $appDir 'dist\main\electron.js'))) {
  throw "The desktop app is not built. Run pnpm --filter @osade/desktop build first."
}
if (-not (Test-Path $png)) {
  throw "missing app icon: $png"
}

if (-not (Test-Path $ico)) {
  node (Join-Path $root 'scripts\make-icon.mjs')
  if (-not (Test-Path $ico)) { throw "failed to write $ico" }
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnk)
$shortcut.TargetPath = $electron
$shortcut.Arguments = '"' + $appDir + '"'
$shortcut.WorkingDirectory = $appDir
$shortcut.WindowStyle = 1
$shortcut.Description = 'Osade'
$shortcut.IconLocation = "$ico,0"
$shortcut.Save()

Write-Output $lnk
