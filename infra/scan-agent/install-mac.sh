#!/bin/bash
# install-mac.sh — Agent Scan VD Soft sur macOS (et Linux avec systemd, cf. README).
#
# Installe l'agent Node en service utilisateur : il démarre à l'ouverture de
# session et redémarre tout seul s'il tombe. Aucune dépendance à installer,
# Node 18+ suffit.
#
#   ./install-mac.sh 192.168.1.50
#   ./install-mac.sh              (demande l'IP)

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
LABEL="com.vdsoft.scan-agent"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

PRINTER="$1"
if [ -z "$PRINTER" ]; then
  read -r -p "Adresse IP de l'imprimante (ex. 192.168.1.50) : " PRINTER
fi
[ -z "$PRINTER" ] && { echo "[!] Sans adresse IP, l'agent ne peut rien scanner."; exit 1; }

NODE="$(command -v node || true)"
[ -z "$NODE" ] && { echo "[!] Node introuvable. Installe Node 18+ (brew install node) puis relance."; exit 1; }

cat > "$DIR/config.json" <<JSON
{
  "printerHost": "$PRINTER",
  "wiaNameLike": "Canon",
  "defaultSource": "adf",
  "defaultDpi": 300
}
JSON
echo "[OK] Imprimante enregistrée : $PRINTER"

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLISTXML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$DIR/scan-agent.mjs</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/agent-log.txt</string>
  <key>StandardErrorPath</key><string>$DIR/agent-log.txt</string>
</dict>
</plist>
PLISTXML

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load  "$PLIST"
echo "[OK] Agent installé et démarré (redémarre à chaque ouverture de session)."

sleep 1
echo
echo "--- http://localhost:7182/health ---"
curl -s http://localhost:7182/health || echo "[!] Pas de réponse — voir agent-log.txt"
echo
echo
echo "Pour désinstaller : launchctl unload \"$PLIST\" && rm \"$PLIST\""
