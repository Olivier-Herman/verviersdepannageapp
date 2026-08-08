@echo off
REM ============================================================
REM  Agent eID VD Soft — installation (SANS Node, sans npm)
REM  A lancer en tant qu'administrateur (clic droit > Executer en administrateur)
REM ============================================================
setlocal
set "DIR=%~dp0"

echo.
echo === Installation de l'agent eID VD Soft ===
echo.

REM 1) Reservation de l'URL locale : permet au serveur (utilisateur normal)
REM    d'ecouter sur le port 7181 sans etre administrateur.
netsh http add urlacl url=http://localhost:7181/  user=Tout^ le^ monde >nul 2>&1
netsh http add urlacl url=http://localhost:7181/  user=Everyone       >nul 2>&1
netsh http add urlacl url=http://127.0.0.1:7181/  user=Everyone       >nul 2>&1

REM 2) Demarrage automatique a l'ouverture de session (tache planifiee, cachee).
schtasks /Create /TN "VDSoft eID Agent" /SC ONLOGON /RL HIGHEST /F ^
  /TR "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%DIR%server-eid.ps1\"" >nul 2>&1
if %ERRORLEVEL%==0 (echo [OK] Demarrage automatique installe.) else (echo [!] Tache planifiee non creee - l'agent demarrera quand meme via ce .bat.)

REM 3) Demarre l'agent maintenant.
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%DIR%server-eid.ps1"

echo.
echo [OK] Agent eID demarre.
echo     Test : ouvrez  http://localhost:7181/health  dans le navigateur (carte inseree).
echo.
pause
