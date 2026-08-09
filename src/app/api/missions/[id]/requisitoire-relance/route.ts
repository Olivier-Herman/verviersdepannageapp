// src/app/api/missions/[id]/requisitoire-relance/route.ts
//
// POST  → envoie (ou renvoie) une relance de réquisitoire au policier.
// PATCH { stop:bool } → coche/décoche « Stop rappel réquisitoire ».
// Personnel fourrière / admin. Olivier 2026-08-08.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sessionAccess }     from '@/lib/access'
import { sendRequisitoireRelance, ensureDepotToken, depotLink } from '@/lib/requisitoire/relance'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

// GET → garantit un token de dépôt et renvoie le lien public (copie du lien).
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!sessionAccess(session, { modules: ['fourriere'] }).ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const token = await ensureDepotToken(params.id)
  if (!token) return NextResponse.json({ error: 'Token indisponible' }, { status: 500 })
  return NextResponse.json({ ok: true, token, link: depotLink(token) })
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!sessionAccess(session, { modules: ['fourriere'] }).ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const res = await sendRequisitoireRelance(params.id)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json({ ok: true, email: res.email })
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const sb = createAdminClient()
  const session = await getServerSession(authOptions)
  if (!sessionAccess(session, { modules: ['fourriere'] }).ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const stop = !!body.stop
  const { error } = await sb.from('incoming_missions').update({ requisitoire_stop: stop }).eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await sb.from('mission_logs').insert({
    mission_id: params.id, action: 'requisitoire_stop',
    notes: stop ? 'Rappels réquisitoire STOPPÉS.' : 'Rappels réquisitoire réactivés.',
  }).then(() => {}, () => {})
  return NextResponse.json({ ok: true, stop })
}
