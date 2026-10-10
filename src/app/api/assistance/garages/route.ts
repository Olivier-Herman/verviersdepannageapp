// GET /api/assistance/garages?slug=ebac — garages partenaires qui ont activé le service, avec leurs sites.
// Avec slug : ce garage seulement (lien ou QR code d'un garage) ; « demo » n'est servi que par son lien.
import { NextResponse } from 'next/server'
import { garagesPartenaires, societeParSlug } from '@/lib/espace/clients'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get('slug')
  if (slug) {
    const s = await societeParSlug(slug)
    if (!s) return NextResponse.json({ error: 'Ce code ne correspond à aucun garage partenaire.' }, { status: 404 })
    if (!s.clients_actif) return NextResponse.json({ garages: [], inactif: s.nom })
  }
  const g = await garagesPartenaires({ slug })
  return NextResponse.json({ garages: g.map(s => ({ id: s.id, nom: s.nom, couleur: s.couleur, slug: s.clients_slug, sites: s.sites.map(x => ({ id: x.id, nom: x.nom, adresse: x.adresse })) })) })
}
