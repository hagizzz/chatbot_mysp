@echo off
chcp 65001 >nul
REM ============================================================
REM  Don anh rac + cap nhat ten/mau cho index (theo Drive hien tai)
REM  - Xoa entry anh da xoa tren Drive khoi clip_index.npz + hash_index.json
REM  - Cap nhat ten/mau, GIU pancakeId, KHONG re-embed
REM  NHO: da TAT BOT truoc khi chay file nay!
REM ============================================================
cd /d "%~dp0"

echo ============================================================
echo   DANG SAO LUU clip_index.npz + hash_index.json ...
echo ============================================================
if exist clip_index.npz copy /y clip_index.npz clip_index.npz.bak >nul
if exist hash_index.json copy /y hash_index.json hash_index.json.bak >nul
echo Da sao luu (.bak).
echo.

echo ============================================================
echo   DANG CHAY refresh_names.py --prune ...
echo ============================================================
python refresh_names.py --prune
if errorlevel 1 (
  echo.
  echo [LOI] Chay that bai. Kiem tra: da cai thu vien chua?
  echo        pip install google-api-python-client google-auth numpy pillow
  echo        va file google-service-account.json co trong thu muc nay khong.
  echo.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   XONG! Gio mo lai bot:  node bot_worker_api_v3.js
echo ============================================================
pause
