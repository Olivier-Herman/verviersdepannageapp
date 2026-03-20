import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

// Vérifier que l'appelant est admin
async function checkAdmin() {
  const session = await getServerSession(authOptions)
  if (!session) return null
  if (!['admin', 'superadmin'].includes(session.user.role)) return null
  return session
}

// POST — Créer un utilisateur
export async function POST(req: NextRequest) {
  const session = await checkAdmin()
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { email, name, role } = await req.json()
  if (!email) return NextResponse.json({ error: 'Email requis' }, { status: 400 })

  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('users')
    .insert({ email, name, role: role || 'driver', active: true })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH — Modifier rôle, actif, et modules d'un utilisateur
export async function PATCH(req: NextRequest) {
  const session = await checkAdmin()
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { userId, role, active, modules } = await req.json()
  if (!userId) return NextResponse.json({ error: 'userId requis' }, { status: 400 })

  const supabase = createAdminClient()

  // Mettre à jour rôle et statut
  const { error: userError } = await supabase
    .from('users')
    .update({ role, active, updated_at: new Date().toISOString() })
    .eq('id', userId)

  if (userError) return NextResponse.json({ error: userError.message }, { status: 500 })

  // Récupérer tous les modules disponibles
  const { data: allModules } = await supabase
    .from('modules')
    .select('id')

  // Upsert tous les modules (granted = true/false)
  if (allModules) {
    const upserts = allModules.map(mod => ({
      user_id: userId,
      module_id: mod.id,
      granted: modules.includes(mod.id),
      granted_by: session.user.id,
      granted_at: new Date().toISOString()
    }))

    const { error: modError } = await supabase
      .from('user_modules')
      .upsert(upserts, { onConflict: 'user_id,module_id' })

    if (modError) return NextResponse.json({ error: modError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
