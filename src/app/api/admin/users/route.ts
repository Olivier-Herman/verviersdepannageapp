import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }         from 'next-auth'
import { authOptions }              from '@/lib/auth'
import { createAdminClient }        from '@/lib/supabase'
import { sendAccountActivated }     from '@/lib/emails'

async function checkAdmin() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return null
    const userRole  = (session.user as any).role  || ''
    const userRoles = (session.user as any).roles || [userRole]
    const roles: string[] = Array.isArray(userRoles) ? userRoles : [userRole]
    if (!roles.some((r: string) => ['admin', 'superadmin'].includes(r))) return null
    return session
  } catch (err: any) {
    console.error('[checkAdmin] Error:', err.message)
    return null
  }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const userRole2  = (session.user as any).role  || ''
  const userRoles2 = (session.user as any).roles || [userRole2]
  const roles: string[] = Array.isArray(userRoles2) ? userRoles2 : [userRole2]
  if (!roles.some((r: string) => ['admin', 'superadmin', 'dispatcher'].includes(r))) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('users')
    .select(`
      id, email, name, role, roles, active, can_verify, personal_email, auth_provider,
      last_login, created_at, tgr_push_notify, odoo_partner_id,
      user_modules!user_modules_user_id_fkey (module_id, granted)
    `)
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
      roles:                [role || 'driver'],
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
    userId, email, role, roles, active, can_verify,
    personal_email, auth_provider, modules,
    tgr_push_notify, odoo_partner_id,
  } = await req.json()

  if (!userId) return NextResponse.json({ error: 'userId requis' }, { status: 400 })

  const supabase = createAdminClient()
  
  try {
  const { data: prevUser } = await supabase
    .from('users')
    .select('active, name, email, auth_provider')
    .eq('id', userId)
    .single()

  // Rôle primaire = premier rôle du tableau, ou rôle envoyé seul
  const primaryRole  = role || (roles?.[0]) || 'driver'
  const rolesArray   = roles?.length ? roles : [primaryRole]

  const updateData: any = {
    role:            primaryRole,
    roles:           rolesArray,
    active:          active,
    can_verify:      can_verify      ?? false,
    personal_email:  personal_email  || null,
    auth_provider:   auth_provider   || 'email_password',
    tgr_push_notify: tgr_push_notify ?? false,
    odoo_partner_id: odoo_partner_id ? parseInt(String(odoo_partner_id)) : null,
    updated_at:      new Date().toISOString(),
  }
  if (email) updateData.email = email.toLowerCase()

  const { error: userError } = await supabase
    .from('users').update(updateData).eq('id', userId)
  if (userError) {
    console.error('[PATCH users] Supabase error:', JSON.stringify(userError))
    console.error('[PATCH users] updateData:', JSON.stringify(updateData))
    return NextResponse.json({ error: userError.message, details: userError }, { status: 500 })
  }

  // Email d'activation
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
  } catch (err: any) {
    console.error('[PATCH users] Unexpected error:', err.message, err.stack)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
