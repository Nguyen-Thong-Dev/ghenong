@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PATH=C:\Program Files\Git\cmd;C:\Program Files\Git\bin;%PATH%"

git config http.version HTTP/1.1
git config http.postBuffer 524288000

git add -A
git diff --cached --quiet || git commit -m "Cap nhat code GHE NONG"

echo Dang day cap nhat len GitHub (chi day file thay doi)...
git push -u origin main
pause
