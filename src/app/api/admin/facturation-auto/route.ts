// src/app/api/admin/facturation-auto/route.ts — interrupteur « Mes assistants » (Olivier 26/10/2026, élargi le 28/10/2026 :
// la facturation automatique et tous les assistants de Mobi, avec un bouton par bloc).
// GET  → état général (en marche / en pause, depuis, par qui, motif), option hors heures, état de chaque bloc et ce qui
//        attend, journal ; seulement pour les comptes de facturation_auto_interrupteur_user_ids (Olivier seul).
// POST → { enMarche, motif? }            : tout en pause / tout reprend
//        { cle, enMarche, motif? }       : un bloc seul
//        { horsHeures: boolean }         : pause automatique en dehors des heures de Mobi
//        Toute autre personne : refus (403) noté au journal. Une reprise relance tout de suite les blocs concernés.
import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import {
  etatFacturationAuto, journalFacturationAuto, peutBasculer, basculerFacturationAuto, noterRefus,
  ASSISTANTS, pausesIndividuelles, pauseHorsHeuresActive, assistantsEnPause, definirPauseHorsHeures, basculerAssistant,
  relancerBlocs, enAttente, type CleAssistant,
} from '@/lib/facturation/suspension'

export const dynamic = 'force-dynamic'

async function etat(sb: any) {
  const [base, journal, rat, pauses, horsHeures, effectif, attente] = await Promise.all([
    etatFacturationAuto(sb), journalFacturationAuto(sb, 20),
    sb.from('app_settings').select('value').eq('key', 'facturation_auto_dernier_rattrapage').maybeSingle(),
    pausesIndividuelles(sb), pauseHorsHeuresActive(sb), assistantsEnPause(sb), enAttente(sb),
  ])
  let rattrapage: any = null
  try { rattrapage = rat.data?.value ? (typeof rat.data.value === 'string' ? JSON.parse(rat.data.value) : rat.data.value) : null } catch { /* illisible */ }
  const assistants = ASSISTANTS.map(a => ({ ...a, enPause: !!pauses[a.cle], attente: attente[a.cle] || null }))
  return { visible: true, ...base, horsHeures, pauseHorsHeuresEnCours: effectif && base.enMarche, assistants, journal, rattrapage, peutBasculer: true }
}

const lancer = (task: Promise<any>) => { import('@vercel/functions').then(m => m.waitUntil(task)).catch(() => {}) }

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const me = session.user as any
  // « Le bandeau, juste pour moi » (Olivier 26/10/2026) : les autres comptes ne voient ni l'état ni le journal.
  if (!(await peutBasculer(me.id))) return NextResponse.json({ visible: false })
  return NextResponse.json(await etat(createAdminClient()))
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const me = session.user as any
  const body = await req.json().catch(() => ({}))
  const sb = createAdminClient()
  const par = { id: me.id || null, nom: me.name || me.email || null }
  const refus = NextResponse.json({ error: 'Seul Olivier peut mettre ses assistants en pause ou les relancer.' }, { status: 403 })
  if (!(await peutBasculer(me.id))) {
    await noterRefus(sb, par, body?.enMarche !== false)
    return refus
  }
  try {
    if (typeof body?.horsHeures === 'boolean') {
      await definirPauseHorsHeures(sb, body.horsHeures, par)
    } else if (typeof body?.enMarche !== 'boolean') {
      return NextResponse.json({ error: 'enMarche (true/false) ou horsHeures requis' }, { status: 400 })
    } else if (body.cle) {
      const cle = String(body.cle) as CleAssistant
      if (!ASSISTANTS.some(a => a.cle === cle)) return NextResponse.json({ error: 'Assistant inconnu' }, { status: 400 })
      const r = await basculerAssistant(sb, cle, body.enMarche, par, body.motif)
      if (r.change && body.enMarche && !(await assistantsEnPause(sb))) lancer(relancerBlocs(sb, [cle]))
    } else {
      const r = await basculerFacturationAuto(sb, body.enMarche, par, body.motif)
      // Reprise générale : chaque bloc qui n'est pas en pause seul rattrape tout de suite ; résumé sur Telegram.
      if (r.change && body.enMarche) {
        const p = await pausesIndividuelles(sb)
        lancer(relancerBlocs(sb, ASSISTANTS.map(a => a.cle).filter(c => !p[c])))
      }
    }
    return NextResponse.json({ ok: true, ...(await etat(sb)) })
  } catch (e: any) {
    if (e?.message === 'NON_AUTORISE') return refus
    return NextResponse.json({ error: e?.message || 'Erreur' }, { status: 500 })
  }
}
