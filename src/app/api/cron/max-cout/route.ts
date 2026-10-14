// Cron (le 1er du mois, matin) : récap du coût de Max le mois écoulé, envoyé à Mobi en
// privé sur Telegram (Olivier 14/10/2026). Un échec se voit : réponse 500 + journal.
import { NextResponse }      from 'next/server'
import { maxMonth, monthKey } from '@/lib/assistant/max-cost'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const m = await maxMonth(monthKey(-1))
    const lignes = m.personnes.length ? m.personnes.map(p => `• ${p.nom} : ${p.cout_usd.toFixed(2)} $ (${p.questions} question${p.questions > 1 ? 's' : ''})`).join('\n') : '• personne ne l’a utilisé'
    const text = `🧭 Coût de Max — ${m.libelle}\nTotal : ${m.cout_usd.toFixed(2)} $ · ${m.questions} question${m.questions > 1 ? 's' : ''} · ${m.appels} appels\n${lignes}\nDétail : Admin › Conversations de Max`
    const { getBusinessNumber } = await import('@/lib/settings/business')
    const { tgSend } = await import('@/lib/sam/telegram')
    await tgSend(await getBusinessNumber('telegram_chat_mobi'), text)
    return NextResponse.json({ ok: true, ...m })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 })
  }
}
