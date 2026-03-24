// src/app/api/admin/users/roles/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }         from 'next-auth'
import { authOptions }              from '@/lib/auth'
import { createAdminClient }        from '@/lib/supabase'

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const role = (session.user as any).role || ''
  if (!['admin', 'superadmin'].includes(role)) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const { userId, roles } = await req.json()

  if (!userId) return NextResponse.json({ error: 'userId requis' }, { status: 400 })
  if (!Array.isArray(roles) || roles.length === 0) {
    return NextResponse.json({ error: 'Au moins un rôle requis' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { error } = await supabase
    .from('users')
    .update({
      role:       roles[0],
      roles:      roles,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)

  if (error) {
    console.error('[PATCH roles]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, role: roles[0], roles })
}
