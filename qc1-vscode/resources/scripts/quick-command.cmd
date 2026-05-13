@echo off
setlocal

set CMD=%1

if "%CMD%"=="make" (
    make
    exit /b %ERRORLEVEL%
)

if "%CMD%"=="clean" (
    make clean
    exit /b %ERRORLEVEL%
)

if "%CMD%"=="flash" (
    make flash
    exit /b %ERRORLEVEL%
)

if "%CMD%"=="status" (
    echo Dossier projet:
    cd
    echo.
    echo Fichiers:
    dir
    exit /b 0
)

echo Commande inconnue: %CMD%
echo Commandes disponibles: make, clean, flash, status
exit /b 1