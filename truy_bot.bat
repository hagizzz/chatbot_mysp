@echo off
REM ===== TRUY TIM TIEN TRINH NAO TRA LOI HOI THOAI =====
REM Cach dung:  truy_bot.bat  CONV_ID
REM Vi du:      truy_bot.bat  1468690110033030_1234567890
if "%~1"=="" (
  echo Thieu CONV_ID. Vi du:  truy_bot.bat 1468690110033030_1234567890
  pause & exit /b
)
if not exist C:\botlog mkdir C:\botlog
echo ===== PM2 DANG CHAY NHUNG GI ===== > C:\botlog\truybot.txt
pm2 ls >> C:\botlog\truybot.txt 2>&1
echo. >> C:\botlog\truybot.txt
echo ===== CAC FILE LOG PM2 TREN MAY ===== >> C:\botlog\truybot.txt
dir C:\Users\Admin\.pm2\logs >> C:\botlog\truybot.txt
echo. >> C:\botlog\truybot.txt
echo ===== CONV %1 XUAT HIEN TRONG LOG NAO (log nao chua = tien trinh do xu) ===== >> C:\botlog\truybot.txt
findstr /m /c:"%~1" C:\Users\Admin\.pm2\logs\*.log >> C:\botlog\truybot.txt 2>&1
echo. >> C:\botlog\truybot.txt
echo ===== CAU FALLBACK NAM TRONG LOG NAO (100 dong cuoi moi file) ===== >> C:\botlog\truybot.txt
findstr /m /c:"quan tam mau nao ben em bao gia" C:\Users\Admin\.pm2\logs\*.log >> C:\botlog\truybot.txt 2>&1
findstr /m /c:"quan tâm mẫu nào bên em báo giá" C:\Users\Admin\.pm2\logs\*.log >> C:\botlog\truybot.txt 2>&1
notepad C:\botlog\truybot.txt
