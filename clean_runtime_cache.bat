@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3.13 clean_runtime_cache.py
) else (
  python clean_runtime_cache.py
)
pause
