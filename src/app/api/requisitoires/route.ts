// src/app/api/requisitoires/route.ts
//
// GET /api/requisitoires?status=pending
//   Liste la file d'attente des réquisitoires capturés dans fourriere@.
//   Accès : admin / superadmin / module fourriere.
//
// Olivier 2026-07-01. Cf [[project_assistant_mail_module]].

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function guard(session: any): boolean {
  const user = session?.user as any
  if (!user) return false
  const role = user.role || ''
  const modules: string[] = user.modules || []
  return ['admin', 'superadmin'].includes(role) || modules.includes('fourriere')
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!guard(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const status = new URL(req.url).searchParams.get('status') || 'pending'
  const sb = createAdminClient()

  let q = sb.from('requisitoire_intake').select('*').order('created_at', { ascending: false }).limit(100)
  // 'deleted' = supprimé (masqué) : jamais listé, même dans « Tous ».
  if (status === 'all') q = q.neq('status', 'deleted')
  else                  q = q.eq('status', status)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // URL signée pour le PDF (bucket privé).
  const items = await Promise.all((data || []).map(async (row: any) => {
    let doc_url: string | null = null
    if (row.doc_path) {
      const { data: signed } = await sb.storage.from('mission-remarks').createSignedUrl(row.doc_path, 3600)
      doc_url = signed?.signedUrl || null
    }
    return { ...row, doc_url }
  }))

  // Compteurs par statut (pour les onglets).
  const { data: allRows } = await sb.from('requisitoire_intake').select('status')
  const counts: Record<string, number> = {}
  for (const r of allRows || []) counts[r.status] = (counts[r.status] || 0) + 1

  return NextResponse.json({ ok: true, items, counts })
}
