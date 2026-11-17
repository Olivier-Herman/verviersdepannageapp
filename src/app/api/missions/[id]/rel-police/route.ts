// POST /api/missions/[id]/rel-police { choix: 'rel_pec' | 'rel' | 'isolee' } — décision du dispatch pour une commande
// d'assistance sur un véhicule au parc après un appel police (Olivier 16/11/2026). Cf lib/missions/rel-police.ts.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { deciderRelPolice } from '@/lib/missions/rel-police'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const roles: string[] = Array.isArray(user.roles) && user.roles.length ? user.roles : [user.role].filter(Boolean)
  if (!roles.some(r => ['dispatcher', 'admin', 'superadmin'].includes(r))) return NextResponse.json({ error: 'Réservé au dispatch' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  if (!['rel_pec', 'rel', 'isolee'].includes(String(body?.choix))) return NextResponse.json({ error: 'Choix inconnu' }, { status: 400 })
  const r = await deciderRelPolice(createAdminClient(), params.id, { id: user.id, name: user.name || null }, body.choix)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, already: !!r.already, note: r.note || null })
}
