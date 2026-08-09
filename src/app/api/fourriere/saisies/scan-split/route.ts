// src/app/api/fourriere/saisies/scan-split/route.ts
//
// SCAN GROUPÉ : upload du PDF complet des états de frais renvoyés signés → découpe
// + lecture du n° EDF (Claude) + rattachement/validation par dossier.
//   POST multipart { file } → résumé.
// Accès : admin / superadmin / module fourriere. Olivier 2026-08-10.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { splitAndDispatch }  from '@/lib/missions/saisie-scan-split'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

function canAccess(session: any): boolean {
  if (!session) return false
  const u = session.user as any
  return ['admin', 'superadmin'].includes(u.role || '') || (u.modules || []).includes('fourriere')
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const userId = (session!.user as any).id || null

  const form = await req.formData().catch(() => null)
  const file = form?.get('file') as File | null
  if (!file || file.size === 0) return NextResponse.json({ error: 'PDF manquant' }, { status: 400 })
  if (file.size > 40 * 1024 * 1024) return NextResponse.json({ error: 'PDF trop volumineux (max 40 MB)' }, { status: 400 })

  try {
    const buf = Buffer.from(await file.arrayBuffer())
    const sb = createAdminClient()
    const summary = await splitAndDispatch(sb, buf, userId)
    return NextResponse.json({ ok: true, ...summary })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Découpe échouée' }, { status: 500 })
  }
}
