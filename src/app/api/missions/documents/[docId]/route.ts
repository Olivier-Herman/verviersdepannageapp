// src/app/api/missions/documents/[docId]/route.ts
//
// GET → redirige vers une signed URL (60 s) de la pièce capturée
//       (photo d'identité, CMR, bon Informex, signature). Session requise.
// Olivier 2026-09-05.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: { docId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const { data: doc } = await sb.from('mission_documents')
    .select('file_path, file_name, mime_type').eq('id', params.docId).maybeSingle()
  if (!doc) return NextResponse.json({ error: 'Pièce introuvable' }, { status: 404 })
  const inline = new URL(req.url).searchParams.get('inline') === '1'
  const { data: signed, error } = await sb.storage
    .from('mission-documents')
    .createSignedUrl(doc.file_path, 60, inline ? undefined : { download: doc.file_name || undefined })
  if (error || !signed) return NextResponse.json({ error: 'Signed URL échec' }, { status: 500 })
  return NextResponse.redirect(signed.signedUrl)
}
