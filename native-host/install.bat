@echo off
REM Native Messaging Host Installer for Obsidian Web Clipper
REM Supports: Windows 10/11
REM
REM Usage: install.bat --extension-id <id> [--browser chrome|chromium|brave|edge]
REM

setlocal EnableDelayedExpansion

set "HOST_NAME=com.t3rpz.obsidian_web_clipper"
set "BROWSER=chrome"
set "EXTENSION_ID="
set "UNINSTALL=0"
set "SCRIPT_DIR=%~dp0"

REM Parse arguments
:parse_args
if "%~1"=="" goto :done_parsing
if /i "%~1"=="--extension-id" (
    set "EXTENSION_ID=%~2"
    shift
    shift
    goto :parse_args
)
if /i "%~1"=="--browser" (
    set "BROWSER=%~2"
    shift
    shift
    goto :parse_args
)
if /i "%~1"=="--uninstall" (
    set "UNINSTALL=1"
    shift
    goto :parse_args
)
if /i "%~1"=="--help" goto :show_usage
if /i "%~1"=="-h" goto :show_usage
echo [ERROR] Unknown option: %~1
goto :show_usage

:done_parsing

REM Uninstall mode
if "%UNINSTALL%"=="1" goto :do_uninstall

REM Validate extension ID
if "%EXTENSION_ID%"=="" (
    echo [ERROR] Extension ID is required. Use --extension-id ^<id^>
    echo.
    goto :show_usage
)

REM Check for bun
where bun >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Bun is required but not installed.
    echo [INFO] Install bun: https://bun.sh
    exit /b 1
)

for /f "tokens=*" %%i in ('bun --version') do set "BUN_VERSION=%%i"
echo [INFO] Bun version: %BUN_VERSION%

REM Set browser-specific registry path
set "REG_ROOT=HKCU\Software\Google\Chrome\NativeMessagingHosts"

if /i "%BROWSER%"=="chrome" (
    set "REG_ROOT=HKCU\Software\Google\Chrome\NativeMessagingHosts"
) else if /i "%BROWSER%"=="chromium" (
    set "REG_ROOT=HKCU\Software\Chromium\NativeMessagingHosts"
) else if /i "%BROWSER%"=="brave" (
    set "REG_ROOT=HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts"
) else if /i "%BROWSER%"=="edge" (
    set "REG_ROOT=HKCU\Software\Microsoft\Edge\NativeMessagingHosts"
) else (
    echo [ERROR] Unsupported browser: %BROWSER%
    echo [INFO] Supported browsers: chrome, chromium, brave, edge
    exit /b 1
)

echo [INFO] Browser: %BROWSER%
echo [INFO] Registry path: %REG_ROOT%\%HOST_NAME%

REM Create host binary directory
set "HOST_BIN_DIR=%LOCALAPPDATA%\ObsidianWebClipper"
set "HOST_BIN_PATH=%HOST_BIN_DIR%\host.exe"

echo [INFO] Creating host binary directory...
if not exist "%HOST_BIN_DIR%" mkdir "%HOST_BIN_DIR%"

REM Compile host.ts to standalone executable
echo [INFO] Compiling native messaging host...
pushd "%SCRIPT_DIR%"
bun build --compile --windows-hide-console --outfile="%HOST_BIN_PATH%" ./host.ts
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to compile host
    popd
    exit /b 1
)
popd

echo [SUCCESS] Created host binary: %HOST_BIN_PATH%

REM Create manifest directory and file
set "MANIFEST_DIR=%HOST_BIN_DIR%"
set "MANIFEST_PATH=%MANIFEST_DIR%\%HOST_NAME%.json"

REM Escape backslashes for JSON
set "HOST_PATH_ESCAPED=%HOST_BIN_PATH:\=\\%"

REM Generate manifest JSON
echo [INFO] Creating manifest...
(
echo {
echo   "name": "%HOST_NAME%",
echo   "description": "Native messaging host for Obsidian Web Clipper - enables direct CLI integration for saving clips to Obsidian vaults",
echo   "path": "%HOST_PATH_ESCAPED%",
echo   "type": "stdio",
echo   "allowed_origins": [
echo     "chrome-extension://%EXTENSION_ID%/"
echo   ]
echo }
) > "%MANIFEST_PATH%"

echo [SUCCESS] Created manifest: %MANIFEST_PATH%

REM Create registry key pointing to manifest
echo [INFO] Creating registry entry...
reg add "%REG_ROOT%\%HOST_NAME%" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to create registry entry
    exit /b 1
)

echo [SUCCESS] Created registry entry

REM Verify installation
echo [INFO] Verifying installation...

if exist "%HOST_BIN_PATH%" (
    echo [SUCCESS] Host binary exists
) else (
    echo [ERROR] Host binary not found
    exit /b 1
)

if exist "%MANIFEST_PATH%" (
    echo [SUCCESS] Manifest file exists
) else (
    echo [ERROR] Manifest file not found
    exit /b 1
)

REM Print summary
echo.
echo ==========================================
echo [SUCCESS] Native Messaging Host Installed Successfully!
echo ==========================================
echo.
echo Host binary: %HOST_BIN_PATH%
echo Manifest:    %MANIFEST_PATH%
echo Extension:   %EXTENSION_ID%
echo.
echo Next steps:
echo   1. Restart %BROWSER% if it's running
echo   2. Open the Obsidian Web Clipper extension
echo   3. Go to Settings -^> Obsidian CLI
echo   4. Enable 'Use Obsidian CLI' and configure your vault
echo.
echo [INFO] To uninstall, run: %~nx0 --uninstall

exit /b 0

:do_uninstall
echo [INFO] Uninstalling native messaging host...

REM Remove registry key
reg delete "%REG_ROOT%\%HOST_NAME%" /f >nul 2>&1
echo [SUCCESS] Removed registry entry

REM Remove files
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

echo [SUCCESS] Uninstall complete!
exit /b 0

:show_usage
echo.
echo Native Messaging Host Installer for Obsidian Web Clipper
echo.
echo Usage: %~nx0 [OPTIONS]
echo.
echo Required:
echo   --extension-id ^<id^>    Chrome extension ID (32 character string)
echo.
echo Optional:
echo   --browser ^<name^>       Target browser: chrome (default), chromium, brave, edge
echo   --uninstall            Remove the native messaging host instead of installing
echo   --help                 Show this help message
echo.
echo Examples:
echo   %~nx0 --extension-id abcdefghijklmnopqrstuvwxyz123456
echo   %~nx0 --extension-id abcdefghijklmnopqrstuvwxyz123456 --browser brave
echo   %~nx0 --uninstall
echo.
echo How to find your extension ID:
echo   1. Open chrome://extensions
echo   2. Enable "Developer mode" (top right)
echo   3. Find "Obsidian Web Clipper" and copy the ID
echo.
echo Supported browsers:
echo   chrome   - Google Chrome (default)
echo   chromium - Chromium
echo   brave    - Brave Browser
echo   edge     - Microsoft Edge
exit /b 1
