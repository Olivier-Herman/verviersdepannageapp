@echo off
REM ============================================================
REM  Agent Scan VD Soft — installation (SANS Node, sans npm)
REM  A lancer en tant qu'administrateur (clic droit > Executer en administrateur)
REM ============================================================
setlocal
set "DIR=%~dp0"

echo.
echo === Installation de l'agent Scan VD Soft ===
echo.

REM 1) Adresse IP de l'imprimante (laisser vide = passer par le pilote Windows).
set /p PRINTER="Adresse IP de l'imprimante (ex. 192.168.1.50, vide = pilote Windows) : "
if not "%PRINTER%"=="" (
  > "%DIR%config.json" echo {
  >>"%DIR%config.json" echo   "printerHost": "%PRINTER%",
  >>"%DIR%config.json" echo   "wiaNameLike": "Canon",
  >>"%DIR%config.json" echo   "defaultSource": "adf",
  >>"%DIR%config.json" echo   "defaultDpi": 300
  >>"%DIR%config.json" echo }
  echo [OK] Imprimante enregistree : %PRINTER%
)

REM 2) Reservation de l'URL locale (ecoute sur 7182 pour tous les comptes).
netsh http add urlacl url=http://localhost:7182/  user=Everyone >nul 2>&1
netsh http add urlacl url=http://127.0.0.1:7182/  user=Everyone >nul 2>&1

REM 3) Tache planifiee : demarre l'agent AU DEMARRAGE du PC, en tant que SYSTEM.
schtasks /Delete /TN "VDSoft Scan Agent" /F >nul 2>&1
schtasks /Create /TN "VDSoft Scan Agent" /SC ONSTART /RU SYSTEM /RL HIGHEST /F ^
  /TR "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%DIR%server-scan.ps1\"" >nul 2>&1
if %ERRORLEVEL%==0 (echo [OK] Agent installe au demarrage du PC ^(SYSTEM^).) else (echo [!] Tache non creee - relancez en administrateur.)

schtasks /Run /TN "VDSoft Scan Agent" >nul 2>&1

REM 4) Verification reelle : on interroge l'agent au lieu de l'affirmer.
echo.
echo Verification...
timeout /t 4 /nobreak >nul
powershell -NoProfile -Command "try { $r = Invoke-RestMethod -Uri 'http://localhost:7182/health' -TimeoutSec 8; if ($r.escl -or $r.wia) { Write-Host '[OK] Agent actif — imprimante joignable.' -ForegroundColor Green } else { Write-Host '[!] Agent actif mais imprimante injoignable — verifiez l adresse IP dans config.json.' -ForegroundColor Yellow } } catch { Write-Host '[!!] L agent NE REPOND PAS. Lancez diagnostic.bat pour voir l erreur.' -ForegroundColor Red }"

echo.
echo Journal : %DIR%agent-log.txt
echo En cas de souci : diagnostic.bat (affiche l erreur au lieu de la cacher).
echo.
pause
