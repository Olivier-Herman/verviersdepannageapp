@echo off
REM Lance l'ecran comptoir en mode KIOSQUE plein ecran (Edge) : pas de croix,
REM pas de barre, pas de navigation. Pour sortir : Alt+F4 ou Ctrl+Alt+Suppr.
REM Astuce : copiez ce .bat dans le dossier Demarrage pour un lancement auto au boot
REM   (Executer -> shell:startup -> collez un raccourci de ce fichier).
start "" msedge --kiosk "https://app.verviersdepannage.com/caisse/ecran/facturation?eid=http://127.0.0.1:7181/read" --edge-kiosk-type=fullscreen --no-first-run --kiosk-idle-timeout-minutes=0
