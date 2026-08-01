// src/app/api/prestations/pdf/route.ts
//
// Aperçu / téléchargement de la feuille de présence PDF d'une période. Superadmin/RH.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'
import { isPersonnelStaff }          from '@/lib/rh-access'
import { generatePrestationsPdf }    from '@/lib/prestations/generate-pdf'

export const dynamic    = 'force-dynamic'
export const fetchCache  = 'force-no-store'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!isPersonnelStaff(session?.user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const period = req.nextUrl.searchParams.get('period') || ''
  if (!period) return NextResponse.json({ error: 'period requis' }, { status: 400 })

  const sb = createAdminClient()
  const { data: sheets } = await sb.from('prestation_sheets').select('*').eq('period', period).order('worker_name')
  if (!sheets?.length) return NextResponse.json({ error: 'Aucune feuille pour cette période' }, { status: 404 })

  const cc = sheets[0].company_code || '438'
  const signed     = !!sheets[0].signed_by
  const signedBy   = sheets[0].signed_by || ''
  const signedDate = sheets[0].validated_at ? new Date(sheets[0].validated_at).toLocaleDateString('fr-BE') : ''

  let generalNote = ''
  const { data: gn } = await sb.from('app_settings').select('value').eq('key', 'prestation_notes').maybeSingle()
  try { const map = gn?.value ? (typeof gn.value === 'string' ? JSON.parse(gn.value) : gn.value) : {}; generalNote = map[period] || '' } catch {}

  const bytes = await generatePrestationsPdf(period, cc, sheets as any, signedBy, signedDate, signed, generalNote)
  return new NextResponse(Buffer.from(bytes), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="feuille-presence-${period}.pdf"` },
  })
}
