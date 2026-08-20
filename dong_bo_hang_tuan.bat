@echo off
chcp 65001 >nul
cd /d "%~dp0"

:: ============================================================
:: DONG BO HANG TUAN (tu dong qua Task Scheduler)
::  Giong hang ngay, NHUNG buoc cuoi UP LAI TOAN BO content_id
::  (--refresh) de content_id khong het han -> anh khong bao gio vo.
::  Chay LAU (vai chuc phut - hon tieng), nen dat luc dem.
:: ============================================================

echo. > stop_bot.flag

echo ============================================================ >> dong_bo_log.txt
echo [%date% %time%] BAT DAU dong bo HANG TUAN (REFRESH)         >> dong_bo_log.txt

taskkill /IM node.exe /F >nul 2>&1
timeout /t 3 /nobreak >nul

echo --- update_index (them anh moi) ---       >> dong_bo_log.txt
python update_index.py                         >> dong_bo_log.txt 2>&1

echo --- refresh_names (ten/mau) ---           >> dong_bo_log.txt
python refresh_names.py                        >> dong_bo_log.txt 2>&1

echo --- upload_to_pancake --refresh (TAT CA) ---  >> dong_bo_log.txt
python upload_to_pancake.py --refresh          >> dong_bo_log.txt 2>&1

echo [%date% %time%] XONG dong bo HANG TUAN                      >> dong_bo_log.txt

del stop_bot.flag >nul 2>&1
exit
