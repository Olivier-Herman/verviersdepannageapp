// src/app/api/cron/tgr-supervisor-report/route.ts
//
// Cron MENSUEL (1er du mois) : envoie au responsable Touring le bilan TGR du
// mois écoulé (reçues / acceptées / refusées / réalisées, délai d'acceptation,
// respect de l'échéance) + le lien vers la page de supervision. Olivier 2026-07-11.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { getTgrSupervisionData } from '@/lib/tgr/supervision'
import { buildTgrReportEmail } from '@/lib/tgr/report-email'
import { sendEmail } from '@/lib/emails'

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
  const { subject, html } = buildTgrReportEmail(s, monthLabel, link)
  await sendEmail(email, subject, html)
  return NextResponse.json({ ok: true, sent_to: email, month: monthLabel, stats: s })
}
