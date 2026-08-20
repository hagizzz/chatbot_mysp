@echo off
chcp 65001 >nul
title TRA LOG - vi sao gan the AI-CHO XL
setlocal

:: ====== SUA 2 DONG NAY NEU CAN ======
set "PSID=27955912500661896"
set "LOG=%USERPROFILE%\.pm2\logs\bot-out.log"
:: ====================================

set "OUT=%USERPROFILE%\Desktop\TRA_LOG_KHACH.txt"

if not exist "%LOG%" (
  echo [X] KHONG THAY FILE LOG: "%LOG%"
  echo     Dang tim bot-out.log tren o C... doi chut.
  where /r C:\ bot-out.log
  echo.
  echo Neu tim thay o tren, sua dong  set "LOG=..."  trong file .bat nay cho dung.
  pause
  exit /b
)

echo Dang loc log... (co the mat vai giay neu file to)
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$log='%LOG%'; $psid='%PSID%'; $out='%OUT%';" ^
  "$lines = Get-Content -LiteralPath $log -Encoding UTF8;" ^
  "$res = New-Object System.Collections.Generic.List[string];" ^
  "$res.Add('========================================================');" ^
  "$res.Add('  (1) MOI LAN BOT TU GAN THE  (dong  TAG AI-...)');" ^
  "$res.Add('========================================================');" ^
  "for($i=0;$i -lt $lines.Count;$i++){ if($lines[$i] -match 'TAG AI-|UNREAD:'){ $a=[Math]::Max(0,$i-2); for($j=$a;$j -le $i;$j++){ $res.Add(('{0,6}: {1}' -f ($j+1), $lines[$j])) }; $res.Add('---') } };" ^
  "$res.Add('');" ^
  "$res.Add('========================================================');" ^
  "$res.Add(('  (2) MOI DONG CUA KHACH  psid=' + $psid) );" ^
  "$res.Add('     (kem 6 dong ngay TRUOC de thay bot QUYET DINH gi)');" ^
  "$res.Add('========================================================');" ^
  "for($i=0;$i -lt $lines.Count;$i++){ if($lines[$i] -match [regex]::Escape($psid)){ $a=[Math]::Max(0,$i-6); for($j=$a;$j -le $i;$j++){ $res.Add(('{0,6}: {1}' -f ($j+1), $lines[$j])) }; $res.Add('---') } };" ^
  "Set-Content -LiteralPath $out -Value $res -Encoding UTF8;" ^
  "Write-Host ('Xong. Da ghi ' + $res.Count + ' dong ra: ' + $out)"

echo.
echo Mo file ket qua...
start "" notepad "%OUT%"
echo.
pause
