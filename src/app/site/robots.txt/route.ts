// src/app/site/robots.txt/route.ts
//
// robots.txt du SITE PUBLIC. Servi sur verviersdepannage.be/robots.txt par la
// réécriture d'hôte de next.config. L'app, elle, a son propre robots (racine)
// qui interdit tout : deux hôtes, deux politiques. Olivier 2026-09-15.

import { SITE_URL } from '../_data'

export const dynamic = 'force-static'

export function GET() {
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /mentions-legales',
    'Disallow: /confidentialite',
    '',
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    '',
  ].join('\n')
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
}
