@echo off
REM Lance l'agent Scan (serveur PowerShell natif, sans Node) en arriere-plan.
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0server-scan.ps1"
