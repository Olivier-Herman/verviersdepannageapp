// src/app/api/cron/supervision/route.ts — rapports de suivi du bureau envoyés à Mobi (Olivier 24/11/2026).
// Chaque jour à 21 h à Bruxelles : la journée de chaque personne suivie ; le samedi en plus, la semaine (lundi →
// samedi) ; le 1er du mois en plus, le mois écoulé. Vercel planifie en UTC : passages à 19 h et 20 h UTC, la garde ne
// laisse travailler qu'à 21 h belges, une fois. « ?force=1 » relance à la main ; « &jour=AAAA-MM-JJ » rejoue un jour,
// « &quoi=jour|semaine|mois » limite l'envoi. Un échec part par mail au même destinataire (rien dans l'application).
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { sendEmail } from '@/lib/emails'
import { gardeHeureBxl, heureBxl } from '@/lib/cron/heure-bxl'
import { lireConfig, collecter, filesEnAttente, rapportJour, rapportPeriode, bornesJour, semaineDe } from '@/lib/supervision'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 300

const decale = (jour: string, n: number) => { const d = new Date(`${jour}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const garde = await gardeHeureBxl(req, 'supervision', [21]); if (garde) return garde
  const sb = createAdminClient()
  const qs = req.nextUrl.searchParams
  const jour = qs.get('jour') || heureBxl().jour
  const quoi = qs.get('quoi')
  let cfg
  try { cfg = await lireConfig(sb) } catch (e: any) { return NextResponse.json({ ok: false, error: e?.message }, { status: 500 }) }
  const envoyer = async (sujet: string, html: string) => { for (const to of cfg.destinataires) await sendEmail(to, sujet, html) }
  const fait: string[] = []
  try {
    const [d1, finJour] = bornesJour(jour)
    const d2 = new Date().toISOString() < finJour ? new Date().toISOString() : finJour
    const files = await filesEnAttente(sb, cfg)
    const actifs = (fin: string) => cfg.personnes.filter(p => p.depuis < fin)

    if (!quoi || quoi === 'jour') {
      const c = await collecter(sb, cfg, d1, d2)
      for (const p of actifs(d2)) { const r = rapportJour(cfg, p, jour, c, files); await envoyer(`📋 ${r.sujet}`, r.html); fait.push(`jour ${p.nom}`) }
    }
    const dow = new Date(`${jour}T12:00:00Z`).getUTCDay()
    if ((!quoi && dow === 6) || quoi === 'semaine') {
      const lundi = semaineDe(jour)
      const w1 = bornesJour(lundi)[0]
      const c = await collecter(sb, cfg, w1, d2)
      const p1 = bornesJour(decale(lundi, -7))[0], p2 = new Date(+new Date(d2) - 7 * 86400e3).toISOString()
      const prec = cfg.personnes.some(p => p.depuis < p2) ? await collecter(sb, cfg, p1, p2) : null
      const r = rapportPeriode({ ...cfg, personnes: actifs(d2) }, `Semaine du ${new Date(`${lundi}T12:00:00Z`).toLocaleDateString('fr-BE', { day: 'numeric', month: 'long' })}`, c, files, prec, 'jour')
      await envoyer(`📊 ${r.sujet}`, r.html); fait.push('semaine')
    }
    if ((!quoi && jour.endsWith('-01')) || quoi === 'mois') {
      // Le mois écoulé (le 1er : le mois précédent en entier).
      const m = jour.endsWith('-01') ? decale(jour, -1).slice(0, 7) : jour.slice(0, 7)
      const debut = `${m}-01`
      const fin = jour.endsWith('-01') ? jour : decale(`${m}-01`, 32).slice(0, 7) + '-01'
      const a1 = bornesJour(debut)[0], a2 = bornesJour(fin)[0]
      const c = await collecter(sb, cfg, a1, a2 < d2 ? a2 : d2)
      const mp = decale(debut, -1).slice(0, 7)
      const prec = cfg.personnes.some(p => p.depuis < a1) ? await collecter(sb, cfg, bornesJour(`${mp}-01`)[0], a1) : null
      const nomMois = new Date(`${debut}T12:00:00Z`).toLocaleDateString('fr-BE', { month: 'long', year: 'numeric' })
      const r = rapportPeriode({ ...cfg, personnes: actifs(a2) }, `Mois de ${nomMois}`, c, files, prec, 'semaine')
      await envoyer(`🗓️ ${r.sujet}`, r.html); fait.push('mois')
    }
    return NextResponse.json({ ok: true, jour, fait })
  } catch (e: any) {
    console.error('[cron/supervision]', e?.message)
    await envoyer('⚠️ Rapport de suivi du bureau non envoyé', `<p>Le rapport du ${jour} n’a pas pu être préparé : ${String(e?.message || e).replace(/</g, '&lt;')}</p><p>Déjà envoyé : ${fait.join(', ') || 'rien'}.</p>`).catch(() => {})
    return NextResponse.json({ ok: false, error: e?.message, fait }, { status: 500 })
  }
}
