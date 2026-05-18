// src/app/api/inventaire/export/route.ts
//
// POST /api/inventaire/export
// Body : { items: [{ missionNum, refDossier, dateMission, marque, modele,
//                    plaque, vin, motif, parc, ... }] }
//
// Genere un CSV (UTF-8 BOM, separateur ; pour Excel BE/FR) de la session
// d inventaire en cours. Port direct de Verviers-QR pages/api/inventory/export.js

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as { items?: any[] }
  const items = Array.isArray(body.items) ? body.items : []
  if (items.length === 0) {
    return NextResponse.json({ error: 'Aucun element a exporter' }, { status: 400 })
  }

  const headers = [
    'N° Mission TowSoft', 'Ref Dossier', 'Date Mission',
    'Marque/Modele', 'Plaque', 'VIN', 'Motif', 'Zone/Parc',
  ]
  const rows = items.map(item => [
    item.missionNum || '',
    item.refDossier || '',
    item.dateMission ? String(item.dateMission).split(' ')[0] : '',
    [item.marque, item.modele].filter(Boolean).join(' '),
    item.plaque || '',
    item.vin || '',
    item.motif || '',
    item.parc || item.zone || '',
  ])

  const csvContent = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
    .join('\n')

  const csv = '﻿' + csvContent  // BOM pour Excel
  const date = new Date().toISOString().split('T')[0]

  return new Response(csv, {
    headers: {
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="inventaire-${date}.csv"`,
    },
  })
}
