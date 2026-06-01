// POST /api/users/me/current-truck { truck_id }
// Le chauffeur change sa depanneuse en service (lui-meme).
// Met aussi a jour current_truck_set_at pour piloter le modal 7h/17h.
//
// GET  /api/users/me/current-truck
// Retourne l etat actuel : current_truck + default_truck + needs_confirmation
// (true si current_truck_set_at < dernier seuil 7h ou 17h franchi).
//
// Olivier 2026-06-01.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * Retourne le dernier seuil (7h00 ou 17h00) franchi.
 * Si current_truck_set_at < ce seuil, on doit redemander confirmation au chauffeur.
 */
function lastThreshold(now: Date): Date {
  const today7  = new Date(now); today7.setHours(7, 0, 0, 0)
  const today17 = new Date(now); today17.setHours(17, 0, 0, 0)
  if (now >= today17) return today17
  if (now >= today7)  return today7
  // Avant 7h : dernier seuil = 17h hier
  const yesterday17 = new Date(today17); yesterday17.setDate(yesterday17.getDate() - 1)
  return yesterday17
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const { data: u } = await sb
    .from('users')
    .select(`
      id,
      default_truck_id, current_truck_id, current_truck_set_at, truck_confirm_disabled,
      default_truck:trucks!users_default_truck_id_fkey(id, name, plate, active),
      current_truck:trucks!users_current_truck_id_fkey(id, name, plate, active)
    `)
    .eq('email', session.user.email!)
    .maybeSingle()

  if (!u) return NextResponse.json({ error: 'User introuvable' }, { status: 404 })

  const confirmDisabled = !!(u as any).truck_confirm_disabled
  const setAt = u.current_truck_set_at ? new Date(u.current_truck_set_at) : null
  const threshold = lastThreshold(new Date())
  // Si confirm_disabled, on ne demande jamais confirmation (Olivier 2026-06-01)
  const needsConfirmation = confirmDisabled ? false : (!setAt || setAt < threshold)

  return NextResponse.json({
    default_truck:          u.default_truck,
    current_truck:          u.current_truck,
    current_truck_set_at:   u.current_truck_set_at,
    needs_confirmation:     needsConfirmation,
    confirm_disabled:       confirmDisabled,
    threshold:              threshold.toISOString(),
  })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const truckId = body.truck_id === null || body.truck_id === ''
    ? null
    : String(body.truck_id).trim()

  const sb = createAdminClient()
  const { data: me } = await sb.from('users').select('id').eq('email', session.user.email!).maybeSingle()
  if (!me) return NextResponse.json({ error: 'User introuvable' }, { status: 404 })

  const now = new Date().toISOString()
  const { error } = await sb
    .from('users')
    .update({
      current_truck_id:     truckId,
      current_truck_set_at: now,
      updated_at:           now,
    })
    .eq('id', me.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, current_truck_id: truckId, set_at: now })
}
