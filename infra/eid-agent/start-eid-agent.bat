@echo off
REM Lance l'agent eID (serveur PowerShell natif, sans Node) en arriere-plan.
REM -ExecutionPolicy Bypass : contourne la strategie Restricted sans rien changer au systeme.
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0server-eid.ps1"
