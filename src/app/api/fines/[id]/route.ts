// src/app/api/fines/[id]/route.ts
//
// PATCH /api/fines/[id]   body: { driver_id: string | null }
//   Attribue (ou réattribue / retire) manuellement le chauffeur d'une amende
//   depuis la liste des amendes. Accès : admin / superadmin / module facturation.
//
// Olivier 2026-07-01.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { parseTowsoftDateUTC } from '@/lib/towsoft-client'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  const role = user?.role || ''
  const modules: string[] = Array.isArray(user?.modules) ? user.modules : []
  if (!user || (!['admin', 'superadmin'].includes(role) && !modules.includes('facturation'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const sb = createAdminClient()
  const update: Record<string, any> = {}
  let driverName: string | null = null

  // Attribution chauffeur
  if ('driver_id' in body) {
    const driverId: string | null = body.driver_id ? String(body.driver_id) : null
    if (driverId) {
      const { data: d } = await sb.from('users').select('name').eq('id', driverId).maybeSingle()
      if (!d) return NextResponse.json({ error: 'Chauffeur introuvable' }, { status: 404 })
      driverName = d.name
    }
    update.driver_id = driverId
    update.driver_match_method = driverId ? 'manual' : 'none'
    update.driver_match_confidence = null
  }

  // Édition de la fiche (brouillon) — le montant est le champ clé (complète la fiche).
  if ('amount' in body) {
    const amt = body.amount === null || body.amount === '' ? null : Number(body.amount)
    if (amt !== null && (!Number.isFinite(amt) || amt <= 0)) {
      return NextResponse.json({ error: 'Montant invalide (> 0 ou vide)' }, { status: 400 })
    }
    update.amount = amt
  }
  if ('infraction_place'    in body) update.infraction_place    = body.infraction_place    || null
  if ('identification_code' in body) update.identification_code = body.identification_code || null
  if ('infraction_type'  in body) update.infraction_type  = body.infraction_type  || null
  if ('infraction_ref' in body) {
    const refN = String(body.infraction_ref || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (refN) {
      const { data: refs } = await sb.from('fines').select('id, infraction_ref').not('infraction_ref', 'is', null).neq('id', params.id)
      const dup = (refs || []).some((r: any) => String(r.infraction_ref || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === refN)
      if (dup) return NextResponse.json({ error: `Ce n° de PV (${body.infraction_ref}) est déjà enregistré sur une autre amende.` }, { status: 409 })
    }
    update.infraction_ref = body.infraction_ref || null
  }
  if ('plate'            in body) update.plate            = String(body.plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || '—'
  if ('infraction_date' in body && body.infraction_date) {
    const iso = parseTowsoftDateUTC(String(body.infraction_date))   // saisie = heure locale BE
    if (iso) update.infraction_date = iso
  }

  if (Object.keys(update).length === 0) return NextResponse.json({ error: 'Rien à mettre à jour' }, { status: 400 })

  const { error } = await sb.from('fines').update(update).eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, driver_id: update.driver_id, driver_name: driverName, amount: update.amount })
}
