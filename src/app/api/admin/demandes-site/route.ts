// src/app/api/admin/demandes-site/route.ts
//
// Écran « Demandes du site » (lot 1 du site public, Olivier 10/11/2026).
//   GET                 → demandes à traiter + 30 derniers jours traités.
//   GET ?cv=<id>        → lien signé (10 min) vers le CV d'une candidature.
//   PATCH { id, traite, note? } → cocher / décocher « Traité ».

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sessionAccess }     from '@/lib/access'

export const dynamic    = 'force-dynamic'
export const fetchCache = 'force-no-store'

const guard = (session: any) => sessionAccess(session, { roles: ['admin', 'superadmin'] })

export async function GET(req: Request) {
  const acc = guard(await getServerSession(authOptions))
  if (!acc.ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const sb = createAdminClient()

  const cv = new URL(req.url).searchParams.get('cv')
  if (cv) {
    const { data } = await sb.from('site_requests').select('file_path').eq('id', cv).maybeSingle()
    if (!data?.file_path) return NextResponse.json({ error: 'Pas de CV pour cette candidature.' }, { status: 404 })
    const s = await sb.storage.from('site-demandes').createSignedUrl(data.file_path, 600)
    if (s.error) return NextResponse.json({ error: s.error.message }, { status: 500 })
    return NextResponse.json({ url: s.data.signedUrl })
  }

  const depuis = new Date(Date.now() - 30 * 86400e3).toISOString()
  const [ouvertes, traitees] = await Promise.all([
    sb.from('site_requests').select('*').eq('status', 'nouveau').order('created_at', { ascending: true }).order('id'),
    sb.from('site_requests').select('*').eq('status', 'traite').gte('handled_at', depuis).order('handled_at', { ascending: false }).order('id').limit(100),
  ])
  if (ouvertes.error) return NextResponse.json({ error: ouvertes.error.message }, { status: 500 })
  if (traitees.error) return NextResponse.json({ error: traitees.error.message }, { status: 500 })

  const ids = Array.from(new Set((traitees.data || []).map(r => r.handled_by).filter(Boolean)))
  const noms: Record<string, string> = {}
  if (ids.length) {
    const { data } = await sb.from('users').select('id, name').in('id', ids)
    for (const u of data || []) noms[u.id] = u.name
  }
  return NextResponse.json({
    ouvertes: ouvertes.data || [],
    traitees: (traitees.data || []).map(r => ({ ...r, handled_by_name: r.handled_by ? noms[r.handled_by] || null : null })),
  })
}

export async function PATCH(req: Request) {
  const acc = guard(await getServerSession(authOptions))
  if (!acc.ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const id = String(b.id || '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Demande inconnue' }, { status: 400 })
  const traite = !!b.traite
  const sb = createAdminClient()
  const { error } = await sb.from('site_requests').update(traite
    ? { status: 'traite', handled_at: new Date().toISOString(), handled_by: acc.id, handled_note: String(b.note || '').trim().slice(0, 500) || null }
    : { status: 'nouveau', handled_at: null, handled_by: null, handled_note: null },
  ).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
