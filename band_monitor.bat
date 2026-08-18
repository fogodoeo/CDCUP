@echo off
setlocal
chcp 65001 >nul
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "PYTHONDONTWRITEBYTECODE=1"
cd /d "%~dp0"

set "PY_CMD="

py -3.13 -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 13) else 1)" >nul 2>nul
if %errorlevel%==0 (
    set "PY_CMD=py -3.13"
    goto have_python
)

python -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 13) else 1)" >nul 2>nul
if %errorlevel%==0 (
    set "PY_CMD=python"
    goto have_python
)

echo =======================================================
echo [ERROR] Python 3.13 is required for this restored app.
echo Please install Python 3.13 for Windows to run this app.
echo Opening Python Download Page...
echo =======================================================
start https://www.python.org/downloads/windows/
pause
exit /b 1

:have_python
echo Checking and installing required packages...
%PY_CMD% -c "import PyQt5, requests, websocket, gspread, google.auth, selenium, niimprint, bleak, PIL, serial" >nul 2>nul
if not %errorlevel%==0 (
    echo Installing missing packages...
    %PY_CMD% -m pip install -r requirements.txt -q
)
echo Starting Band Monitor App...
%PY_CMD% band_monitor_app.py

:finish
set "APP_EXIT=%ERRORLEVEL%"
echo.
echo =========================================
echo Exit Code: %APP_EXIT%
echo Press any key to close...
echo =========================================
pause
exit /b %APP_EXIT%
