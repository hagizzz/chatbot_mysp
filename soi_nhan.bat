@echo off
chcp 65001 >nul
cd /d C:\AI_HTK_BOT_V5
echo ============================================================
echo  SOI NHAN HOI THOAI - dang chay...
echo  (khong dung toi bot dang chay, chi DOC)
echo ============================================================
echo.

rem  Tham so 1 = conversation_id (bo trong -> mac dinh hoi thoai trong link ban gui)
node cong_cu\soi_nhan.js %1 > soi_nhan_log.txt 2>&1

echo.
echo ==== KET QUA (da luu vao soi_nhan_log.txt) ====
echo.
type soi_nhan_log.txt
echo.
echo ------------------------------------------------------------
echo  Xong. Gui file  C:\AI_HTK_BOT_V5\soi_nhan_log.txt  cho minh nhe.
echo ------------------------------------------------------------
pause
