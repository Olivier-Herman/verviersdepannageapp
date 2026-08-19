@echo off
REM ============================================================
REM  Agent Scan VD Soft — DIAGNOSTIC
REM  Lance l'agent DANS CETTE FENETRE (pas en arriere-plan) : toute erreur
REM  reste affichee. A utiliser quand VD Soft dit « agent non detecte ».
REM  Fermer la fenetre arrete l'agent.
REM ============================================================
setlocal
set "DIR=%~dp0"

echo.
echo === Diagnostic agent Scan VD Soft ===
echo Dossier : %DIR%
echo.

echo [1] Contenu du dossier
if exist "%DIR%server-scan.ps1" (echo     [OK] server-scan.ps1 present) else (echo     [!!] server-scan.ps1 INTROUVABLE - le zip a-t-il ete decompresse ?)
if exist "%DIR%config.json"     (echo     [OK] config.json present  & type "%DIR%config.json") else (echo     [!!] config.json absent - relancez install-autostart.bat)
echo.

echo [2] Un agent tourne-t-il deja ?
netstat -ano | findstr ":7182" | findstr "LISTENING"
if %ERRORLEVEL%==0 (echo     [OK] Quelque chose ecoute deja sur 7182.) else (echo     [i] Personne n'ecoute sur 7182 - c'est bien le probleme.)
echo.

echo [3] Tache planifiee
schtasks /Query /TN "VDSoft Scan Agent" 2>nul | findstr /i "VDSoft"
if %ERRORLEVEL% NEQ 0 echo     [!!] Tache absente - install-autostart.bat n'a pas ete lance EN ADMINISTRATEUR.
echo.

echo [4] Demarrage de l'agent dans cette fenetre.
echo     Laissez cette fenetre OUVERTE, puis rechargez la page VD Soft.
echo     Test direct : http://localhost:7182/health
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%DIR%server-scan.ps1"

echo.
echo L'agent s'est arrete. Le message ci-dessus dit pourquoi.
pause
