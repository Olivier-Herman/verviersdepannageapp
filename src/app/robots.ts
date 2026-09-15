// src/app/robots.ts
//
// robots.txt de l'APP (app.verviersdepannage.com) : rien à indexer, jamais.
// Ni les écrans internes, ni /site — sa copie indexable est verviersdepannage.be,
// servie par la réécriture d'hôte de next.config, avec son propre robots
// (src/app/site/robots.txt). Deux hôtes, deux politiques. Olivier 2026-09-15.

import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } }
}
