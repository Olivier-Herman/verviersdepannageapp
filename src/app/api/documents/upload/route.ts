// src/app/api/documents/upload/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'
import sharp                         from 'sharp'

const SIGNED_URL_EXPIRES = 60 * 60 * 24 * 365 * 5 // 5 ans

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const supabase = createAdminClient()

  const { data: me } = await supabase
    .from('users').select('id').eq('email', session.user.email!).single()
  if (!me) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

  const contentType = req.headers.get('content-type') ?? ''
  let buffer: Buffer

  if (contentType.includes('application/json')) {
    const body = await req.json()
    buffer     = Buffer.from(body.base64, 'base64')
  } else {
    const formData = await req.formData()
    const file     = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 })
    buffer = Buffer.from(await file.arrayBuffer())
  }

  // Convertir en JPEG via sharp — gère HEIF, HEIC, grand angle iOS, tout format
  let jpegBuffer: Buffer
  try {
    jpegBuffer = await sharp(buffer).rotate().jpeg({ quality: 88 }).toBuffer()
  } catch (e) {
    console.error('[Documents upload] sharp conversion:', e)
    return NextResponse.json({ error: 'Conversion image échouée' }, { status: 400 })
  }

  const docType = req.nextUrl.searchParams.get('docType') ?? 'misc'
  const path    = `${me.id}/${docType}-${Date.now()}.jpg`

  const { error: uploadError } = await supabase
    .storage.from('documents')
    .upload(path, jpegBuffer, { contentType: 'image/jpeg', upsert: true })

  if (uploadError) {
    console.error('[Documents upload]', uploadError)
    return NextResponse.json({ error: 'Upload échoué' }, { status: 500 })
  }

  const { data: signed, error: signedError } = await supabase
    .storage.from('documents')
    .createSignedUrl(path, SIGNED_URL_EXPIRES)

  if (signedError || !signed) {
    return NextResponse.json({ error: "Impossible de générer l'URL" }, { status: 500 })
  }

  return NextResponse.json({ url: signed.signedUrl })
}
