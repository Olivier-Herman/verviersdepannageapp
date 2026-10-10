// GET  /api/espace/missions — missions visibles du compte, avec leur frise et leurs documents.
// POST /api/espace/missions — nouvelle demande d'intervention (arrive dans les commandes du dispatch).
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { getEspaceSession } from '@/lib/espace/session'
import { MISSION_COLS, relivraisonsDe, scopeMissions, suiviClient, vehiculeLabel } from '@/lib/espace/missions'
import { facturesEnvoyees } from '@/lib/espace/documents'
import { creerDemande, lireDemande } from '@/lib/espace/demande'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const s = await getEspaceSession()
  if (!s) return NextResponse.json({ error: 'Session expirée' }, { status: 401 })
  const url = new URL(req.url)
  const societeId = url.searchParams.get('societe')
  const societes = societeId ? s.societes.filter(x => x.id === societeId) : s.societes
  if (!societes.length) return NextResponse.json({ missions: [] })
  const sb = createAdminClient()
  const depuis = new Date(Date.now() - 365 * 86400_000).toISOString()
  const { data, error } = await scopeMissions(sb.from('incoming_missions').select(MISSION_COLS), s.compte, societes)
    .gte('received_at', depuis).order('received_at', { ascending: false }).limit(300)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const rows = (data || []) as any[]
  const rels = await relivraisonsDe(rows.map(m => m.id))
  const factures = await facturesEnvoyees(rows).catch(() => new Map())
  const cids = [...new Set(rows.map(m => m.espace_compte_id).filter(Boolean))]
  const { data: comptes } = cids.length ? await sb.from('espace_comptes').select('id, nom').in('id', cids) : { data: [] as any[] }
  const nomCompte = new Map((comptes || []).map((c: any) => [c.id, c.nom]))
  const societeDe = new Map(s.societes.map(x => [x.odoo_partner_id, x]))
  return NextResponse.json({
    missions: rows.map(m => {
      const rel = rels.get(m.id) || null
      const suivi = suiviClient(m, rel)
      const soc = societeDe.get(m.billed_to_id)
      return {
        id: m.id, numero: m.mission_number, plaque: m.vehicle_plate, vehicule: vehiculeLabel(m),
        adresse: m.incident_address, destination: rel?.destination_address || m.destination_address || null,
        recueLe: m.received_at, prevuLe: m.rdv_at, reference: m.dossier_number || null,
        societe: soc ? { id: soc.id, nom: soc.nom, couleur: soc.couleur } : null,
        commandePar: m.espace_compte_id ? nomCompte.get(m.espace_compte_id) || 'Espace client' : null,
        suivi, rapport: suivi.ton === 'fini',
        facture: factures.get(m.id) || null,
      }
    }),
  })
}

export async function POST(req: Request) {
  const s = await getEspaceSession()
  if (!s) return NextResponse.json({ error: 'Session expirée' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const societe = s.societes.length === 1 ? s.societes[0] : s.societes.find(x => x.id === b?.societeId)
  if (!societe) return NextResponse.json({ error: 'Choisissez la société qui commande.' }, { status: 400 })
  const d = lireDemande(b)
  if (typeof d === 'string') return NextResponse.json({ error: d }, { status: 400 })
  try {
    const m = await creerDemande(s.compte, societe, d)
    return NextResponse.json({ ok: true, id: m.id, numero: m.mission_number })
  } catch (e: any) {
    console.error('[espace] demande KO', e?.message)
    return NextResponse.json({ error: 'La demande n’a pas pu être enregistrée. Appelez-nous si c’est urgent.' }, { status: 500 })
  }
}
