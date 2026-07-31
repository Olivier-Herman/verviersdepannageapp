// src/app/api/admin/achats/route.ts
//
// Moteur d'optimisation des achats — agrégats des factures fournisseurs Odoo.
// Superadmin uniquement (phase de test ; rôle Acheteur à venir). Olivier 2026-07-31.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { analyzeAchats }     from '@/lib/achats/odoo-spend'

export const dynamic     = 'force-dynamic'
export const fetchCache   = 'force-no-store'
export const maxDuration  = 60

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  const isSuper = u?.role === 'superadmin' || (u?.roles || []).includes('superadmin')
  if (!isSuper) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const months = Math.min(Math.max(parseInt(new URL(req.url).searchParams.get('months') || '12'), 1), 24)
  try {
    const data = await analyzeAchats(months)
    return NextResponse.json({ ok: true, ...data })
  } catch (e: any) {
    console.error('[admin/achats]', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
