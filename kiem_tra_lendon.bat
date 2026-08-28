@echo off
chcp 65001 >nul
title KIEM TRA LEN DON
cd /d "%~dp0"

echo ============================================
echo   KIEM TRA TRUOC KHI LEN DON (preflight)
echo   Chi DOC - khong tao don, khong doi the.
echo ============================================
echo.
node cong_cu\kiem_tra_lendon.js

echo.
echo (Bam phim bat ky de dong cua so nay)
pause >nul
