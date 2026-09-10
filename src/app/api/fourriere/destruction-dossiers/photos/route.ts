// POST multipart { files[], key? } → URLs publiques (bucket mission-photos, dossier destruction/<clé>)
import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { fourriereUser }     from '@/lib/fourriere/destruction-access'

export async function POST(req: Request) {
  const u = await fourriereUser(); if (!u) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const fd = await req.formData()
  const files = fd.getAll('files') as File[]
  if (!files.length) return NextResponse.json({ error: 'Aucun fichier' }, { status: 400 })
  const key = String(fd.get('key') || '').replace(/[^a-zA-Z0-9_-]/g, '') || `d${Date.now()}`
  const sb = createAdminClient()
  const urls: string[] = []
  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer())
    const path = `destruction/${key}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
    const { error } = await sb.storage.from('mission-photos').upload(path, buffer, { contentType: file.type || 'image/jpeg', upsert: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    urls.push(sb.storage.from('mission-photos').getPublicUrl(path).data.publicUrl)
  }
  return NextResponse.json({ urls })
}
