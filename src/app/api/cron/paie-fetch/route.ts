// src/app/api/cron/paie-fetch/route.ts
//
// Récupère les mails de paie EasyPay dans info@, décompresse, découpe par
// travailleur (Claude) et stocke. Idempotent (skip si déjà présent).
// Auth : cron (Bearer CRON_SECRET) OU superadmin. Olivier 2026-08-01.

import { NextResponse }         from 'next/server'
import { getServerSession }     from 'next-auth'
import { authOptions }          from '@/lib/auth'
import { createAdminClient }    from '@/lib/supabase'
import { fetchPayslipMails }    from '@/lib/paie/fetch-mail'
import { extractPayslipPdf, ingestPayslipPdf } from '@/lib/paie/process-batch'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  const okCron = process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`
  if (!okCron) {
    const session = await getServerSession(authOptions)
    const u = session?.user as any
    if (!(u?.role === 'superadmin' || (u?.roles || []).includes('superadmin'))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const sb = createAdminClient()
  try {
    const mails = await fetchPayslipMails()
    const results: any[] = []
    for (const m of mails) {
      // Déjà traité (période + société) ? → on ne re-découpe pas (coût Claude).
      const { count } = await sb.from('payslips').select('*', { count: 'exact', head: true })
        .eq('period', m.period).eq('company_code', m.companyCode)
      if (count && count > 0) { results.push({ period: m.period, company: m.companyCode, skipped: 'déjà traité' }); continue }
      const pdf = await extractPayslipPdf(m.zipBuffer)
      if (!pdf) { results.push({ subject: m.subject, error: 'PDF fiches introuvable dans le ZIP' }); continue }
      const r = await ingestPayslipPdf(sb, {
        pdfBytes: pdf, period: m.period, companyCode: m.companyCode, source: 'mail', sourceRef: m.messageId,
      })
      results.push({ period: m.period, company: m.companyCode, ...r })
    }
    return NextResponse.json({ ok: true, mails: mails.length, results })
  } catch (e: any) {
    console.error('[paie-fetch]', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
