// src/app/api/admin/users/actif/route.ts
// Réactivation en un clic d'un membre parti (16/10/2026, départ de Tayson) : ne touche
// QUE `active` — le PATCH complet de /api/admin/users réécrit tous les champs de la fiche.
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }         from 'next-auth'
import { authOptions }              from '@/lib/auth'
import { createAdminClient }        from '@/lib/supabase'

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const roles: string[] = (session.user as any).roles || [(session.user as any).role]
  if (!roles.some(r => ['admin', 'superadmin'].includes(r))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const { userId, active } = await req.json().catch(() => ({}))
  if (!userId || typeof active !== 'boolean') return NextResponse.json({ error: 'Demande incomplète' }, { status: 400 })

  const { data, error } = await createAdminClient().from('users')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('id', userId).select('id, name, active').maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })
  return NextResponse.json({ ok: true, user: data })
}
