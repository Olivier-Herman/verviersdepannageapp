// src/app/site/sitemap.xml/route.ts
//
// Sitemap du site public. Les pages fixes plus les véhicules en vente : un lot
// publié entre dans le plan, un lot retiré en sort — c'est lu en base à chaque
// appel, jamais mis en cache. Les pages légales n'y sont pas : elles existent
// pour le lecteur, pas pour le moteur. Olivier 2026-09-15.

import { createAdminClient } from '@/lib/supabase'
import { SITE_URL } from '../_data'

export const dynamic = 'force-dynamic'

const PAGES: { path: string; priority: string; freq: string }[] = [
  { path: '/',          priority: '1.0', freq: 'weekly'  },
  { path: '/depannage', priority: '0.9', freq: 'monthly' },
  { path: '/fourriere', priority: '0.9', freq: 'monthly' },
  { path: '/tarifs',    priority: '0.8', freq: 'monthly' },
  { path: '/circuit',   priority: '0.7', freq: 'monthly' },
  { path: '/pros',      priority: '0.6', freq: 'monthly' },
  { path: '/vente',     priority: '0.8', freq: 'daily'   },
  { path: '/contact',   priority: '0.7', freq: 'yearly'  },
]

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function GET() {
  const urls: string[] = PAGES.map(pg =>
    `<url><loc>${SITE_URL}${pg.path}</loc><changefreq>${pg.freq}</changefreq><priority>${pg.priority}</priority></url>`)

  try {
    const sb = createAdminClient()
    const { data } = await sb.from('vehicle_sales')
      .select('reference, updated_at').eq('status', 'published').limit(200)
    for (const l of data || []) {
      const lastmod = l.updated_at ? new Date(l.updated_at).toISOString().slice(0, 10) : ''
      urls.push(`<url><loc>${SITE_URL}/vente/${esc(l.reference)}</loc>`
        + (lastmod ? `<lastmod>${lastmod}</lastmod>` : '')
        + `<changefreq>daily</changefreq><priority>0.6</priority></url>`)
    }
  } catch { /* le plan reste valable sans les lots */ }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8' } })
}
