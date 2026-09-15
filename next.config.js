const withPWA = require("next-pwa")({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
  customWorkerDir: "src/worker",
  runtimeCaching: [
    {
      urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
      handler: "CacheFirst",
      options: { cacheName: "google-fonts", expiration: { maxEntries: 4, maxAgeSeconds: 365 * 24 * 60 * 60 } }
    },
    {
      urlPattern: /^https:\/\/app\.verviersdepannage\.com\/api\/.*/i,
      handler: "NetworkFirst",
      options: { cacheName: "api-cache", expiration: { maxEntries: 50, maxAgeSeconds: 60 } }
    }
  ]
});

// ── Site public sur verviersdepannage.be ─────────────────────────────────
// Le site vit dans ce même Next, sous /site. Le domaine public le sert sous
// des URL propres (/fourriere, pas /site/fourriere) par réécriture conditionnée
// à l'hôte — pas dans le middleware, qui est celui de l'auth et n'a pas à
// s'occuper de ça.
//
// beforeFiles, et une liste explicite : /fourriere et /circuit EXISTENT aussi
// dans l'app. Sans réécriture avant la résolution des fichiers, le domaine
// public afficherait la fourrière interne. Olivier 2026-09-15.
const SITE_HOST  = 'verviersdepannage.be'
const SITE_PAGES = [
  'depannage', 'fourriere', 'tarifs', 'circuit', 'pros', 'contact',
  'vente', 'mentions-legales', 'confidentialite', 'robots.txt', 'sitemap.xml',
]
const onSite = { type: 'host', value: SITE_HOST }

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/', has: [onSite], destination: '/site' },
        ...SITE_PAGES.map(pg => ({ source: `/${pg}`, has: [onSite], destination: `/site/${pg}` })),
        { source: '/vente/:ref', has: [onSite], destination: '/site/vente/:ref' },
      ],
      // Tout ce qui n'existe ni en fichier ni en route retombe dans le site :
      // c'est sa page 404 qu'un visiteur doit voir, pas celle de l'app.
      afterFiles: [
        { source: '/:path((?!api/|_next/|site/).*)', has: [onSite], destination: '/site/:path' },
      ],
      fallback: [],
    }
  },
  async redirects() {
    const r = [
      // www → apex : une seule adresse canonique.
      { source: '/:path*', has: [{ type: 'host', value: `www.${SITE_HOST}` }],
        destination: `https://${SITE_HOST}/:path*`, permanent: true },
      // L'échafaudage /site ne doit pas survivre dans les URL publiques.
      { source: '/site', has: [onSite], destination: '/', permanent: true },
      { source: '/site/:path*', has: [onSite], destination: '/:path*', permanent: true },
      // Anciennes adresses de l'Odoo Website.
      { source: '/contactus', has: [onSite], destination: '/contact', permanent: true },
      { source: '/web/:path*', has: [onSite], destination: '/', permanent: true },
    ]
    // Une fois le domaine branché, /site sur app.* renvoie vers l'adresse
    // publique : une seule copie indexable, jamais deux.
    if (process.env.NEXT_PUBLIC_SITE_BASE === '') {
      r.push({ source: '/site', has: [{ type: 'host', value: 'app.verviersdepannage.com' }],
               destination: `https://${SITE_HOST}/`, permanent: true })
      r.push({ source: '/site/:path*', has: [{ type: 'host', value: 'app.verviersdepannage.com' }],
               destination: `https://${SITE_HOST}/:path*`, permanent: true })
    }
    return r
  },
  reactStrictMode: true,
  images: {
    domains: ["app.verviersdepannage.com"],
    unoptimized: true
  },
  experimental: {
    // Clôture VAB : ces packages navigateur ne doivent pas être bundlés par Next
    // (binaire Chromium chargé au runtime). Cf src/lib/vab/sign-browser.ts.
    serverComponentsExternalPackages: ["puppeteer-core", "@sparticuz/chromium", "puppeteer"],
    // ⚠️ « externe » ne veut PAS dire « embarqué ». Sans cette ligne, le binaire
    // Chromium reste sur le sol au déploiement et la fonction part sans
    // navigateur : @sparticuz échoue en 0 s sur
    //   The input directory ".../@sparticuz/chromium/bin" does not exist
    // (vu en prod le 12/08 sur la 1re clôture VAB réelle, 2ETN444).
    // Uniquement sur la route de clôture — les ~66 Mo n'ont rien à faire
    // ailleurs. Olivier 2026-08-12.
    outputFileTracingIncludes: {
      "/api/missions/[id]/cloture": ["./node_modules/@sparticuz/chromium/bin/**"],
      "/api/missions/[id]/cloture/route": ["./node_modules/@sparticuz/chromium/bin/**"],
      // Le filet pilote le même Chromium : sans cette ligne il tourne en local
      // et tombe en prod sur « bin does not exist ».
      "/api/cron/vab-close-retry": ["./node_modules/@sparticuz/chromium/bin/**"]
    }
  }
};

module.exports = withPWA(nextConfig);
