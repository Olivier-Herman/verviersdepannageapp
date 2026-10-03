// src/app/api/sam/aide/route.ts
//
// Bouton « Aide » de l'app chauffeur (Olivier 03/10/2026) : un tour de
// conversation avec Sam. L'app envoie l'écran exact et la mission ouverte ;
// le chauffeur peut joindre une photo lui-même (pas de capture automatique).
//   { texte, ecran?, mission_id?, photo? }         → réponse de Sam
//   { confirmer: true | false }                    → « Oui, fais-le » / « Non »
// Les actions s'exécutent côté serveur, avec les droits du chauffeur connecté.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { samTurn, samConfirm, agentDuMoment } from '@/lib/sam/core'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const { data: u } = await createAdminClient().from('users').select('id, active').eq('email', email).maybeSingle()
  if (!u?.active) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  try {
    const turn = typeof b.confirmer === 'boolean'
      ? await samConfirm({ userId: u.id, canal: 'app', oui: b.confirmer })
      : await samTurn({
          userId: u.id, canal: 'app', texte: String(b.texte || '').slice(0, 2000) || '(sans texte)',
          ecran: b.ecran ? String(b.ecran).slice(0, 300) : null, missionId: b.mission_id || null,
          photo: typeof b.photo === 'string' && b.photo.length < 7_000_000 ? b.photo.replace(/^data:image\/\w+;base64,/, '') : null,
        })
    return NextResponse.json({ ok: true, agent: turn.reply.agent || agentDuMoment(), texte: turn.reply.texte, boutons: turn.reply.boutons || [], action: turn.reply.action || null, open_url: turn.openUrl || null })
  } catch (e: any) {
    console.error('[sam/aide]', e?.message || e)
    return NextResponse.json({ ok: false, agent: agentDuMoment(), error: `${agentDuMoment()} n’est pas disponible pour le moment. Si c’est urgent, appelle le dispatch.` }, { status: 502 })
  }
}
