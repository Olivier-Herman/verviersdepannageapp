# worker/Dockerfile — image du worker persistant (VPS). Contexte de build = racine du dépôt.
#   docker compose -f worker/docker-compose.yml up -d --build
FROM node:22-bookworm-slim

# Bibliothèques dont Chrome a besoin (celles qui manquaient sur le PC le 27/09 :
# libnss3, libnspr4, libasound2… — ici on les installe toutes d'un coup).
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates fonts-liberation git \
      libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcairo2 libcups2 \
      libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 libnspr4 libnss3 libpango-1.0-0 \
      libx11-6 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 \
      libxrandr2 libxshmfence1 xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer \
    NODE_ENV=production \
    TZ=Europe/Brussels

# Dépendances identiques à l'app (même package-lock) ; puppeteer télécharge son Chrome.
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund

# Le worker importe le code de l'app (src/lib/…), résolu via tsconfig paths.
COPY tsconfig.json ./
COPY src ./src
COPY worker ./worker

ARG WORKER_VERSION=dev
ENV WORKER_VERSION=$WORKER_VERSION

USER node
CMD ["npx", "tsx", "--tsconfig", "tsconfig.json", "worker/index.ts"]
