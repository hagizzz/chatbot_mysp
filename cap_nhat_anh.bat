@echo off
chcp 65001 >nul
title CAP NHAT ANH - MYS.P
cd /d "%~dp0"

echo ============================================================
echo   CAP NHAT ANH (Drive  -^>  Bot)
echo ------------------------------------------------------------
echo   - Them anh MOI tu Drive
echo   - Cap nhat TEN/MAU da doi (vd: trang -^> kem)
echo   - Up anh moi len Pancake (lay content_id)
echo ============================================================
echo.
echo  !! TRUOC KHI CHAY: hay DONG cua so "MYS.P BOT" dang chay
echo     (de TAT bot, tranh ghi de file trong luc cap nhat).
echo     Neu bot chua mo thi bo qua buoc nay.
echo.
pause
echo.

echo [1/3] Them anh MOI tu Drive vao index nhan dien...
python update_index.py
if errorlevel 1 goto loi
echo.

echo [2/3] Cap nhat TEN / MAU theo Drive hien tai (trang -^> kem)...
python refresh_names.py
if errorlevel 1 goto loi
echo.

echo [3/3] Up anh MOI len Pancake de lay content_id...
python upload_to_pancake.py
if errorlevel 1 goto loi
echo.

echo ============================================================
echo   XONG! Dang mo lai bot...
echo ============================================================
timeout /t 2 /nobreak >nul
start "" start_bot.bat
exit

:loi
echo.
echo ============================================================
echo   CO LOI khi chay 1 buoc o tren. Hay chup man hinh gui ky thuat.
echo   (Thuong gap: thieu google-service-account.json, thieu .env,
echo    hoac chua cai thu vien python.)
echo ============================================================
echo.
pause
