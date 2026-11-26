@echo off
chcp 65001 >nul
echo ساخت فایل EXE (نیاز به Node.js و اینترنت)
cd /d "%~dp0windows"
call npm install
if errorlevel 1 goto err
call npm run dist
if errorlevel 1 goto err
echo.
echo تمام شد. فایل‌ها در پوشهٔ build-kits\windows\dist هستند.
explorer "%~dp0windows\dist"
pause & exit /b
:err
echo خطا رخ داد؛ پیام‌های بالا را بررسی کنید.
pause
