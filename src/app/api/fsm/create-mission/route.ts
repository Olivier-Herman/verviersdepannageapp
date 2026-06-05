// src/app/api/fsm/create-mission/route.ts
//
// Crée le dossier Odoo (Helpdesk + FSM Task) pour une mission.
// Garde comme route de fallback / re-création manuelle via bouton sur la fiche dispatch.
//
// Depuis Phase 1 du chantier dispatch (mai 2026), la création AUTO se fait
// directement à la confirmation dispatch via /api/missions/confirm.
// Cette route reste utile :
//   - en fallback si l'auto-création a échoué (la mission a alors un log 'error')
//   - pour les anciennes missions confirmées avant la mise en place de l'auto-création
//   - pour la création manuelle d'une mission via /dispatch/new (workflow custom)
//
// Idempotence garantie par le helper (retourne les IDs existants si déjà créé).

import { NextResponse }                 from 'next/server'
import { getServerSession }             from 'next-auth'
import { authOptions }                  from '@/lib/auth'
import { createAdminClient }            from '@/lib/supabase'
import { createOdooDossierForMission } from '@/lib/missions/odoo-dossier'
import { withOdooActor }               from '@/lib/odoo'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    // Olivier 2026-06-05 : recupere le user connecte pour tracer le dossier
    // Odoo avec sa cle perso (au lieu du fallback VD App).
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const sb = createAdminClient()
    const { data: actor } = await sb.from('users').select('id').eq('email', session.user.email).maybeSingle()

    const body = await req.json()
    const { mission_id } = body
    if (!mission_id) return NextResponse.json({ error: 'mission_id requis' }, { status: 400 })

    const result = await withOdooActor(actor?.id, () => createOdooDossierForMission(mission_id))
    return NextResponse.json({ ok: true, ...result })

  } catch (err: any) {
    console.error('[FSM] Erreur create-mission:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
