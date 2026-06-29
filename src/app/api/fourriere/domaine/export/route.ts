// src/app/api/fourriere/domaine/export/route.ts
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD → export Excel (.xlsx) du gardiennage
// Domaine (État) sur la période. Accès : admin / superadmin / module fourriere.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { computeDomaineBilling } from '@/lib/fourriere/domaine-billing'
import * as XLSX             from 'xlsx'

export const dynamic = 'force-dynamic'

function canAccess(session: any): boolean {
  if (!session) return false
  const u = session.user as any
  const role = u.role || ''
  const modules: string[] = u.modules || []
  return ['admin', 'superadmin'].includes(role) || modules.includes('fourriere')
}
const fmtDate = (ymd: string) => ymd ? ymd.split('-').reverse().join('/') : ''

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { searchParams } = new URL(req.url)
  const from = (searchParams.get('from') || '').slice(0, 10)
  const to   = (searchParams.get('to')   || '').slice(0, 10)
  if (!from || !to) return NextResponse.json({ error: 'Période (from/to) requise' }, { status: 400 })

  const sb = createAdminClient()
  const { rows, total, totalDays } = await computeDomaineBilling(sb, from, to)

  const header = ['Immatriculation', 'Véhicule', 'Dossier', 'Remise Domaine', 'Vente', 'Jours (période)', 'Tarif/jour (€)', 'Montant HTVA (€)']
  const aoa: any[][] = [
    [`Gardiennage Domaine (État) — du ${fmtDate(from)} au ${fmtDate(to)}`],
    [],
    header,
  ]
  for (const r of rows) {
    aoa.push([
      r.plate, r.vehicle, r.dossier, fmtDate(r.remise), r.vente ? fmtDate(r.vente) : 'en cours',
      r.days, r.rate != null ? r.rate : '(variable)', Math.round(r.amount * 100) / 100,
    ])
  }
  aoa.push([])
  aoa.push(['', '', '', '', 'TOTAL', totalDays, '', Math.round(total * 100) / 100])

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 14 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 13 }, { wch: 16 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Domaine')
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  const fname = `gardiennage_domaine_${from}_${to}.xlsx`
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fname}"`,
    },
  })
}
