@echo off
REM Démarre l'agent eID local. À placer sur le PC comptoir et lancer au boot
REM via le Planificateur de tâches Windows (tâche "EidAgent", au démarrage).
cd /d "%~dp0"
node server.js
