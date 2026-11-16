@echo off
chcp 65001 >nul
rem Mo san khau GHE NONG trong cua so rieng (dung cho TikTok LIVE Studio - Window Capture)
rem Cua so ti le 9:16 toi da theo chieu cao man hinh 1080p, khong thanh dia chi/tab de LIVE Studio quay sach.
set URL=http://localhost:3008/?view=stage
set W=585
set H=1040
set EDGE="%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist %EDGE% set EDGE="%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist %EDGE% (
  start "" %EDGE% --app=%URL% --window-size=%W%,%H% --window-position=1335,0 --user-data-dir="%TEMP%\ghenong-stage-profile" --autoplay-policy=no-user-gesture-required --ignore-gpu-blocklist --enable-gpu-rasterization --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows
) else (
  start "" chrome --app=%URL% --window-size=%W%,%H% --window-position=1335,0 --user-data-dir="%TEMP%\ghenong-stage-profile" --autoplay-policy=no-user-gesture-required --ignore-gpu-blocklist --enable-gpu-rasterization --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows
)
