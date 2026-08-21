@echo off
chcp 65001 >nul
title MYS.P BOT - CHAY THU (staging)
cd /d "%~dp0"

if not exist ".env" (
  echo [X] Khong tim thay .env — chep .env.example thanh .env roi dien truoc da.
  pause
  exit /b 1
)
if not exist ".env.staging" (
  echo [!] Chua co .env.staging — dang chep tu .env.staging.example ...
  copy ".env.staging.example" ".env.staging" >nul
  echo [!] Da tao .env.staging. Mo ra xem/sua roi chay lai file nay.
  pause
  exit /b 1
)

echo ============================================
echo   CHAY THU (staging) — KHONG TAO DON THAT
echo   ORDER_DRY_RUN=1 · HOA_API_MODE=gia_lap
echo   Ctrl+C de dung
echo ============================================
set BOT_ENV=staging
node bot_worker_api_v3.js

echo.
echo !!! Bot da dung. KHONG tu mo lai (day la ban chay thu).
pause
