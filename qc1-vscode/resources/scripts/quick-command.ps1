[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

param(
    [string]$Command = "make"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$extensionRoot = Resolve-Path "$scriptDir\..\.."
$bundledMake = Join-Path $extensionRoot "resources\tools\windows\make.exe"

function QC1-Header {
    Write-Host ""
    Write-Host "============================================================"
    Write-Host " QC1 STM32 Tools"
    Write-Host "============================================================"
}

function QC1-Ok($msg) {
    Write-Host "[OK] $msg"
}

function QC1-Warn($msg) {
    Write-Host "[WARN] $msg"
}

function QC1-Error($msg) {
    Write-Host "[ERREUR] $msg"
}

function Find-Tool($name) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }
    return $null
}

function Find-Make {
    if (Test-Path $bundledMake) {
        return $bundledMake
    }

    $make = Find-Tool "make"
    if ($make) {
        return $make
    }

    $mingwMake = Find-Tool "mingw32-make"
    if ($mingwMake) {
        return $mingwMake
    }

    return $null
}

QC1-Header

Write-Host "Dossier projet:"
Write-Host "  $(Get-Location)"
Write-Host ""

if (-not (Test-Path "Makefile")) {
    QC1-Error "Aucun Makefile trouvé dans ce dossier."
    Write-Host ""
    Write-Host "Solution:"
    Write-Host "  Ouvre le dossier racine du projet STM32 dans VSCode."
    Write-Host "  Le fichier Makefile doit être visible à la racine."
    exit 1
}

$makeCmd = Find-Make
$gccCmd = Find-Tool "arm-none-eabi-gcc"
$sizeCmd = Find-Tool "arm-none-eabi-size"
$openocdCmd = Find-Tool "openocd"
$stFlashCmd = Find-Tool "st-flash"

Write-Host "Détection des outils:"
if ($makeCmd) { QC1-Ok "make: $makeCmd" } else { QC1-Error "make introuvable" }
if ($gccCmd) { QC1-Ok "arm-none-eabi-gcc: $gccCmd" } else { QC1-Warn "arm-none-eabi-gcc introuvable" }
if ($sizeCmd) { QC1-Ok "arm-none-eabi-size: $sizeCmd" } else { QC1-Warn "arm-none-eabi-size introuvable" }
if ($openocdCmd) { QC1-Ok "openocd: $openocdCmd" } else { QC1-Warn "openocd introuvable" }
if ($stFlashCmd) { QC1-Ok "st-flash: $stFlashCmd" } else { QC1-Warn "st-flash introuvable" }

Write-Host ""

if (-not $makeCmd) {
    QC1-Error "GNU Make est introuvable."
    Write-Host ""
    Write-Host "L'extension a cherché:"
    Write-Host "  - make.exe intégré"
    Write-Host "  - make dans le PATH"
    Write-Host "  - mingw32-make dans le PATH"
    Write-Host ""
    Write-Host "Vérifie que ce fichier existe:"
    Write-Host "  $bundledMake"
    exit 1
}

if (-not $gccCmd) {
    QC1-Warn "Le compilateur ARM n'est pas détecté."
    Write-Host "Si la compilation échoue, installe ARM GNU Toolchain ou STM32CubeIDE."
    Write-Host ""
}

Write-Host "Commande exécutée:"
Write-Host "  $makeCmd $Command"
Write-Host ""

try {
    & $makeCmd $Command
    $exitCode = $LASTEXITCODE

    Write-Host ""
    if ($exitCode -eq 0) {
        QC1-Ok "Commande terminée avec succès."
    }
    else {
        QC1-Error "La commande a échoué avec le code $exitCode."
    }

    exit $exitCode
}
catch {
    Write-Host ""
    QC1-Error "Erreur PowerShell pendant l'exécution."
    Write-Host $_.Exception.Message
    exit 1
}
