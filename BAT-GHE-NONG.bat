@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies, please wait 1-2 minutes...
  call npm.cmd install
)
set LIVE_MODE=1
rem Tat hoan toan API gia lap (/api/sim/*) khi live that
set DISABLE_SIM=1
set PORT=3008
start "" cmd /c "timeout /t 4 >nul & start http://localhost:3008"
:chay
call npm.cmd run dev
echo.
echo [%date% %time%] Server stopped, restarting in 5 seconds... (Close this window to exit)
timeout /t 5 >nul
goto chay
