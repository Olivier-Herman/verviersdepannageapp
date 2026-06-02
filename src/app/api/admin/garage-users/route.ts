// CRUD admin pour les users garage (role='garage') + leur liaison many-to-many
// avec les garage_partners. Olivier 2026-06-02.
//
// Un user garage peut etre lie a N partners (multi-entites). A la connexion,
// si N > 1 → selecteur d entite. Le last_selected_at memorise la derniere.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function requireAdmin(session: any): boolean {
  const role: string = session?.user?.role || ''
  return ['admin', 'superadmin'].includes(role)
}

/**
 * GET : liste des users garage avec leurs partners lies.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireAdmin(session)) return NextResponse.json({ error: 'Acces refuse' }, { status: 403 })

  const sb = createAdminClient()
  const { data: users, error } = await sb
    .from('users')
    .select(`
      id, email, name, role, active, created_at, last_login,
      garage_user_partners (
        garage_partner_id,
        is_default,
        last_selected_at,
        garage_partners ( id, name, active )
      )
    `)
    .eq('role', 'garage')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Flatten les partners
  const cleaned = (users || []).map(u => ({
    id:          u.id,
    email:       u.email,
    name:        u.name,
    active:      u.active,
    created_at:  u.created_at,
    last_login:  u.last_login,
    partners: (Array.isArray((u as any).garage_user_partners) ? (u as any).garage_user_partners : [])
      .filter((gup: any) => gup.garage_partners && gup.garage_partners.active)
      .map((gup: any) => ({
        id:               gup.garage_partners.id,
        name:             gup.garage_partners.name,
        is_default:       gup.is_default,
        last_selected_at: gup.last_selected_at,
      })),
  }))

  return NextResponse.json({ users: cleaned })
}

/**
 * POST : cree un user garage + ses liens partners.
 * Body : { email, name, partner_ids: string[] }
 * NB : le mot de passe est defini par le user lui meme via magic link
 * envoye par l email de bienvenue (cf API send-welcome a venir).
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireAdmin(session)) return NextResponse.json({ error: 'Acces refuse' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const email      = String(body.email || '').trim().toLowerCase()
  const name       = String(body.name  || '').trim()
  const partnerIds: string[] = Array.isArray(body.partner_ids) ? body.partner_ids : []

  if (!email)             return NextResponse.json({ error: 'email requis' }, { status: 400 })
  if (!name)              return NextResponse.json({ error: 'name requis'  }, { status: 400 })
  if (partnerIds.length === 0) {
    return NextResponse.json({ error: 'au moins 1 garage doit etre lie' }, { status: 400 })
  }

  const sb = createAdminClient()

  // Verifier que l email n existe pas deja
  const { data: existing } = await sb.from('users').select('id, role').ilike('email', email).maybeSingle()
  if (existing) {
    return NextResponse.json({
      error: existing.role === 'garage'
        ? 'Un user garage existe deja avec cet email — utilise l action "Modifier" pour ajuster ses entites'
        : `Email deja utilise par un user ${existing.role}. Choisis une autre adresse.`,
    }, { status: 400 })
  }

  // Crée le user
  const { data: u, error: uErr } = await sb.from('users').insert({
    email,
    name,
    role:                 'garage',
    roles:                ['garage'],
    active:               true,
    auth_provider:        'email_password',
    must_change_password: true,  // forcera passage par /change-password ou magic link au premier login
  }).select('id, email, name').single()
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })

  // Crée les liens many-to-many
  const links = partnerIds.map((pid, i) => ({
    user_id:           u.id,
    garage_partner_id: pid,
    is_default:        i === 0,
  }))
  const { error: lErr } = await sb.from('garage_user_partners').insert(links)
  if (lErr) {
    // Rollback : delete le user créé
    await sb.from('users').delete().eq('id', u.id)
    return NextResponse.json({ error: lErr.message }, { status: 500 })
  }

  return NextResponse.json({ user: { ...u, partner_ids: partnerIds } })
}

/**
 * PATCH ?id=xxx : update nom + partners lies du user garage.
 * Body : { name?, active?, partner_ids?: string[] }
 */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireAdmin(session)) return NextResponse.json({ error: 'Acces refuse' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const sb   = createAdminClient()

  // Patch users
  const userPatch: Record<string, any> = {}
  if (body.name   !== undefined) userPatch.name   = String(body.name).trim()
  if (body.active !== undefined) userPatch.active = !!body.active
  if (Object.keys(userPatch).length > 0) {
    const { error } = await sb.from('users').update(userPatch).eq('id', id).eq('role', 'garage')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Si partner_ids fourni, synchronise les liens (delete existants + insert nouveaux)
  if (Array.isArray(body.partner_ids)) {
    const newIds: string[] = body.partner_ids
    if (newIds.length === 0) {
      return NextResponse.json({ error: 'au moins 1 garage doit etre lie' }, { status: 400 })
    }
    await sb.from('garage_user_partners').delete().eq('user_id', id)
    const links = newIds.map((pid, i) => ({
      user_id:           id,
      garage_partner_id: pid,
      is_default:        i === 0,
    }))
    const { error } = await sb.from('garage_user_partners').insert(links)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

/**
 * DELETE ?id=xxx : soft delete (active=false) + supprime ses liens partners
 * (pour qu il ne puisse plus se connecter et que les RLS-like filtres ne
 * matchent plus).
 */
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireAdmin(session)) return NextResponse.json({ error: 'Acces refuse' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

  const sb = createAdminClient()
  await sb.from('users').update({ active: false }).eq('id', id).eq('role', 'garage')
  return NextResponse.json({ ok: true })
}
