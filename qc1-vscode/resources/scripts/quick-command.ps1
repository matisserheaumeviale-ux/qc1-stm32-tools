param(
  [string]$Command
)

switch ($Command) {
  "make" {
    make
  }
  "build" {
    make
  }
  "clean" {
    make clean
  }
  "flash" {
    make flash
  }
  "run" {
    make
    make flash
  }
  "status" {
    Write-Host "QC1 Status"
    Write-Host "Workspace: $(Get-Location)"

    if (Test-Path "Makefile") {
      Write-Host "Makefile: OK"
    } else {
      Write-Host "Makefile: Missing"
    }

    if (Get-Command st-info -ErrorAction SilentlyContinue) {
      st-info --probe
    } else {
      Write-Host "st-info not found"
    }
  }
  default {
    Write-Host "QC1 Quick Command"
    Write-Host "Usage: quick-command [make|build|clean|flash|run|status]"
  }
}
