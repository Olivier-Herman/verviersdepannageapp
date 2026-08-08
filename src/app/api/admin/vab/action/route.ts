// src/app/api/admin/vab/action/route.ts
//
// POST (superadmin) — EXÉCUTE une action VAB (postback OutSystems) sur une
// mission. ⚠️ IRRÉVERSIBLE côté VAB. Body :
//   { detailHref, eventTarget, extraFields?: {name:value}, eventArgument? }
// Renvoie l'état résultant (nouveaux boutons/message). Pilotage pas-à-pas de la
// clôture (avec Franck). Olivier 2026-08-08.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { loginVab, executeVabAction } from '@/lib/vab/scraper'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  const roles = Array.isArray(user?.roles) ? user.roles : [user?.role].filter(Boolean)
  if (!roles?.includes('superadmin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const detailHref  = String(body.detailHref || '').trim()
  const eventTarget = String(body.eventTarget || '').trim()
  const eventArgument = String(body.eventArgument || '')
  const extraFields = (body.extraFields && typeof body.extraFields === 'object') ? body.extraFields as Record<string, string> : {}
  if (!detailHref || !eventTarget) return NextResponse.json({ error: 'detailHref + eventTarget requis' }, { status: 400 })

  try {
    const sess = await loginVab()
    const result = await executeVabAction(sess, detailHref, eventTarget, extraFields, eventArgument)
    return NextResponse.json(result)
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 })
  }
}
