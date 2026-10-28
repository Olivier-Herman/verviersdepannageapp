// POST /api/missions/[id]/numero-client — « Demander le numéro à Sam » (Olivier 28/10/2026, maquette validée).
// La fiche n'a aucun numéro du client : Sam va le chercher chez l'assistance (même recherche que dans ses
// conversations) et complète la fiche. Pas trouvé : on le dit, sans renvoyer au dispatch.
//   → { ok, tel, nom } | { ok, absent: true, source }

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sessionAccess } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SOURCE: Record<string, string> = { kaze: 'IMA', touring: 'Touring', vab: 'VAB', axa: 'AXA', mondial: 'Mondial', allianz: 'Allianz' }

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const uid = (session?.user as any)?.id
  if (!uid) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const sb = createAdminClient()
  const { data: m } = await sb.from('incoming_missions').select('id, source, assigned_to, client_name, client_phone, assisted_name, assisted_phone').eq('id', params.id).maybeSingle()
  if (!m) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  if (m.assigned_to !== uid && !sessionAccess(session, { roles: ['admin', 'superadmin', 'dispatcher'] }).ok) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  if (m.client_phone || m.assisted_phone) return NextResponse.json({ ok: true, tel: m.client_phone || m.assisted_phone, nom: m.client_name || m.assisted_name || null })

  const { detailsAssistance, completerFiche } = await import('@/lib/missions/details-assistance')
  const d = await detailsAssistance(m.id).catch(() => null)
  const source = d?.origine || SOURCE[String(m.source || '').split('_')[0]] || 'L’assistance'
  if (!d?.telephone) {
    await sb.from('mission_logs').insert({ mission_id: m.id, actor_id: uid, action: 'numero_client', notes: `Numéro du client demandé par le chauffeur : ${source} n’en a pas.` }).then(() => {}, () => {})
    return NextResponse.json({ ok: true, absent: true, source })
  }
  await completerFiche(m.id, d)
  await sb.from('mission_logs').insert({ mission_id: m.id, actor_id: uid, action: 'numero_client', notes: `Numéro du client demandé par le chauffeur : trouvé chez ${source} et ajouté à la fiche.` }).then(() => {}, () => {})
  return NextResponse.json({ ok: true, tel: d.telephone, nom: d.contact || m.client_name || null, source })
}
