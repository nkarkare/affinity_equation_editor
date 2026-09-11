@echo off
REM ===========================================================
REM  Affinity Equation Editor — double-click this file.
REM
REM  It installs anything that is missing, fetches the newest
REM  version, and starts the maths server.
REM
REM  Options (drag the file into a terminal to use them):
REM     "Start Equation Editor.bat" --debug     log every render
REM     "Start Equation Editor.bat" --trace     log even more
REM     "Start Equation Editor.bat" --setup     set up, do not start
REM ===========================================================

setlocal

set "PS_ARGS="
:parse
if "%~1"=="" goto run
if /I "%~1"=="--debug"  set "PS_ARGS=%PS_ARGS% -Debug"
if /I "%~1"=="--trace"  set "PS_ARGS=%PS_ARGS% -Trace"
if /I "%~1"=="--setup"  set "PS_ARGS=%PS_ARGS% -NoStart"
shift
goto parse

:run
REM Prefer the bootstrap next to this file; fall back to the installed copy so
REM this .bat keeps working even on its own.
set "BOOT=%~dp0launcher\bootstrap.ps1"
if not exist "%BOOT%" set "BOOT=%LOCALAPPDATA%\AffinityEquationEditor\app\launcher\bootstrap.ps1"

if not exist "%BOOT%" (
    echo.
    echo   Could not find launcher\bootstrap.ps1
    echo.
    echo   Download the project again from:
    echo   https://github.com/nkarkare/affinity_equation_editor
    echo.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%BOOT%"%PS_ARGS%
if errorlevel 1 (
    echo.
    echo   Something went wrong. The message above says what.
    pause
)

endlocal
