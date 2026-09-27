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

## Installation sur le VPS (une fois)

```bash
# 1. Le dépôt (privé) : clé de déploiement GitHub en lecture seule, ou jeton.
git clone git@github.com:olivier-herman/verviersdepannageapp.git ~/verviers-app
cd ~/verviers-app

# 2. Les secrets (mêmes valeurs que sur Vercel)
cp worker/.env.example worker/.env
nano worker/.env

# 3. Construction + démarrage (redémarre seul après un reboot)
WORKER_VERSION=$(git rev-parse --short HEAD) docker compose -f worker/docker-compose.yml up -d --build

# 4. Vérifier
docker compose -f worker/docker-compose.yml logs -f --tail 50
```

Dans l'app : **Admin → Diagnostics → Worker VPS** montre le dernier battement,
la file et les derniers résultats.

## Mise à jour (à chaque déploiement qui touche `src/lib/vab`, `src/lib/cloture` ou `worker/`)

```bash
cd ~/verviers-app && git pull && WORKER_VERSION=$(git rev-parse --short HEAD) docker compose -f worker/docker-compose.yml up -d --build
```

Le conteneur reçoit SIGTERM, termine la demande en cours, puis repart sur la
nouvelle image. Pendant la reconstruction (2 à 4 min), Vercel reprend la main
tout seul si un cron tombe pendant ce trou.

## Arrêt

```bash
docker compose -f worker/docker-compose.yml down
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
