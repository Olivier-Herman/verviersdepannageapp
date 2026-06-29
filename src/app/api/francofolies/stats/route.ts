// src/app/api/francofolies/stats/route.ts
//
// GET /api/francofolies/stats — statistiques chauffeur (qui a ramené combien de
// véhicules) + totaux de l'évènement. Le chauffeur est dans assigned_to ; pour
// les "Autre" (nom libre), on récupère "Ramené par : X" dans remarks_general.
//
// Olivier 2026-06-29.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function canAccess(session: any): boolean {
  if (!session) return false
  const u = session.user as any
  const role = u.role || ''
  const roles: string[] = Array.isArray(u.roles) ? u.roles : [role]
  const modules: string[] = u.modules || []
  return ['admin', 'superadmin', 'dispatcher'].some(r => role === r || roles.includes(r))
    || modules.includes('francofolies')
    || roles.includes('driver') || roles.includes('chauffeur')
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('incoming_missions')
    .select(`id, status, assigned_to, remarks_general, amount_to_collect, amount_collected,
             assigned_user:users!assigned_to(id, name)`)
    .eq('source', 'francofolies')
    .not('status', 'in', '(cancelled,ignored)')
    .limit(5000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = data || []
  const PICKED = ['to_invoice', 'completed', 'invoiced']

  // Agrégation par chauffeur.
  const byDriver = new Map<string, { name: string; total: number; picked: number; collected: number }>()
  let totalCollected = 0, totalPicked = 0, totalParked = 0

  for (const m of rows as any[]) {
    let name: string = m.assigned_user?.name || ''
    if (!name) {
      const mm = /Ramené par\s*:\s*([^·\n]+)/i.exec(m.remarks_general || '')
      name = (mm?.[1] || '').trim() || 'Non attribué'
    }
    const key = name.toLowerCase()
    const e = byDriver.get(key) || { name, total: 0, picked: 0, collected: 0 }
    e.total += 1
    const isPicked = PICKED.includes(m.status)
    if (isPicked) { e.picked += 1; totalPicked += 1 }
    else if (m.status === 'parked') totalParked += 1
    const col = Number(m.amount_collected || 0)
    e.collected += col
    totalCollected += col
    byDriver.set(key, e)
  }

  const drivers = [...byDriver.values()].sort((a, b) => b.total - a.total)

  return NextResponse.json({
    ok: true,
    totals: { vehicles: rows.length, picked: totalPicked, parked: totalParked, collected: Math.round(totalCollected * 100) / 100 },
    drivers,
  })
}
