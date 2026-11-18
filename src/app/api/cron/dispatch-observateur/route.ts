// Tâche du lundi matin : bilan hebdomadaire de l'agent observateur du dispatch, envoyé à Mobi dans la Supervision
// (Olivier 18/11/2026). L'agent ne fait qu'observer. Un échec se voit : réponse 500.
import { NextResponse } from 'next/server'
import { informerMobi } from '@/lib/notif/heures-mobi'
import { bilanObservateur } from '@/lib/dispatch/observateur'
import { getBusinessNumber } from '@/lib/settings/business'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const texte = await bilanObservateur(7)
    if (!texte) return NextResponse.json({ ok: true, rien: true })
    await informerMobi(await getBusinessNumber('telegram_chat_mobi'), texte, [], 'Agent observateur', { cle: `observateur-dispatch-${new Date().toISOString().slice(0, 10)}` })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 })
  }
}
