// src/app/api/admin/facturation-auto/route.ts — interrupteur général de la facturation automatique (Olivier 26/10/2026).
// GET  → état (en marche / suspendue, depuis, par qui, motif), journal, et si l'utilisateur peut basculer.
// POST → { enMarche: boolean, motif?: string } : réservé aux comptes de facturation_auto_interrupteur_user_ids
//        (Olivier seul) ; toute autre tentative est refusée (403) et notée au journal.
import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { etatFacturationAuto, journalFacturationAuto, peutBasculer, basculerFacturationAuto, noterRefus, rattraperApresReprise } from '@/lib/facturation/suspension'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const me = session.user as any
  // « Le bandeau, juste pour moi » (Olivier 26/10/2026) : les autres comptes ne voient ni l'état ni le journal.
  if (!(await peutBasculer(me.id))) return NextResponse.json({ visible: false })
  const [etat, journal, rat] = await Promise.all([etatFacturationAuto(sb), journalFacturationAuto(sb, 20), sb.from('app_settings').select('value').eq('key', 'facturation_auto_dernier_rattrapage').maybeSingle()])
  let rattrapage: any = null
  try { rattrapage = rat.data?.value ? (typeof rat.data.value === 'string' ? JSON.parse(rat.data.value) : rat.data.value) : null } catch { /* illisible */ }
  return NextResponse.json({ visible: true, ...etat, journal, rattrapage, peutBasculer: true })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const me = session.user as any
  const body = await req.json().catch(() => ({}))
  if (typeof body?.enMarche !== 'boolean') return NextResponse.json({ error: 'enMarche (true/false) requis' }, { status: 400 })
  const sb = createAdminClient()
  const par = { id: me.id || null, nom: me.name || me.email || null }
  if (!(await peutBasculer(me.id))) {
    await noterRefus(sb, par, body.enMarche)
    return NextResponse.json({ error: 'Seul Olivier peut suspendre ou relancer la facturation automatique.' }, { status: 403 })
  }
  try {
    const r = await basculerFacturationAuto(sb, body.enMarche, par, body.motif)
    // Remise sur on : rattrapage immédiat en tâche de fond, résumé à Olivier sur Telegram.
    if (r.change && body.enMarche) {
      const task = rattraperApresReprise(sb).catch(() => null)
      try { const { waitUntil } = await import('@vercel/functions'); waitUntil(task) } catch { /* hors Vercel */ }
    }
    return NextResponse.json({ ok: true, change: r.change, ...(await etatFacturationAuto(sb)) })
  } catch (e: any) {
    if (e?.message === 'NON_AUTORISE') return NextResponse.json({ error: 'Seul Olivier peut suspendre ou relancer la facturation automatique.' }, { status: 403 })
    return NextResponse.json({ error: e?.message || 'Erreur' }, { status: 500 })
  }
}
