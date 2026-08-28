@echo off
chcp 65001 >nul
cd /d "%~dp0"

:: ============================================================
:: DONG BO HANG NGAY (tu dong qua Task Scheduler)
::  1) Bao bot tam dung (tao co stop_bot.flag)
::  2) Tat bot dang chay
::  3) Them anh MOI + cap nhat TEN/MAU + up anh moi len Pancake
::  4) Xoa co -> start_bot.bat tu mo bot lai
:: Moi lan chay ghi log vao dong_bo_log.txt
:: ============================================================

echo. > stop_bot.flag

echo ============================================================ >> dong_bo_log.txt
echo [%date% %time%] BAT DAU dong bo HANG NGAY                   >> dong_bo_log.txt

taskkill /IM node.exe /F >nul 2>&1
timeout /t 3 /nobreak >nul

echo --- update_index (them anh moi) ---   >> dong_bo_log.txt
python python\update_index.py                     >> dong_bo_log.txt 2>&1

echo --- refresh_names (ten/mau) ---       >> dong_bo_log.txt
python python\refresh_names.py                    >> dong_bo_log.txt 2>&1

echo --- upload_to_pancake (anh moi) ---   >> dong_bo_log.txt
python python\upload_to_pancake.py                >> dong_bo_log.txt 2>&1

echo [%date% %time%] XONG dong bo HANG NGAY                      >> dong_bo_log.txt

del stop_bot.flag >nul 2>&1
exit
