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
    serverComponentsExternalPackages: ["puppeteer-core", "@sparticuz/chromium", "puppeteer"]
  }
};

module.exports = withPWA(nextConfig);
