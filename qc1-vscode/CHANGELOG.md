# Changelog

## 0.3.1

### Added

- Add a privacy-aware Markdown diagnostic report containing QC1, project, toolchain, hardware, build, VS Code problem, Git and recent log context.
- Preview reports before saving or copying them, with automatic secret and personal-path redaction.

### Fixed

- Accept native CMake projects using `Src/` and `Inc/` without requiring `Core/` or `Drivers/`.
- Prefer a firmware's own `CMakeLists.txt`; keep the bundled CMake project as the fallback for projects without native CMake.
- Use the same detected STM32F103 startup and linker script during validation and compilation, excluding stale files under `build/`.
- Make HAL and `Drivers/` optional for bare-metal firmware.
- Run `st-info --probe` for status and ST-Link detection.
- Make serial, ST-Link, project auto-detection and baud-rate settings effective.
- Start OpenOCD with the ST-Link and STM32F1 configuration files.
- Report all project diagnostics without blocking `status` at the first issue.
- Avoid logging an external CMake command when validation stopped before execution.
- Reset the target after the `st-flash` fallback writes the firmware.

## 0.3.0

### Changed

- Replaced the Makefile and quick-command build path with CMake and Ninja.
- Added a bundled STM32F103 CMake project and ARM GNU toolchain file.
- Added automatic VS Code dependencies for CMake Tools and portable embedded build tools.
- Build outputs now live under `build/qc1` as `firmware.elf`, `.bin`, `.hex` and `.map`.

### Removed

- Removed workspace `Makefile` discovery.
- Removed external and bundled quick-command scripts.
- Removed the bundled Windows `make.exe` and its license stub.

## 0.1.4

### Fixed
- Fixed OS label display on macOS.
- Replaced generic 504 errors with QC1 internal error codes.
- Improved project diagnostics for missing Makefile, Core and Drivers.
- Separated ST-Link probe detection from st-flash installation.
- Improved Terminal QC1 output with command, CWD, stdout and stderr.

## 0.1.3

### Added
- Added Liix AI settings for API URL and API key.
- Added local AI provider support for Ollama and OpenAI-compatible servers.
