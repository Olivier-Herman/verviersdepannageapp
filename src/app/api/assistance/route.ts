// GET /api/assistance — état de l'app VD Assistance (Olivier 10/10/2026) : client connecté, ses véhicules (chacun
// relié à un garage partenaire), commande en cours avec ses étapes.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { getClientSession, vehiculesDuClient, commandeDuClient } from '@/lib/espace/clients'

export const dynamic = 'force-dynamic'

export async function GET() {
  const s = await getClientSession()
  if (!s) return NextResponse.json({ client: null, vehicules: [], commande: null })
  const vehicules = await vehiculesDuClient(s.client.id)
  // Déplacement pour rien : forfait de la grille « clients » de chaque garage, affiché TVAC.
  const sources = Array.from(new Set(vehicules.map(v => v.societe.clients_source_key).filter(Boolean))) as string[]
  const { data: dpr } = sources.length
    ? await createAdminClient().from('source_tariffs').select('source, unit_price').in('source', sources).eq('mission_type', 'trajet_vide').is('effective_to', null)
    : { data: [] as any[] }
  const prixDpr = (src: string | null) => { const t = (dpr || []).find(x => x.source === src); return t?.unit_price ? Math.round(Number(t.unit_price) * 121) / 100 : null }
  const c = s.client
  return NextResponse.json({
    client: { prenom: c.prenom, nom: c.nom, email: c.email, tel: c.tel, adresse: c.adresse },
    vehicules: vehicules.map(v => ({
      id: v.id, plaque: v.plaque, marque: v.marque, modele: v.modele, assistance: v.assistance,
      garage: { nom: v.garage.nom, adresse: v.garage.adresse },
      societe: { nom: v.societe.nom, couleur: v.societe.couleur, actif: v.societe.clients_actif },
      deplacement: prixDpr(v.societe.clients_source_key),
    })),
    commande: await commandeDuClient(c),
  })
}
