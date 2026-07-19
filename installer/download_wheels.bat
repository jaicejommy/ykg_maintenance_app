@echo off
REM ── installer\download_wheels.bat ────────────────────────────────────────────
REM Run this script ONCE on a machine with internet access before building
REM the Inno Setup installer. It downloads all required Python packages
REM as wheel files into the installer\wheels\ directory.
REM
REM Requirements:
REM   - Python 3.11 installed on this machine
REM   - Internet access
REM
REM Usage:
REM   Double-click this file, or run from Command Prompt:
REM   cd installer
REM   download_wheels.bat

echo ============================================================
echo  Maintenance Management System — Wheel Pre-Downloader
echo ============================================================
echo.
echo This script downloads all required Python packages for
echo offline installation. Run this on a machine with internet
echo access before building the installer.
echo.

REM Create the wheels output directory
if not exist "wheels\" mkdir wheels

REM Confirm Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH.
    echo Please install Python 3.11 and try again.
    pause
    exit /b 1
)

echo Downloading wheels for all dependencies...
echo This may take a few minutes depending on your connection.
echo.

REM Download all packages listed in requirements.txt
REM --platform win_amd64 ensures Windows-compatible wheels are downloaded
REM even if this script is run on a non-Windows machine
python -m pip download ^
    --dest wheels ^
    --platform win_amd64 ^
    --python-version 3.11 ^
    --only-binary :all: ^
    -r ..\backend\requirements.txt

if errorlevel 1 (
    echo.
    echo WARNING: Some packages could not be downloaded as binary wheels.
    echo Attempting download without platform restriction...
    python -m pip download ^
        --dest wheels ^
        -r ..\backend\requirements.txt
)

echo.
echo ============================================================
echo  Download complete. Wheels saved to: installer\wheels\
echo ============================================================
echo.
echo You can now compile the installer using Inno Setup.
echo See installer\README_INSTALLER.txt for full instructions.
echo.
pause
