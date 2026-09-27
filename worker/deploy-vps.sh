#!/usr/bin/env bash
# worker/deploy-vps.sh — pousse le worker sur le VPS et le redémarre.
#
# Le VPS n'a pas de clé sur le dépôt : on lui envoie une archive git du commit
# courant (package.json, lock, tsconfig, src, worker), puis on reconstruit
# l'image. Le worker/.env du VPS n'est jamais touché. Olivier 27/09/2026.
#
#   ./worker/deploy-vps.sh            # déploie HEAD
#   VPS=root@1.2.3.4 ./worker/deploy-vps.sh
set -euo pipefail
VPS="${VPS:-root@89.116.38.245}"
DIR="${DIR:-/docker/vdsoft-worker}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(git -C "$ROOT" rev-parse --short HEAD)"
TGZ="$(mktemp -t vdsoft-worker.XXXXXX.tgz)"
trap 'rm -f "$TGZ"' EXIT

echo "→ archive de $VERSION"
git -C "$ROOT" archive --format=tar.gz -o "$TGZ" HEAD package.json package-lock.json tsconfig.json .dockerignore src worker

echo "→ envoi vers $VPS:$DIR"
ssh -o BatchMode=yes "$VPS" "mkdir -p $DIR"
scp -q "$TGZ" "$VPS:$DIR/deploy.tgz"

echo "→ extraction + reconstruction (le worker termine sa demande en cours avant de repartir)"
ssh -o BatchMode=yes "$VPS" "cd $DIR && tar -xzf deploy.tgz && rm deploy.tgz \
  && test -s worker/.env || { echo 'worker/.env absent ou vide sur le VPS' >&2; exit 1; } \
  && WORKER_VERSION=$VERSION docker compose -f worker/docker-compose.yml up -d --build \
  && docker compose -f worker/docker-compose.yml logs --tail 5"
echo "✔ worker $VERSION déployé"
