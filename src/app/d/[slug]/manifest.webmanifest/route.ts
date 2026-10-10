// Manifeste de l'app installable d'un garage : « Dépannage EBAC », ouverte directement sur /d/ebac.
import { NextResponse } from 'next/server'
import { societeParSlug } from '@/lib/espace/clients'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const s = await societeParSlug(params.slug)
  if (!s?.clients_slug) return NextResponse.json({ error: 'Lien inconnu' }, { status: 404 })
  const icons = [192, 512].map(n => ({ src: `/noprecache/assistance/icon-${n}.png`, sizes: `${n}x${n}`, type: 'image/png', purpose: 'any' }))
  return new NextResponse(JSON.stringify({
    name: `VD Assistance — avec ${s.nom}`, short_name: 'VD Assistance',
    description: `Commandez votre dépannage Verviers Dépannage, partenaire de votre garage ${s.nom}.`,
    start_url: `/d/${s.clients_slug}`, id: `/d/${s.clients_slug}`, scope: `/d/${s.clients_slug}`,
    display: 'standalone', orientation: 'portrait', background_color: '#f7f3ee', theme_color: '#151a2d', lang: 'fr-BE', icons,
  }), { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-store' } })
}
