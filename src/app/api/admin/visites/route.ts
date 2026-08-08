// CRUD admin des catalogues du module Visiteur — paramétrable par le superadmin
// (zéro hardcode) : motifs de visite (visitor_motifs) + bureaux d'expertise
// (expertise_bureaus). Un seul endpoint, discriminé par ?cat=motifs|bureaux.
// Réservé admin/superadmin. Olivier 2026-08-08.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'

export const dynamic    = 'force-dynamic'
export const fetchCache = 'force-no-store'

function requireAdmin(session: any): boolean {
  return ['admin', 'superadmin'].includes(session?.user?.role || '')
    || (Array.isArray(session?.user?.roles) && session.user.roles.some((r: string) => ['admin', 'superadmin'].includes(r)))
}

// Table + champ « libellé » selon le catalogue.
function resolve(cat: string | null): { table: string; labelCol: 'label' | 'name' } | null {
  if (cat === 'motifs')  return { table: 'visitor_motifs',    labelCol: 'label' }
  if (cat === 'bureaux') return { table: 'expertise_bureaus', labelCol: 'name'  }
  return null
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireAdmin(session)) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const sb = createAdminClient()
  const [motifs, bureaux] = await Promise.all([
    sb.from('visitor_motifs').select('*').order('sort_order', { ascending: true }).order('label', { ascending: true }),
    sb.from('expertise_bureaus').select('*').order('sort_order', { ascending: true }).order('name', { ascending: true }),
  ])
  if (motifs.error)  return NextResponse.json({ error: motifs.error.message },  { status: 500 })
  if (bureaux.error) return NextResponse.json({ error: bureaux.error.message }, { status: 500 })
  return NextResponse.json({ motifs: motifs.data, bureaux: bureaux.data })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireAdmin(session)) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const cat = resolve(new URL(req.url).searchParams.get('cat'))
  if (!cat) return NextResponse.json({ error: 'Catalogue inconnu' }, { status: 400 })

  const body  = await req.json().catch(() => ({}))
  const label = String(body.label ?? body.name ?? '').trim()
  if (!label) return NextResponse.json({ error: 'Libellé requis' }, { status: 400 })

  const row: Record<string, any> = {
    [cat.labelCol]: label,
    sort_order: body.sort_order != null ? Number(body.sort_order) : 100,
    active:     body.active !== false,
  }
  if (cat.table === 'visitor_motifs') row.is_expert = !!body.is_expert

  const sb = createAdminClient()
  const { data, error } = await sb.from(cat.table).insert(row).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireAdmin(session)) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const url = new URL(req.url)
  const cat = resolve(url.searchParams.get('cat'))
  const id  = url.searchParams.get('id')
  if (!cat) return NextResponse.json({ error: 'Catalogue inconnu' }, { status: 400 })
  if (!id)  return NextResponse.json({ error: 'id requis' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const patch: Record<string, any> = {}
  const label = body.label ?? body.name
  if (label       !== undefined) patch[cat.labelCol] = String(label).trim()
  if (body.sort_order !== undefined) patch.sort_order = Number(body.sort_order) || 100
  if (body.active     !== undefined) patch.active     = !!body.active
  if (cat.table === 'visitor_motifs' && body.is_expert !== undefined) patch.is_expert = !!body.is_expert
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'Aucun champ' }, { status: 400 })

  const sb = createAdminClient()
  const { data, error } = await sb.from(cat.table).update(patch).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireAdmin(session)) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const url = new URL(req.url)
  const cat = resolve(url.searchParams.get('cat'))
  const id  = url.searchParams.get('id')
  if (!cat) return NextResponse.json({ error: 'Catalogue inconnu' }, { status: 400 })
  if (!id)  return NextResponse.json({ error: 'id requis' }, { status: 400 })

  // Soft delete (active=false) : préserve les libellés déjà stockés sur les visites.
  const sb = createAdminClient()
  const { data, error } = await sb.from(cat.table).update({ active: false }).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}
