@echo off
REM ============================================================
REM  Agent eID VD Soft — installation (SANS Node, sans npm)
REM  A lancer en tant qu'administrateur (clic droit > Executer en administrateur)
REM
REM  L'agent demarre au BOOT du PC en tant que SYSTEM -> disponible pour TOUS les
REM  comptes, y compris une borne / kiosque Assigned Access (qui ne lance pas les
REM  apps de demarrage classiques).
REM ============================================================
setlocal
set "DIR=%~dp0"

echo.
echo === Installation de l'agent eID VD Soft ===
echo.

REM 1) Reservation de l'URL locale (permet l'ecoute sur 7181 pour tous).
netsh http add urlacl url=http://localhost:7181/  user=Everyone >nul 2>&1
netsh http add urlacl url=http://127.0.0.1:7181/  user=Everyone >nul 2>&1

REM 2) Tache planifiee : demarre l'agent AU DEMARRAGE du PC, en tant que SYSTEM
REM    (disponible meme sous une borne / autre compte).
schtasks /Delete /TN "VDSoft eID Agent" /F >nul 2>&1
schtasks /Create /TN "VDSoft eID Agent" /SC ONSTART /RU SYSTEM /RL HIGHEST /F ^
  /TR "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%DIR%server-eid.ps1\"" >nul 2>&1
if %ERRORLEVEL%==0 (echo [OK] Agent installe au demarrage du PC ^(SYSTEM^).) else (echo [!] Tache non creee - relancez en administrateur.)

REM 3) Demarre l'agent maintenant (en tant que SYSTEM, via la tache).
schtasks /Run /TN "VDSoft eID Agent" >nul 2>&1

echo.
echo [OK] Agent eID demarre.
echo     Test : http://localhost:7181/health   puis   http://localhost:7181/read  ^(carte inseree^).
echo.
pause
