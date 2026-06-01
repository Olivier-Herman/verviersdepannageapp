// POST /api/fines/upload
// Body : { base64, mimeType, filename }
// Upload une photo de PV dans Supabase Storage (bucket 'fines')
// et retourne une signed URL d 1 an.
//
// Olivier 2026-06-01. Reserve facturation / admin / superadmin.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const role: string = user.role || ''
  const modules: string[] = Array.isArray(user.modules) ? user.modules : []
  const hasAccess = ['admin', 'superadmin'].includes(role) || modules.includes('facturation')
  if (!hasAccess) return NextResponse.json({ error: 'Acces refuse' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { base64, mimeType, filename } = body
  if (!base64 || !mimeType) {
    return NextResponse.json({ error: 'base64 + mimeType requis' }, { status: 400 })
  }

  const sb = createAdminClient()
  const ext = filename ? filename.split('.').pop() : (mimeType.includes('pdf') ? 'pdf' : 'jpg')
  const path = `${user.id || 'anon'}/${Date.now()}.${ext}`

  // Decode base64
  const buffer = Buffer.from(base64.replace(/^data:.*;base64,/, ''), 'base64')

  const { error: upErr } = await sb.storage
    .from('fines')
    .upload(path, buffer, { contentType: mimeType, upsert: false })

  if (upErr) {
    console.error('[fines/upload]', upErr.message)
    return NextResponse.json({ error: upErr.message }, { status: 500 })
  }

  const { data: signed, error: sErr } = await sb.storage
    .from('fines')
    .createSignedUrl(path, ONE_YEAR_SECONDS)

  if (sErr || !signed) {
    return NextResponse.json({ error: sErr?.message || 'createSignedUrl echec' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, url: signed.signedUrl, path })
}
