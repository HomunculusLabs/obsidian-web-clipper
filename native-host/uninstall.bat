@echo off
REM Native Messaging Host Uninstaller for Obsidian Web Clipper
REM Supports: Windows 10/11
REM
REM Usage: uninstall.bat [--browser chrome|chromium|brave|edge|--all]
REM

setlocal EnableDelayedExpansion

set "HOST_NAME=com.t3rpz.obsidian_web_clipper"
set "BROWSER=chrome"
set "REMOVE_ALL=0"
set "SCRIPT_DIR=%~dp0"

REM Parse arguments
:parse_args
if "%~1"=="" goto :done_parsing
if /i "%~1"=="--browser" (
    set "BROWSER=%~2"
    shift
    shift
    goto :parse_args
)
if /i "%~1"=="--all" (
    set "REMOVE_ALL=1"
    shift
    goto :parse_args
)
if /i "%~1"=="--help" goto :show_usage
if /i "%~1"=="-h" goto :show_usage
echo [ERROR] Unknown option: %~1
goto :show_usage

:done_parsing

echo.
echo ==========================================
echo   Obsidian Web Clipper - Native Host Uninstaller
echo ==========================================
echo.

REM Function to uninstall from a specific browser
set "UNINSTALLED_ANY=0"

if "%REMOVE_ALL%"=="1" (
    echo [INFO] Removing from all browsers...
    call :uninstall_browser chrome
    call :uninstall_browser chromium
    call :uninstall_browser brave
    call :uninstall_browser edge
) else (
    echo [INFO] Browser: %BROWSER%
    call :uninstall_browser %BROWSER%
)

REM Remove shared host binary
set "HOST_BIN_DIR=%LOCALAPPDATA%\ObsidianWebClipper"
if exist "%HOST_BIN_DIR%\host.exe" (
    del /q "%HOST_BIN_DIR%\host.exe"
    echo [SUCCESS] Removed host binary
)

if exist "%HOST_BIN_DIR%\%HOST_NAME%.json" (
    del /q "%HOST_BIN_DIR%\%HOST_NAME%.json"
    echo [SUCCESS] Removed manifest
)

REM Try to remove directory if empty
if exist "%HOST_BIN_DIR%" (
    rmdir "%HOST_BIN_DIR%" 2>nul
    if exist "%HOST_BIN_DIR%" (
        echo [INFO] Directory not empty, keeping: %HOST_BIN_DIR%
    ) else (
        echo [INFO] Removed directory: %HOST_BIN_DIR%
    )
)

echo.
echo ==========================================
echo [SUCCESS] Uninstall Complete!
echo ==========================================
echo.
echo The native messaging host has been removed.
echo Restart your browser(s) to complete the cleanup.
echo.

exit /b 0

:uninstall_browser
set "BROWSER_NAME=%~1"
set "REG_ROOT="

if /i "%BROWSER_NAME%"=="chrome" (
    set "REG_ROOT=HKCU\Software\Google\Chrome\NativeMessagingHosts"
) else if /i "%BROWSER_NAME%"=="chromium" (
    set "REG_ROOT=HKCU\Software\Chromium\NativeMessagingHosts"
) else if /i "%BROWSER_NAME%"=="brave" (
    set "REG_ROOT=HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts"
) else if /i "%BROWSER_NAME%"=="edge" (
    set "REG_ROOT=HKCU\Software\Microsoft\Edge\NativeMessagingHosts"
) else (
    echo [ERROR] Unsupported browser: %BROWSER_NAME%
    exit /b 1
)

echo [INFO] Checking %BROWSER_NAME%...

REM Check if registry key exists
reg query "%REG_ROOT%\%HOST_NAME%" >nul 2>&1
if %ERRORLEVEL% equ 0 (
    reg delete "%REG_ROOT%\%HOST_NAME%" /f >nul 2>&1
    echo [SUCCESS] Removed registry entry for %BROWSER_NAME%
) else (
    echo [WARNING] Registry entry not found for %BROWSER_NAME%
)

exit /b 0

:show_usage
echo.
echo Native Messaging Host Uninstaller for Obsidian Web Clipper
echo.
echo Usage: %~nx0 [OPTIONS]
echo.
echo Optional:
echo   --browser ^<name^>       Target browser: chrome (default), chromium, brave, edge
echo   --all                  Remove from all installed browsers
echo   --help                 Show this help message
echo.
echo Examples:
echo   %~nx0
echo   %~nx0 --browser brave
echo   %~nx0 --all
echo.
echo Supported browsers:
echo   chrome   - Google Chrome (default)
echo   chromium - Chromium
echo   brave    - Brave Browser
echo   edge     - Microsoft Edge
exit /b 1
