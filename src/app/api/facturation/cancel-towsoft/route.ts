// src/app/api/facturation/cancel-towsoft/route.ts
//
// POST /api/facturation/cancel-towsoft { towsoft_num, raison? }
//
// Olivier 2026-06-12 : apres facturation via VD Soft, annule la fiche TowSoft
// avec le motif "Facturation via OK VDS" (defaut), puis verifie que la fiche
// passe bien en statut annule cote TowSoft.
//
// Acces : admin / superadmin / module facturation.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { cancelTowsoftAppel, getTowsoftAppelStatus } from '@/lib/towsoft-client'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

const DEFAULT_MOTIF = 'Facturation via OK VDS'

function checkAccess(session: any): boolean {
  if (!session) return false
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  return ['admin', 'superadmin'].includes(role) || modules.includes('facturation')
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!checkAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const towsoftNum = String(body.towsoft_num || '').trim()
  const raison     = String(body.raison || '').trim() || DEFAULT_MOTIF

  if (!towsoftNum) {
    return NextResponse.json({ error: 'towsoft_num requis' }, { status: 400 })
  }

  // 1. Annulation
  const result = await cancelTowsoftAppel(towsoftNum, raison)
  if (!result.ok) {
    return NextResponse.json({
      ok: false,
      error: `Annulation TowSoft échouée : ${result.error || result.http_status}`,
      detail: result,
    }, { status: 502 })
  }

  // 2. Verification best-effort : re-lit le statut de la fiche
  let verifiedStatus: string | null = null
  let verified = false
  try {
    verifiedStatus = await getTowsoftAppelStatus(towsoftNum)
    verified = !!verifiedStatus && /annul/i.test(verifiedStatus)
  } catch (e: any) {
    console.warn('[cancel-towsoft] verification KO:', e.message)
  }

  return NextResponse.json({
    ok:             true,
    towsoft_num:    towsoftNum,
    raison,
    verified,                       // true si le statut TowSoft contient "annul"
    status_towsoft: verifiedStatus, // statut relu (ex "Annulé"), null si non relu
    idby:           result.idby,
  })
}
