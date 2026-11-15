@echo off
chcp 65001 >nul
rem Mo san khau GHE NONG trong cua so rieng (dung cho TikTok LIVE Studio - Window Capture)
rem Cua so ti le 9:16, khong thanh dia chi/tab de LIVE Studio quay sach.
set URL=http://localhost:3008/?view=stage
set W=540
set H=960
set EDGE="%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist %EDGE% set EDGE="%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist %EDGE% (
  start "" %EDGE% --app=%URL% --window-size=%W%,%H% --user-data-dir="%TEMP%\ghenong-stage-profile" --autoplay-policy=no-user-gesture-required
) else (
  start "" chrome --app=%URL% --window-size=%W%,%H% --user-data-dir="%TEMP%\ghenong-stage-profile" --autoplay-policy=no-user-gesture-required
)
