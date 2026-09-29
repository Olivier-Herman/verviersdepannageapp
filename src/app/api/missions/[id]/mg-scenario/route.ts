// POST /api/missions/[id]/mg-scenario { scenario: 'deplacement' | 'enlevement' }
//
// Mal garée, sur place (Olivier 29/09/2026) : par défaut c'est l'enlèvement (REM
// mal garée, mise en parc). Si le propriétaire revient avant le chargement, le
// chauffeur choisit « Déplacement payé » : la fiche passe en trajet à vide et le
// montant à encaisser = tarif « trajet à vide » de la grille police_mg (TVAC) ;
// il encaisse normalement puis termine. Réversible tant que rien n'est payé.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { estimateMissionPrice } from '@/lib/missions/estimate-price'

export const dynamic = 'force-dynamic'
const r2 = (n: number) => Math.round(n * 100) / 100

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { scenario } = await req.json().catch(() => ({}))
  if (!['deplacement', 'enlevement'].includes(scenario)) return NextResponse.json({ error: 'Choix inconnu' }, { status: 400 })

  const sb = createAdminClient()
  const { data: m } = await sb.from('incoming_missions')
    .select('id, source, mission_type, status, assigned_to, loaded_at, parked_at, payment_amount, received_at, intervention_date')
    .eq('id', params.id).maybeSingle()
  if (!m) return NextResponse.json({ error: 'Fiche introuvable' }, { status: 404 })
  const roles = [u.role, ...(u.roles || [])]
  const staff = roles.some((r: string) => ['dispatcher', 'admin', 'superadmin'].includes(r))
  if (m.assigned_to !== u.id && !staff) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  if (m.source !== 'police_mg') return NextResponse.json({ error: 'Réservé aux appels police mal garée.' }, { status: 400 })
  if (m.loaded_at || m.parked_at || ['completed', 'to_invoice', 'invoiced', 'parked', 'cancelled'].includes(m.status)) return NextResponse.json({ error: 'Le véhicule est déjà chargé ou la mission est terminée.' }, { status: 409 })
  if (Number(m.payment_amount || 0) > 0) return NextResponse.json({ error: 'Un paiement est déjà enregistré : le choix ne peut plus changer.' }, { status: 409 })

  const now = new Date().toISOString()
  let update: Record<string, any>, note: string
  if (scenario === 'deplacement') {
    const est: any = await estimateMissionPrice({ ...m, mission_type: 'trajet_vide' } as any)
    if (!est?.ok || !(est.total_eur > 0)) return NextResponse.json({ error: 'Tarif « déplacement » introuvable dans la grille mal garée : prévenez le dispatch.' }, { status: 409 })
    const tvac = r2(est.total_eur * 1.21)
    update = { mission_type: 'trajet_vide', amount_to_collect: tvac, updated_at: now }
    note = `Propriétaire revenu avant le chargement : déplacement payé (${tvac.toFixed(2)} € TVAC à encaisser), choisi par ${u.name || 'le chauffeur'}.`
  } else {
    update = { mission_type: 'remorquage', amount_to_collect: null, updated_at: now }
    note = `Retour à l’enlèvement (mise en parc), choisi par ${u.name || 'le chauffeur'}.`
  }
  const { data: fresh, error } = await sb.from('incoming_missions').update(update).eq('id', m.id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await sb.from('mission_logs').insert({ mission_id: m.id, actor_id: u.id, action: 'mg_scenario', notes: note, metadata: { scenario, amount_tvac: update.amount_to_collect } })
  return NextResponse.json({ ok: true, mission: fresh })
}
