// src/app/api/admin/tarifs/extract/route.ts
//
// POST /api/admin/tarifs/extract
// FormData : file (PDF), hint_source (optional)
//
// 1. Verifie superadmin
// 2. Upload PDF dans Supabase Storage (bucket tariff-documents)
// 3. Lit le PDF en base64, appelle Claude API pour extraire les tarifs
// 4. Retourne { extracted, document_path } pour validation cote UI

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { extractTariffsFromPdf } from '@/lib/anthropic-pdf'

export const dynamic    = 'force-dynamic'
export const maxDuration = 60  // Claude PDF extraction peut prendre 10-30s

async function requireSuperadmin() {
  const session = await getServerSession(authOptions)
  if (!session) return null
  const role  = (session.user as any).role  || ''
  const roles = (session.user as any).roles || [role]
  const allRoles: string[] = Array.isArray(roles) ? roles : [roles]
  if (!allRoles.includes('superadmin')) return null
  return session
}

export async function POST(req: Request) {
  const session = await requireSuperadmin()
  if (!session) return NextResponse.json({ error: 'Acces superadmin requis' }, { status: 403 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const hintSource = formData.get('hint_source') as string | null

  if (!file) return NextResponse.json({ error: 'Fichier PDF requis' }, { status: 400 })
  if (file.type !== 'application/pdf') {
    return NextResponse.json({ error: 'Doit etre un PDF' }, { status: 400 })
  }
  if (file.size > 30 * 1024 * 1024) {
    return NextResponse.json({ error: 'PDF trop gros (max 30 MB)' }, { status: 400 })
  }

  const sb = createAdminClient()

  // 1. Upload dans Storage
  const fileBuffer = await file.arrayBuffer()
  const fileBytes  = new Uint8Array(fileBuffer)
  const timestamp  = Date.now()
  const cleanName  = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
  const storagePath = `${hintSource || 'autre'}/${timestamp}_${cleanName}`

  const { error: uploadErr } = await sb
    .storage
    .from('tariff-documents')
    .upload(storagePath, fileBytes, {
      contentType: 'application/pdf',
      upsert: false,
    })

  if (uploadErr) {
    console.error('[tarifs/extract] upload error:', uploadErr.message)
    return NextResponse.json({ error: `Upload Storage: ${uploadErr.message}` }, { status: 500 })
  }

  // 2. Encoder PDF en base64 pour Claude
  const base64 = Buffer.from(fileBytes).toString('base64')

  // 3. Appeler Claude API
  let extracted
  try {
    extracted = await extractTariffsFromPdf(base64, hintSource || undefined)
  } catch (e: any) {
    console.error('[tarifs/extract] Claude error:', e.message)
    return NextResponse.json({
      error: `Extraction Claude: ${e.message}`,
      document_path: storagePath,
    }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    extracted,
    document_path: storagePath,
    document_name: file.name,
    count: extracted.length,
  })
}
