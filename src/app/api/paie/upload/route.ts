// src/app/api/paie/upload/route.ts
//
// Upload manuel d'un batch de paie (ZIP EasyPay ou PDF FICHES_DE_PAIE direct).
// Découpe par travailleur + rattachement + stockage. Superadmin.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'
import { extractPayslipPdf, ingestPayslipPdf } from '@/lib/paie/process-batch'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!(u?.role === 'superadmin' || (u?.roles || []).includes('superadmin'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await req.json().catch(() => ({}))
  const fileB64 = String(body.file_b64 || '')
  const filename = String(body.filename || '')
  const period = String(body.period || '').trim()
  const companyCode = String(body.company_code || '').trim()
  if (!fileB64 || !period || !companyCode) return NextResponse.json({ error: 'Fichier, période et société requis' }, { status: 400 })

  const buf = Buffer.from(fileB64, 'base64')
  const sb = createAdminClient()
  try {
    let pdf: Uint8Array | null
    if (/\.zip$/i.test(filename)) pdf = await extractPayslipPdf(buf)
    else pdf = new Uint8Array(buf)   // PDF direct
    if (!pdf) return NextResponse.json({ error: 'PDF FICHES_DE_PAIE introuvable dans le ZIP' }, { status: 400 })

    const r = await ingestPayslipPdf(sb, { pdfBytes: pdf, period, companyCode, source: 'upload', sourceRef: filename })
    return NextResponse.json({ ok: true, ...r })
  } catch (e: any) {
    console.error('[paie/upload]', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
