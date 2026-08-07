@echo off
REM ============================================================
REM  Enregistre l'agent eID en DEMARRAGE AUTOMATIQUE (à chaque
REM  ouverture de session Windows). A lancer UNE FOIS, en tant
REM  qu'administrateur (clic droit → Exécuter en tant qu'admin).
REM ============================================================
setlocal
set "DIR=%~dp0"

REM 1) Installe les dépendances si besoin
if not exist "%DIR%node_modules" (
  echo Installation des dependances (npm install)...
  pushd "%DIR%"
  call npm install
  popd
)

REM 2) Crée/replace la tache planifiee "EidAgent" (au logon)
schtasks /create /tn "EidAgent" /tr "\"%DIR%start-eid-agent.bat\"" /sc onlogon /rl highest /f
if %errorlevel%==0 (
  echo.
  echo [OK] Tache "EidAgent" creee. L'agent demarrera a chaque ouverture de session.
  echo     Demarrage immediat maintenant...
  start "" "%DIR%start-eid-agent.bat"
) else (
  echo.
  echo [ERREUR] Creation de la tache echouee. Relance ce fichier en tant qu'ADMINISTRATEUR.
)
echo.
pause
