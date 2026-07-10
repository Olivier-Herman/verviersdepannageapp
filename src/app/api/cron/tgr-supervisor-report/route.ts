// src/app/api/cron/tgr-supervisor-report/route.ts
//
// Cron MENSUEL (1er du mois) : envoie au responsable Touring le bilan TGR du
// mois écoulé (reçues / acceptées / refusées / réalisées, délai d'acceptation,
// respect de l'échéance) + le lien vers la page de supervision. Olivier 2026-07-11.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { getTgrSupervisionData } from '@/lib/tgr/supervision'
import { sendEmail, emailLayout, button, infoRow } from '@/lib/emails'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.verviersdepannage.com'

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = createAdminClient()
  const { data: cfg } = await sb.from('app_settings').select('value').eq('key', 'tgr_supervisor_email').maybeSingle()
  const email = String(cfg?.value || '').trim()
  if (!email) return NextResponse.json({ ok: true, skipped: 'aucun email superviseur configuré' })

  // Mois écoulé.
  const now  = new Date()
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const to   = new Date(now.getFullYear(), now.getMonth(), 1)
  const data = await getTgrSupervisionData(sb, { from: from.toISOString(), to: to.toISOString() })
  const s = data.stats

  const { data: tok } = await sb.from('tgr_supervisor_tokens')
    .select('token').eq('revoked', false).order('created_at', { ascending: false }).limit(1).maybeSingle()
  const link = tok?.token ? `${APP_URL}/superv/tgr?token=${tok.token}` : null

  const monthLabel = from.toLocaleDateString('fr-BE', { month: 'long', year: 'numeric' })
  const content = `
    <h2 style="margin:0 0 16px">Bilan TGR — ${monthLabel}</h2>
    ${infoRow('Commandes reçues', String(s.total))}
    ${infoRow('Acceptées', String(s.accepted))}
    ${infoRow('Refusées', String(s.refused))}
    ${infoRow('Reprises', String(s.taken))}
    ${infoRow('Réalisées', String(s.completed))}
    ${infoRow("Délai moyen d'acceptation", s.avg_accept_hours != null ? `${s.avg_accept_hours} h` : '—')}
    ${infoRow("Respect de l'échéance", s.on_time_rate != null ? `${s.on_time_rate} % (${s.on_time} à temps · ${s.late} en retard)` : '—')}
    <p style="color:#64748b;font-size:13px;margin-top:16px">Détail commande par commande (délais, dates de clôture) sur la page de supervision :</p>
    ${link ? button(link, '📊 Voir le détail en ligne') : '<p style="color:#b45309">Lien de supervision non configuré (voir /admin/tgr).</p>'}
  `
  await sendEmail(email, `Bilan TGR — ${monthLabel}`, emailLayout(content, 'Bilan TGR mensuel'))
  return NextResponse.json({ ok: true, sent_to: email, month: monthLabel, stats: s })
}
