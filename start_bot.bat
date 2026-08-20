@echo off
chcp 65001 >nul
title MYS.P BOT
cd /d "%~dp0"

:start
:: Neu dang DONG BO ANH (co file stop_bot.flag) thi CHO, khong mo bot (tranh ghi de file).
:waitflag
if exist "stop_bot.flag" (
  echo [%time%] Dang dong bo anh... cho xong roi moi mo bot lai.
  timeout /t 5 /nobreak >nul
  goto waitflag
)

echo ============================================
echo   KHOI DONG BOT luc %date% %time%
echo ============================================
node bot_worker_api_v3.js

echo.
echo !!! Bot da dung lai. Tu khoi dong lai sau 5 giay...
echo     (Muon tat han: dong cua so nay)
timeout /t 5 /nobreak >nul
goto start
