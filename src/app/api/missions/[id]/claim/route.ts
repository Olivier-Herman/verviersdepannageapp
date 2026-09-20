// POST /api/missions/[id]/claim : un chauffeur s attribue une mission
// disponible (status 'new' ou 'dispatching', non assignee, < 30 min). Atomique
// pour eviter 2 chauffeurs qui prennent la meme mission en meme temps.
// Olivier 2026-06-02. Cf page /missions-dispo.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { getBusinessNumber } from '@/lib/settings/business'

export const dynamic = 'force-dynamic'

// Fenêtre de fraîcheur = réglage métier momo_market_fresh_minutes (45 min depuis le
// 09/09/2026) ; 3 h quand le chauffeur prend la fiche depuis le bouton « Siabis »
// de la création (Olivier 20/09/2026 : « on ne sait jamais »).
const SIABIS_FRESH_MINUTES = 180
const CLAIMABLE_STATUSES = ['new', 'dispatching']   // "En commande" + "En attente"

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({})) as { via?: string }
  const FRESH_MINUTES = body?.via === 'siabis' ? SIABIS_FRESH_MINUTES : await getBusinessNumber('momo_market_fresh_minutes').catch(() => 45)
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = (session.user as any).id
  const role   = (session.user as any).role
  const roles: string[] = Array.isArray((session.user as any).roles) ? (session.user as any).roles : []
  const isDriver = role === 'driver' || roles.includes('driver') || roles.includes('chauffeur') ||
                   ['admin', 'superadmin', 'dispatcher'].includes(role)  // admins/dispatchers peuvent aussi tester
  if (!isDriver) return NextResponse.json({ error: 'Reserve aux chauffeurs' }, { status: 403 })
  if (!userId)   return NextResponse.json({ error: 'Pas d identite' }, { status: 401 })

  const sb = createAdminClient()

  // Recup + verifie disponibilite
  const { data: m } = await sb.from('incoming_missions')
    .select('id, status, assigned_to, received_at, source')
    .eq('id', params.id)
    .maybeSingle()
  if (!m) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  if (m.assigned_to)                          return NextResponse.json({ error: 'Mission deja prise par un autre chauffeur' }, { status: 409 })
  if (!CLAIMABLE_STATUSES.includes(m.status)) return NextResponse.json({ error: 'Mission deja traitee' }, { status: 409 })

  const ageMs = Date.now() - new Date(m.received_at).getTime()
  if (ageMs > FRESH_MINUTES * 60 * 1000) {
    return NextResponse.json({ error: `Mission expiree (> ${FRESH_MINUTES} min)` }, { status: 410 })
  }

  // Update atomique : ne s applique QUE si toujours pas assignee.
  // PostgREST renvoie data=[] si le WHERE ne matche pas → on detecte la
  // race condition (un autre l a deja prise entre notre SELECT et UPDATE).
  const now = new Date().toISOString()
  const { data: claimed, error } = await sb.from('incoming_missions')
    .update({
      status:      'assigned',
      assigned_to: userId,
      assigned_at: now,
      updated_at:  now,
    })
    .eq('id', params.id)
    .is('assigned_to', null)
    .in('status', CLAIMABLE_STATUSES)
    .select('id, mission_number')
    .maybeSingle()

  if (error)   return NextResponse.json({ error: error.message }, { status: 500 })
  if (!claimed) return NextResponse.json({ error: 'Mission prise par un autre chauffeur a l instant' }, { status: 409 })

  // Log
  await sb.from('mission_logs').insert({
    mission_id: params.id,
    actor_id:   userId,
    action:     'claimed_self_service',
    notes:      body?.via === 'siabis' ? 'Fiche prise depuis le bouton Siabis (création chauffeur, plaque reconnue)' : 'Mission auto-attribuee via self-service',
  })

  // Olivier 2026-06-18 : prendre une mission via Momo Market doit aussi créer le
  // dossier Odoo (helpdesk + tâche FSM + VÉHICULE), comme une assignation
  // classique. Sans ça, une mission prise en self-service arrivait sans dossier
  // ni véhicule Odoo. Best-effort, non bloquant.
  try {
    const { createOdooDossierForMission } = await import('@/lib/missions/odoo-dossier')
    const { withOdooActor } = await import('@/lib/odoo')
    const odoo = await withOdooActor(userId, () => createOdooDossierForMission(params.id))
    if (odoo?.created) {
      await sb.from('mission_logs').insert({
        mission_id: params.id,
        actor_id:   userId,
        action:     'odoo_synced',
        notes:      `Dossier Odoo créé : helpdesk #${odoo.ticketId}, task #${odoo.taskId}`,
      })
    }
  } catch (e: any) {
    console.error('[claim] Création dossier Odoo échouée (non bloquant):', e?.message)
  }

  return NextResponse.json({ ok: true, missionId: claimed.id })
}
