// DEBUG superadmin : dumpe les colonnes brutes COMEX d'un dossier pour
// identifier l'index d'une valeur (ex. total avec majoration nuit).
// GET /api/touring/comex-bko/debug?dossier=2026BE301474
// Olivier 2026-07-31 — temporaire.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { dumpDossColumns }           from '@/lib/touring/comex-bko'

export const dynamic    = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u || (u.role !== 'superadmin' && !(u.roles || []).includes('superadmin')))
    return NextResponse.json({ error: 'Réservé au superadmin' }, { status: 403 })

  const dossier = new URL(req.url).searchParams.get('dossier') || ''
  if (!dossier) return NextResponse.json({ error: 'dossier requis' }, { status: 400 })

  try {
    const rows = await dumpDossColumns(dossier)
    return NextResponse.json({ ok: true, dossier, rows })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'échec' }, { status: 500 })
  }
}
