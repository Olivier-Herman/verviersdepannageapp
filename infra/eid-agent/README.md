# Agent eID VD Soft — version PowerShell (SANS Node)

Lit la carte d'identité belge (puce, sans PIN : nom / prénom / adresse / date de
naissance) et l'expose en HTTP local pour l'écran comptoir. **Aucune dépendance à
installer** (pas de Node, pas de npm) : 100 % PowerShell natif de Windows.

## Installation
1. Dézippez ce dossier où vous voulez (ex. `C:\VDSoft\eid-agent`).
2. Clic droit sur **`install-autostart.bat`** → **Exécuter en tant qu'administrateur**.
   → installe le démarrage automatique + lance l'agent.
3. Insérez une carte, testez dans un navigateur : **http://localhost:7181/health**
   puis **http://localhost:7181/read**.

## Fichiers
- `server-eid.ps1` — serveur HTTP local (port 7181), endpoints `/read` et `/health`.
- `read-eid.ps1` — lecture de la carte via WinSCard (intégré à Windows).
- `start-eid-agent.bat` — démarrage manuel.
- `install-autostart.bat` — installe le démarrage auto (à lancer en admin).

## Notes
- Lancé avec `-ExecutionPolicy Bypass` → contourne la stratégie « Restricted »
  sans modifier le système.
- Pour arrêter : Gestionnaire des tâches → processus `powershell` de l'agent,
  ou désactiver la tâche « VDSoft eID Agent » dans le Planificateur de tâches.
