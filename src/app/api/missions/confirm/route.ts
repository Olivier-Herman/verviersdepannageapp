// src/app/api/missions/confirm/route.ts
// Confirme (new→dispatching ou assigned) ou refuse (new→ignored) une mission.
// À la confirmation : création AUTO du dossier Odoo (Helpdesk + FSM Task).

import { NextResponse }                 from 'next/server'
import { getServerSession }             from 'next-auth'
import { authOptions }                  from '@/lib/auth'
import { createAdminClient }            from '@/lib/supabase'
import { createOdooDossierForMission } from '@/lib/missions/odoo-dossier'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { mission_id, action, reason } = await req.json()

  if (!mission_id || !action) {
    return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: actor } = await supabase
    .from('users')
    .select('id, name')
    .eq('email', session.user.email!)
    .single()

  const now = new Date().toISOString()

  if (action === 'confirm') {
    // Vérifier si un chauffeur est déjà assigné
    const { data: mission } = await supabase
      .from('incoming_missions')
      .select('assigned_to')
      .eq('id', mission_id)
      .single()

    const newStatus = mission?.assigned_to ? 'assigned' : 'dispatching'

    await supabase
      .from('incoming_missions')
      .update({ status: newStatus, updated_at: now })
      .eq('id', mission_id)

    await supabase.from('mission_logs').insert({
      mission_id,
      actor_id: actor?.id || null,
      action:   'dispatched',
      notes:    `Mission confirmée par ${actor?.name || 'dispatcher'}`,
    })

    // Création AUTO du dossier Odoo (Helpdesk + FSM Task) — best effort, non bloquant.
    // Si ça plante, le dispatcher peut toujours utiliser le bouton "Créer dossier Odoo"
    // sur la fiche mission (route /api/fsm/create-mission, idempotent).
    let odooResult: any = null
    try {
      odooResult = await createOdooDossierForMission(mission_id)
      if (odooResult.created) {
        await supabase.from('mission_logs').insert({
          mission_id,
          actor_id: actor?.id || null,
          action:   'odoo_synced',
          notes:    `Dossier Odoo créé : helpdesk #${odooResult.ticketId}, task #${odooResult.taskId}`,
        })
      }
    } catch (e: any) {
      console.error('[Confirm] Création Odoo échouée (non bloquant):', e.message)
      await supabase.from('mission_logs').insert({
        mission_id,
        actor_id: actor?.id || null,
        action:   'error',
        notes:    `Création Odoo échouée : ${e.message}. Réessayer via le bouton "Créer dossier Odoo".`,
      })
    }

    return NextResponse.json({
      ok:     true,
      status: newStatus,
      odoo:   odooResult ? {
        ticketId:  odooResult.ticketId,
        ticketUrl: odooResult.ticketUrl,
        taskId:    odooResult.taskId,
        taskUrl:   odooResult.taskUrl,
        created:   odooResult.created,
      } : null,
    })

  } else if (action === 'refuse') {
    await supabase
      .from('incoming_missions')
      .update({ status: 'ignored', updated_at: now })
      .eq('id', mission_id)

    await supabase.from('mission_logs').insert({
      mission_id,
      actor_id: actor?.id || null,
      action:   'cancelled',
      notes:    reason || 'Mission refusée',
    })

    return NextResponse.json({ ok: true, status: 'ignored' })
  }

  return NextResponse.json({ error: 'Action invalide' }, { status: 400 })
}
