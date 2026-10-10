// GET /api/d/[slug] — état de l'app client d'un garage (Olivier 10/10/2026) : option active, client connecté,
// commande en cours avec ses étapes.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { societeParSlug, getClientSession, commandeDuClient } from '@/lib/espace/clients'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const societe = await societeParSlug(params.slug)
  if (!societe) return NextResponse.json({ error: 'Lien inconnu' }, { status: 404 })
  const s = societe.clients_actif ? await getClientSession(params.slug) : null
  // Déplacement pour rien : forfait de la grille « clients » du garage, affiché TVAC.
  const { data: dpr } = societe.clients_source_key
    ? await createAdminClient().from('source_tariffs').select('unit_price').eq('source', societe.clients_source_key).eq('mission_type', 'trajet_vide').is('effective_to', null).maybeSingle()
    : { data: null }
  const { data: garages } = await createAdminClient().from('espace_garages').select('id, nom, adresse').eq('societe_id', societe.id).order('ordre')
  const sonGarage = s ? (garages || []).find(g => g.id === s.client.garage_id) || null : null
  return NextResponse.json({
    garages: garages || [],
    actif: societe.clients_actif,
    garage: { nom: societe.nom, couleur: societe.couleur },
    deplacement: dpr?.unit_price ? Math.round(Number(dpr.unit_price) * 1.21 * 100) / 100 : null,
    client: s ? { prenom: s.client.prenom, nom: s.client.nom, plaque: s.client.plaque, marque: s.client.marque, modele: s.client.modele, assistance: s.client.assistance, garage: sonGarage?.nom || null } : null,
    commande: s ? await commandeDuClient(s.client) : null,
  })
}
