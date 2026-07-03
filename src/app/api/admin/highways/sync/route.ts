// src/app/api/admin/highways/sync/route.ts
//
// (Re)synchronise les bornes kilométriques d'une autoroute depuis le SPW vers la
// table locale highway_bornes_km. Réservé superadmin.
//
//   POST /api/admin/highways/sync   body { highway: "A27" }  (ou plusieurs séparées par virgule)

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { syncHighwayBornes } from '@/lib/highways/resolve'

function isSuperadmin(session: any): boolean {
  const role  = session?.user?.role
  const roles = session?.user?.roles || []
  return role === 'superadmin' || (Array.isArray(roles) && roles.includes('superadmin'))
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  if (!isSuperadmin(session)) return NextResponse.json({ ok: false, error: 'Superadmin requis' }, { status: 403 })

  let highway = ''
  try { highway = (await req.json())?.highway || '' } catch { /* noop */ }
  const refs = String(highway).split(',').map(s => s.trim()).filter(Boolean)
  if (refs.length === 0) return NextResponse.json({ ok: false, error: 'Paramètre "highway" manquant' }, { status: 422 })

  const results = []
  for (const ref of refs) results.push({ highway: ref, ...(await syncHighwayBornes(ref)) })
  return NextResponse.json({ ok: results.every(r => r.ok), results })
}
