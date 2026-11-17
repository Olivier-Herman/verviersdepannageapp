#!/usr/bin/env bash
# scripts/passage-facturation.sh — passage manuel de la facturation (factures, clôtures Allianz, validations COMEX, sans
# relances), bloc « Facturation » remis en pause à la fin (Olivier 17/11/2026). À lancer depuis la racine du dépôt :
#   bash scripts/passage-facturation.sh
# Démarre l'application en local (port 3000, base et ERP de production) avec un secret des tâches TEMPORAIRE, gardé en
# mémoire seulement, lance scripts/passage-facturation.ts, puis arrête l'application.
set -euo pipefail
cd "$(dirname "$0")/.."
if ss -ltn | grep -q ':3000 '; then echo "Le port 3000 est déjà utilisé : arrête l'application locale d'abord." >&2; exit 1; fi
SECRET=$(openssl rand -hex 16)
LOG=$(mktemp)
CRON_SECRET="$SECRET" setsid npx next dev -p 3000 > "$LOG" 2>&1 &
DEV=$!
# Arrêt de tout le groupe (npx + serveur Next), sinon le port 3000 reste occupé.
trap 'kill -TERM -- -$DEV 2>/dev/null; sleep 2; P=$(ss -ltnp | grep ":3000 " | grep -oE "pid=[0-9]+" | head -1 | cut -d= -f2); [ -n "$P" ] && kill $P; rm -f "$LOG"' EXIT
for i in $(seq 1 60); do
  curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/login 2>/dev/null | grep -qE '200|302|307' && break
  sleep 3
  [ "$i" = 60 ] && { echo "L'application locale ne démarre pas (voir $LOG)." >&2; exit 1; }
done
CRON_SECRET="$SECRET" npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/passage-facturation.ts
