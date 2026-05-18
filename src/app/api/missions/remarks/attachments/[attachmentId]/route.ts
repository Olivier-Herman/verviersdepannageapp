// src/app/api/missions/remarks/attachments/[attachmentId]/route.ts
//
// GET    /api/missions/remarks/attachments/[attachmentId]
//   → redirige vers signed URL (download du fichier)
// DELETE /api/missions/remarks/attachments/[attachmentId]
//   → supprime de Storage + DB

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { attachmentId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const { data: att } = await sb
    .from('mission_remark_attachments')
    .select('file_path, file_name, mime_type')
    .eq('id', params.attachmentId)
    .maybeSingle()
  if (!att) return NextResponse.json({ error: 'Pièce jointe introuvable' }, { status: 404 })

  const { data: signed, error } = await sb.storage
    .from('mission-remarks')
    .createSignedUrl(att.file_path, 60, { download: att.file_name })

  if (error || !signed) return NextResponse.json({ error: 'Signed URL échec' }, { status: 500 })

  return NextResponse.redirect(signed.signedUrl)
}

export async function DELETE(_req: Request, { params }: { params: { attachmentId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const { data: att } = await sb
    .from('mission_remark_attachments')
    .select('file_path')
    .eq('id', params.attachmentId)
    .maybeSingle()
  if (!att) return NextResponse.json({ error: 'Pièce jointe introuvable' }, { status: 404 })

  await sb.storage.from('mission-remarks').remove([att.file_path])

  const { error } = await sb.from('mission_remark_attachments').delete().eq('id', params.attachmentId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
