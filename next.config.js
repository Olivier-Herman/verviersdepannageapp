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

/** @type {import('next').NextConfig} */
const nextConfig = {
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
      "/api/missions/[id]/cloture/route": ["./node_modules/@sparticuz/chromium/bin/**"]
    }
  }
};

module.exports = withPWA(nextConfig);
