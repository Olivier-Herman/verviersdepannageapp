import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }         from 'next-auth'
import { authOptions }              from '@/lib/auth'
import { createAdminClient }        from '@/lib/supabase'
import { sendAccountActivated }     from '@/lib/emails'

async function checkAdmin() {
  const session = await getServerSession(authOptions)
  if (!session) return null
  if (!['admin', 'superadmin'].includes((session.user as any).role)) return null
  return session
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const isAdmin = ['admin', 'superadmin', 'dispatcher'].includes((session.user as any).role)
  if (!isAdmin) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('users')
    .select('id, name, email, role, active, can_verify, personal_email, auth_provider, tgr_push_notify, odoo_partner_id, user_modules(module_id, granted)')
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}

export async function POST(req: NextRequest) {
  const session = await checkAdmin()
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { email, name, role } = await req.json()
  if (!email) return NextResponse.json({ error: 'Email requis' }, { status: 400 })

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('users')
    .insert({
      email:                email.toLowerCase(),
      name,
      role:                 role || 'driver',
      active:               true,
      auth_provider:        'email_password',
      must_change_password: true,
      password_hash:        '$2a$10$oiOH/C5U8.kzGjIeK7U4I.AccsreHbuOn4mShqv42TQIt7AzlY9eu',
    })
    .select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const session = await checkAdmin()
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const {
    userId, email, role, active, can_verify,
    personal_email, auth_provider, modules,
    tgr_push_notify, odoo_partner_id,
  } = await req.json()

  if (!userId) return NextResponse.json({ error: 'userId requis' }, { status: 400 })

  const supabase = createAdminClient()

  // Récupérer l'état précédent pour détecter activation
  const { data: prevUser } = await supabase
    .from('users')
    .select('active, name, email, auth_provider')
    .eq('id', userId)
    .single()

  const updateData: any = {
    role,
    active,
    can_verify:         can_verify      ?? false,
    personal_email:     personal_email  || null,
    auth_provider:      auth_provider   || 'email_password',
    tgr_push_notify:    tgr_push_notify ?? false,
    odoo_partner_id:    odoo_partner_id ? parseInt(odoo_partner_id) : null,
    updated_at:         new Date().toISOString(),
  }
  if (email) updateData.email = email.toLowerCase()

  const { error: userError } = await supabase
    .from('users').update(updateData).eq('id', userId)
  if (userError) return NextResponse.json({ error: userError.message }, { status: 500 })

  // Email d'activation si compte vient d'être activé
  if (active && prevUser && !prevUser.active) {
    try {
      await sendAccountActivated({
        toEmail:      email || prevUser.email,
        name:         prevUser.name,
        authProvider: auth_provider || prevUser.auth_provider || 'email_password',
      })
    } catch (err: any) {
      console.error('[Admin] Activation email error:', err.message)
    }
  }

  // Modules
  if (modules !== undefined) {
    const { data: allModules } = await supabase.from('modules').select('id')
    if (allModules) {
      const upserts = allModules.map(mod => ({
        user_id:    userId,
        module_id:  mod.id,
        granted:    modules.includes(mod.id),
        granted_by: (session.user as any).id,
        granted_at: new Date().toISOString(),
      }))
      const { error: modError } = await supabase
        .from('user_modules')
        .upsert(upserts, { onConflict: 'user_id,module_id' })
      if (modError) return NextResponse.json({ error: modError.message }, { status: 500 })
    }
  }

  return NextResponse.json({ success: true })
}
