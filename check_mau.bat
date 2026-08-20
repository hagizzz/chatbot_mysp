@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo    KIEM TRA ANH THEO MAU (MGKSQ6309 - nau vang)
echo ============================================
echo.
node check_mau.js MGKSQ6309 "nau vang"
echo.
echo --------------------------------------------
echo  Xong. Chup man hinh ket qua phia tren gui lai nhe.
echo  (Muon kiem tra ma khac: sua dong "node check_mau.js ..." o tren)
echo --------------------------------------------
pause
