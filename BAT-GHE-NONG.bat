@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
  echo Lần đầu chạy: đang cài đặt thư viện, vui lòng đợi 1-2 phút...
  call npm install
)
echo ============================================================
echo Đang khởi động game GHẾ NÓNG (v1.0)...
echo - Bảng điều khiển: http://localhost:3008
echo - Sân khấu 9:16  : http://localhost:3008/?view=stage
echo - Link OBS/TikTok: http://lvh.me:3008/?view=stage
echo ============================================================
set LIVE_MODE=1
set PORT=3008
start "" cmd /c "timeout /t 4 >nul & start http://localhost:3008"
:chay
call npm run dev
echo.
echo [%date% %time%] Máy chủ bị dừng, tự động bật lại sau 5 giây... (Đóng cửa sổ này để tắt hẳn)
timeout /t 5 >nul
goto chay
