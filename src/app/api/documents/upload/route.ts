// src/app/api/documents/upload/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'

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
  let mimeType: string
  let ext: string

  if (contentType.includes('application/json')) {
    // Base64 JSON (iOS)
    const body  = await req.json()
    buffer      = Buffer.from(body.base64, 'base64')
    mimeType    = body.mimeType ?? 'image/jpeg'
    ext         = 'jpg'
  } else {
    // FormData
    const formData = await req.formData()
    const file     = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 })
    buffer   = Buffer.from(await file.arrayBuffer())
    mimeType = file.type ?? 'image/jpeg'
    ext      = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  }

  const docType = req.nextUrl.searchParams.get('docType') ?? 'misc'
  const path    = `${me.id}/${docType}-${Date.now()}.${ext}`

  const { error: uploadError } = await supabase
    .storage.from('documents')
    .upload(path, buffer, { contentType: mimeType, upsert: true })

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
