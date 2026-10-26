// POST /api/sam/signaler — « Signaler à Sam / Sonic » (Olivier 26/10/2026, création de 2FNJ975 ratée le 24/10
// sans aucune trace). Le chauffeur envoie l'erreur affichée et un mot facultatif :
//   - la ligne d'erreur (error_logs) est marquée « signalée » avec son mot et le contexte de l'écran ;
//   - l'échange entre dans sa conversation avec Sam / Sonic (journal des conversations) ;
//   - Mobi est prévenu sur Telegram et l'erreur remonte au bureau du jour (bloc « Erreurs signalées »).
// La réponse de Sam est fixe : rien à attendre d'un appel à l'IA quand quelque chose vient de planter.
//   { error_id?, message, where, mission_id?, context?, note? } → { ok, agent, texte, ref }

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { agentDeService } from '@/lib/sam/core'
import { recordExchange } from '@/lib/sam/journal'
import { tString } from '@/lib/i18n/lookup'
import { refErreur } from '@/lib/erreurs/ref'

export const dynamic = 'force-dynamic'

const OU: Record<string, string> = {
  creation: 'création de mission', mission: 'fiche mission', action: 'pointage sur la fiche', global: 'affichage de l’app',
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const sb = createAdminClient()
  const { data: u } = await sb.from('users').select('id, name, language, active').eq('email', email).maybeSingle()
  if (!u?.active) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const b = await req.json().catch(() => ({} as any))
  const message = String(b.message || 'erreur sans message').slice(0, 1500)
  const where = String(b.where || 'action').slice(0, 40)
  const note = String(b.note || '').trim().slice(0, 1000)
  const missionId = typeof b.mission_id === 'string' && /^[0-9a-f-]{36}$/i.test(b.mission_id) ? b.mission_id : null
  const context = b.context && typeof b.context === 'object' ? b.context : null
  const now = new Date().toISOString()

  // La ligne d'erreur : celle déjà enregistrée à l'affichage, sinon une nouvelle.
  let errorId: string | null = typeof b.error_id === 'string' && /^[0-9a-f-]{36}$/i.test(b.error_id) ? b.error_id : null
  const { data: row } = errorId ? await sb.from('error_logs').select('id, metadata').eq('id', errorId).maybeSingle() : { data: null }
  const signale = { at: now, note: note || null, where, mission_id: missionId, context, ua: req.headers.get('user-agent') || null }
  if (row) {
    await sb.from('error_logs').update({ metadata: { ...(row.metadata || {}), signale } }).eq('id', row.id)
  } else {
    const { data: ins } = await sb.from('error_logs').insert({
      level: 'error', route: `driver:${where}`, message, metadata: { signale, where, mission_id: missionId, context },
      user_id: u.id, user_email: email,
    }).select('id').single()
    errorId = ins?.id || null
  }
  const ref = refErreur(errorId)

  const agent = await agentDeService().catch(() => 'Sam')
  const cle = where === 'creation' ? 'signaler.reply_create' : 'signaler.reply_other'
  const lang = u.language === 'sq' ? 'sq' : 'fr'
  const texte = tString(lang, cle)

  let plaque: string | null = null
  if (missionId) {
    const { data: m } = await sb.from('incoming_missions').select('vehicle_plate, mission_number').eq('id', missionId).maybeSingle()
    plaque = [m?.vehicle_plate, m?.mission_number ? `fiche ${m.mission_number}` : null].filter(Boolean).join(' · ') || null
  } else if (context?.plaque) plaque = String(context.plaque).slice(0, 20)

  await recordExchange({
    userId: u.id, missionId, canal: 'app',
    texte: `🛟 Erreur signalée (${OU[where] || where}${ref ? `, ${ref}` : ''}) : ${message}${note ? `\n${note}` : ''}`,
    reply: { agent, texte, texte_fr: lang === 'sq' ? tString('fr', cle) : undefined },
  })

  try {
    const { notifierTelegram } = await import('@/lib/notif/heures-mobi')
    const { getBusinessNumber } = await import('@/lib/settings/business')
    await notifierTelegram(await getBusinessNumber('telegram_chat_mobi'),
      `🛟 ${u.name || 'Un chauffeur'} signale une erreur à ${agent}${ref ? ` · ${ref}` : ''}\n${OU[where] || where}${plaque ? ` · ${plaque}` : ''}\n${message}${note ? `\n« ${note} »` : ''}`,
      [], agent)
  } catch (e: any) { console.error('[sam/signaler] telegram', e?.message) }

  return NextResponse.json({ ok: true, agent, texte, ref })
}
