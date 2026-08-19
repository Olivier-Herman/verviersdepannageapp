# Agent Scan VD Soft — version PowerShell (SANS Node)

Déclenche un scan sur l'imprimante réseau (Canon MF752Cdw II) depuis un bouton
de VD Soft, et renvoie les pages au navigateur qui les annexe à la fiche.
**Aucune dépendance à installer** : 100 % PowerShell natif de Windows.

## Pourquoi un agent

La fiche VD Soft est servie en HTTPS depuis Vercel : elle ne peut pas parler à
une imprimante en HTTP sur le réseau local. Le navigateur, lui, a le droit
d'appeler `http://localhost` (origine considérée comme sûre). L'agent local fait
le pont — même principe que l'agent eID (port 7181).

## Installation — Windows
1. Dézippez ce dossier où vous voulez (ex. `C:\VDSoft\scan-agent`).
2. Clic droit sur **`install-autostart.bat`** → **Exécuter en tant qu'administrateur**.
   Il demande l'**adresse IP de l'imprimante** (visible sur l'écran de la Canon,
   ou dans Windows > Imprimantes > Propriétés > Ports).
3. Testez dans un navigateur : **http://localhost:7182/health**

```json
{ "ok": true, "printer": "192.168.1.50", "escl": true, "wia": true }
```

- `escl: true` → chemin direct, aucun pilote nécessaire. C'est le bon cas.
- `escl: false, wia: true` → l'agent passera par le pilote Canon de ce PC.
- les deux à `false` → ni l'IP ni le pilote ne répondent : vérifiez `config.json`.

## Installation — macOS (et Linux)

Le paquet PowerShell est Windows uniquement (WIA, tâches planifiées). Sur Mac,
c'est la version Node qui tourne — **même port, même contrat**, donc le bouton
de la fiche ne voit aucune différence. Seul le repli WIA n'existe pas : il faut
que l'imprimante parle eSCL (c'est ce que macOS utilise nativement pour
« Numériser », donc si elle apparaît dans *Transfert d'images*, c'est bon).

```bash
cd vdsoft-scan-agent
./install-mac.sh 192.168.1.50      # sans argument : l'IP est demandée
```

Installe un LaunchAgent (démarrage à l'ouverture de session, redémarrage auto).
Node 18+ requis, rien d'autre. Test rapide sans rien installer :

```bash
node scan-agent.mjs 192.168.1.50
curl http://localhost:7182/health
```

Désinstallation : `launchctl unload ~/Library/LaunchAgents/com.vdsoft.scan-agent.plist`

Sous Linux, même script Node : lancez-le via un service systemd `--user`.

## Fichiers
- `scan-agent.mjs` — agent Node (macOS / Linux / Windows-avec-Node), chemin eSCL.
- `install-mac.sh` — installation macOS (LaunchAgent).
- `server-scan.ps1` — serveur HTTP local (port 7182), endpoints `/health` et `/scan`.
- `scan-escl.ps1` — scan via eSCL / AirScan (HTTP + XML, sans pilote).
- `scan-wia.ps1` — repli via le pilote Windows (WIA).
- `config.json` — IP de l'imprimante, source et résolution par défaut.
- `start-scan-agent.bat` — démarrage manuel.
- `install-autostart.bat` — démarrage auto (à lancer en administrateur).

## Utilisation
Sur la fiche VD Soft, le bouton **🖨️ Scanner** apparaît dès que l'agent répond.
Posez le document dans le chargeur, cliquez : les pages sont annexées à la fiche.

- Navigateur : Chrome ou Edge. Safari est plus strict sur l'appel de
  `http://localhost` depuis une page HTTPS — si le bouton n'apparaît pas sur
  Mac alors que `/health` répond, essayez Chrome.
- eSCL rend un **PDF** (toutes les pages dans un fichier) quand l'imprimante le
  propose ; le repli WIA rend une **image JPEG par page**.
- Le bouton reste invisible sur les PC sans agent — rien ne casse.

## Dépannage
- `agent-log.txt` (dans le dossier) journalise chaque scan et chaque erreur.
- Pour arrêter : Planificateur de tâches → tâche « VDSoft Scan Agent ».
- Test du chemin eSCL sans l'agent : `curl http://<ip>/eSCL/ScannerCapabilities`
