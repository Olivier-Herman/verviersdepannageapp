# Agent eID local — écran comptoir VD Soft

Petit service Node qui tourne sur le **PC comptoir** (Windows), lit la **carte d'identité belge** via le lecteur PC/SC (ex. ACS ACR39U) et l'expose en **localhost** à la page kiosque.

```
[Carte eID] → [Lecteur USB PC/SC] → [Agent Node localhost:7181] ← fetch ← [Chrome: page /caisse/ecran/<key>]
                                                                                     ↓ (Supabase realtime)
                                                                              [Fiche opérateur VD Soft]
```

Lecture **sans PIN** : sur l'eID belge, les fichiers **identité** (EF `4031`) et **adresse** (EF `4033`) sont librement lisibles. L'agent lit directement en APDU PC/SC (pas besoin du middleware pour lire, mais voir ci-dessous).

## Prérequis (sur le PC comptoir)

1. **Node.js LTS** (18 ou 20) — https://nodejs.org
2. **Lecteur de carte branché** (USB). Windows installe en général le pilote CCID tout seul. L'ACR39U fonctionne avec les pilotes intégrés.
3. **Middleware eID belge** (recommandé, pas obligatoire) — https://eid.belgium.be → permet de **vérifier** que le lecteur + la carte fonctionnent avec le *Visualiseur eID* officiel avant de brancher VD Soft.

## Installation

```bat
cd infra\eid-agent
npm install
npm start
```

Test rapide dans le navigateur du PC comptoir :
- http://localhost:7181/health  → `{ "ok": true, "reader": "...", "cardPresent": true/false }`
- (carte insérée) http://localhost:7181/read → le JSON identité.

## Brancher à l'écran comptoir

Ouvrir la page kiosque **avec le paramètre `eid`** pointant sur l'agent :

```
https://app.verviersdepannage.com/caisse/ecran/facturation?eid=http://localhost:7181/read
```

C'est cette URL qu'on met en **mode kiosque** (Chrome plein écran) sur le PC comptoir.
Sans le paramètre `?eid=...` (et sans la variable de build `NEXT_PUBLIC_EID_AGENT_URL`), la page utilise une **lecture MOCK** (identité de test) — pratique pour démontrer le parcours sans lecteur.

> Chrome autorise une page HTTPS à appeler `http://localhost` (exception « localhost = contexte sûr ») → pas de blocage *mixed-content*, pas de ngrok.

## Démarrage automatique (au boot / ouverture de session)

**Le plus simple :** clic droit sur **`install-autostart.bat`** → **Exécuter en tant qu'administrateur**.
Ça installe les dépendances si besoin, crée la tâche planifiée **« EidAgent »** (déclenchée *à l'ouverture de session*) et démarre l'agent tout de suite. Après un redémarrage du PC, l'agent repart donc **tout seul** dès qu'une session s'ouvre.

Pour vérifier/supprimer : Planificateur de tâches Windows → tâche **« EidAgent »**.
Manuellement en ligne de commande : `schtasks /query /tn EidAgent` (état) · `schtasks /delete /tn EidAgent /f` (retirer).

## Dépannage

| Symptôme | Piste |
|---|---|
| `/health` → `cardPresent: false` alors que la carte est insérée | Réinsérer la carte ; vérifier dans le *Visualiseur eID* officiel que le lecteur lit la carte ; vérifier le pilote du lecteur. |
| `/read` → `409 NO_CARD` | Aucune carte détectée : insérer la carte pubce vers le haut. |
| `/read` → `500 READ_FAILED` | Carte non-eID belge, ou lecteur occupé par une autre appli (fermer le Visualiseur eID / autre logiciel qui garde la carte). |
| L'écran comptoir reste sur le mock (Jean Dupont) | L'URL kiosque n'a pas `?eid=http://localhost:7181/read`, ou l'agent n'est pas lancé. |
| `npm install` échoue sur `@pokusew/pcsclite` | Utiliser Node LTS 18/20 (binaires précompilés) ; sinon installer les *build tools* Windows. |
| Le fetch est bloqué par le navigateur | Utiliser **`localhost`** (pas une IP distante) dans l'URL `?eid=` ; l'agent n'écoute que sur `127.0.0.1`. |

## Sécurité

L'agent n'écoute que sur `127.0.0.1` (pas exposé au réseau). Il ne lit que les fichiers identité/adresse (lecture publique, sans PIN), à la demande explicite du client au comptoir (consentement RGPD affiché sur l'écran avant lecture).
