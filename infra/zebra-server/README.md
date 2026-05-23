# Zebra Print Server — PC Windows (Verviers Dépannage)

Petit serveur Node.js qui tourne sur un PC Windows local et reçoit des
requêtes d'impression depuis VD Soft (Vercel) via ngrok, puis envoie le
ZPL à l'imprimante Zebra ZD421 (USB).

## Architecture

```
VD Soft (Vercel) ───── ngrok HTTPS ─────► PC Windows ────USB────► Zebra ZD421
                                            │
                                            └─ server.js (port 3000)
```

- **ngrok URL** : `https://palaeobiologic-carola-steeply.ngrok-free.dev`
- **PC IP locale** : `192.168.129.54`
- **Imprimante** : Zebra ZD421, 203 dpi (8 dots/mm), 4×3 pouces (101.6 × 76.2 mm)
- **Driver Windows** : `ZDesigner ZD421-203dpi ZPL` (mode passthrough/raw)

## Endpoints

| Méthode | Path | Body | Usage |
|---------|------|------|-------|
| GET | `/` | — | Healthcheck |
| POST | `/print` | `{ qrUrl, motif, date, note }` | **Legacy** — le PC compose le ZPL |
| POST | `/print-raw` | `{ zpl: "^XA...^XZ" }` | **Nouveau** — VD Soft compose le ZPL, le PC forwarde |

Header obligatoire pour les POST : `ngrok-skip-browser-warning: true`
(sinon ngrok gratuit affiche une page d'avertissement à la place de la réponse).

## Installation sur le PC

1. **Node.js 18+** installé (`node --version`)
2. **Dépendances** :
   ```bash
   npm install express cors
   ```
3. **Placer `server.js`** dans un dossier dédié (ex: `C:\zebra-server\`)
4. **Driver Zebra** configuré en mode raw :
   Préférences d'impression → Outils → "Passer commande directe" coché
5. **Lancer manuellement pour tester** :
   ```bash
   node server.js
   ```
   Devrait afficher `Zebra server listening on 3000`
6. **Vérifier le healthcheck** : `curl http://localhost:3000/` → réponse JSON

## Démarrage automatique au boot

Via le **Planificateur de tâches Windows** :

1. Créer une tâche `ZebraServer`
2. Déclencheur : "Au démarrage de l'ordinateur"
3. Action : `node` avec argument `C:\zebra-server\server.js` (working dir = `C:\zebra-server\`)
4. Cocher "Exécuter même si l'utilisateur n'est pas connecté"

Pour redémarrer manuellement après mise à jour de `server.js` :
Planificateur → tâche `ZebraServer` → clic droit → Fin → Démarrer.

## ngrok

Configuration ngrok pour exposer le port 3000 sur le domaine statique gratuit :

```bash
ngrok http 3000 --domain=palaeobiologic-carola-steeply.ngrok-free.dev
```

À mettre aussi en démarrage auto via une autre tâche planifiée.

## Designs d'étiquettes (côté VD Soft)

Avec le endpoint `/print-raw`, le PC est agnostique du design. Tous les
templates ZPL sont versionnés dans le repo verviers-app sous :

```
src/lib/print/zpl-templates/
  └── parc-label.ts        ← étiquette d'entrée parc fourrière
  └── (autres templates à ajouter)
```

Pour ajouter un nouveau design (ex: bon de restitution, étiquette destruction) :
créer un nouveau fichier dans `zpl-templates/`, exposer une fonction
`buildXxxLabelZPL(data)`, et l'appeler depuis le code applicatif via
`printZPLRaw(zpl)`. Aucune modification sur le PC.

## Sécurité

- Pas d'authentification sur le serveur (l'URL ngrok obscure sert de "secret")
- Si compromission soupçonnée : régénérer un nouveau domaine ngrok
- Le PC est sur le LAN, port 3000 non exposé publiquement (sauf via ngrok)

## Logs

- `console.log` uniquement, perdu au redémarrage du service
- Pour persister : rediriger vers fichier dans la définition de la tâche planifiée
- Le terminal du processus reste accessible si la tâche est lancée avec un user connecté

## Troubleshooting

| Symptôme | Cause probable | Fix |
|---|---|---|
| `ZEBRA_REMOTE non configuré` côté Vercel | Variable env manquante | Ajouter `ZEBRA_REMOTE=https://palaeobiologic-...` dans Vercel |
| Page ngrok au lieu de réponse JSON | Header manquant | Vérifier `ngrok-skip-browser-warning: true` |
| Étiquette imprime le ZPL en texte | Driver pas en raw | Activer "Passer commande directe" dans le driver |
| Accents en `?` | Encodage UTF-8 manquant | `^CI28` doit être présent en début de ZPL |
| Timeout 10s | PC éteint ou ngrok down | Vérifier `curl https://palaeobiologic-.../` |
| `Out-Printer not recognized` | PowerShell < 5.1 | Mettre à jour Windows ou utiliser `copy /B` |
