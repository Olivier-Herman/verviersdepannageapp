// POST /api/truck-checks/upload (multipart « file ») → { path, url }. Photo déjà
// compressée par le téléphone ; rangée dans le bucket check-photos.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { PHOTO_BUCKET, photoUrl } from '@/lib/truck-checks/server'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const fd = await req.formData()
  const file = fd.get('file') as File | null
  if (!file || !file.size) return NextResponse.json({ error: 'Photo manquante' }, { status: 400 })
  if (file.size > 15_000_000) return NextResponse.json({ error: 'Photo trop lourde' }, { status: 413 })
  const sb = createAdminClient()
  const path = `truck/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.jpg`
  const { error } = await sb.storage.from(PHOTO_BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: 'image/jpeg', upsert: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ path, url: photoUrl(sb, path) })
}
