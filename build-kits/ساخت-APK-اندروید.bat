@echo off
chcp 65001 >nul
echo ساخت پروژهٔ اندروید (نیاز به Node.js، JDK 17 و Android Studio)
cd /d "%~dp0android"
call npm install
if errorlevel 1 goto err
call npm run prepare-web
if not exist android call npx cap add android
call node apply-icons.js
rem افزودن کد بومی آلارم و بی‌صدا
call node apply-native.js
call npx cap sync android
cd android
call gradlew.bat assembleDebug
if errorlevel 1 goto err
echo.
echo تمام شد: build-kits\android\android\app\build\outputs\apk\debug\app-debug.apk
explorer "%~dp0android\android\app\build\outputs\apk\debug"
pause & exit /b
:err
echo خطا رخ داد؛ پیام‌های بالا را بررسی کنید.
pause
