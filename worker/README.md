# Worker persistant VD Soft (VPS Hostinger)

Un seul processus Node, dans Docker, qui exécute les travaux longs que Vercel ne
peut pas tenir (Chrome piloté, plusieurs minutes). Aujourd'hui : **clôtures VAB
Comet**. Le code exécuté est celui de l'app (`src/lib/cloture/transform/vab.ts`),
pas une copie.

## Comment ça marche

1. Le cron Vercel `vab-close-retry` (tous les quarts d'heure) lit la liste des
   dossiers encore ouverts chez VAB et décide lesquels clôturer, comme avant.
2. Si le worker **bat** (signal de moins de 2 min dans
   `app_settings.worker_vps_heartbeat`), le cron **pose une demande** dans la
   table `worker_jobs` et s'arrête là.
3. Le worker prend la demande, clôture, écrit le résultat dans `worker_jobs`
   (et le détail dans `mission_logs`, comme d'habitude).
4. Si le worker **ne bat plus**, le cron clôture **lui-même** sur Vercel, comme
   avant le worker. Rien ne dépend du VPS.

Une demande à la fois : le compte VAB est partagé.

## Installation sur le VPS (faite le 27/09/2026)

Le VPS n'a pas de clé sur le dépôt : le code y arrive par archive git, avec
`worker/deploy-vps.sh` lancé depuis le poste de dev (dossier `/docker/vdsoft-worker`
sur le VPS).

```bash
# 1. Depuis le poste de dev : archive de HEAD → VPS → construction de l'image
./worker/deploy-vps.sh

# 2. Sur le VPS, une fois : les secrets (mêmes valeurs que sur Vercel)
nano /docker/vdsoft-worker/worker/.env

# 3. Sur le VPS : démarrage (redémarre seul après un reboot)
cd /docker/vdsoft-worker && docker compose -f worker/docker-compose.yml up -d

# 4. Vérifier
docker compose -f worker/docker-compose.yml logs -f --tail 50
```

Dans l'app : **Admin → Diagnostics → Worker VPS** montre le dernier battement,
la file et les derniers résultats.

## Mise à jour (à chaque déploiement qui touche `src/lib/vab`, `src/lib/cloture` ou `worker/`)

```bash
./worker/deploy-vps.sh      # depuis le poste de dev, sur le commit à déployer
```

Le conteneur reçoit SIGTERM, termine la demande en cours, puis repart sur la
nouvelle image. Pendant la reconstruction (2 à 4 min), Vercel reprend la main
tout seul si un cron tombe pendant ce trou. Le worker n'a besoin de personne
pour tourner : le poste de dev ne sert qu'à envoyer une nouvelle version.

## Arrêt / journal (sur le VPS)

```bash
cd /docker/vdsoft-worker
docker compose -f worker/docker-compose.yml logs -f --tail 50
docker compose -f worker/docker-compose.yml down     # Vercel reprend dans le quart d'heure
```

Vercel reprend les clôtures dans le quart d'heure.

## Sans Docker (mise au point)

```bash
npm ci
set -a; . worker/.env; set +a
npm run worker
```

## Variables

| Variable | Rôle |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | accès base (service role) |
| `VAB_EMAIL`, `VAB_PASSWORD` | compte Comet |
| `PUPPETEER_ARGS` | options Chrome ; posé par le compose (`--no-sandbox …`) |
| `WORKER_NAME` | nom affiché dans le battement (défaut : nom d'hôte) |
| `VAB_TRACE=1` | trace chaque étape de clôture dans les logs |
