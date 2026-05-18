// src/app/api/missions/[id]/remarks/route.ts
//
// GET  /api/missions/[id]/remarks → liste remarques + attachments
// POST /api/missions/[id]/remarks → cree une remarque (multipart : text + fichiers)

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

async function getActor() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  const sb = createAdminClient()
  const { data } = await sb.from('users').select('id, name, email').eq('email', session.user.email).maybeSingle()
  return data ?? null
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()

  const { data: remarks, error } = await sb
    .from('mission_remarks')
    .select(`
      id, text, created_at, updated_at, edit_history,
      author:users!created_by(id, name, email),
      editor:users!updated_by(id, name, email)
    `)
    .eq('mission_id', params.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const remarkIds = (remarks || []).map(r => r.id)
  let attachmentsByRemark: Record<string, any[]> = {}
  if (remarkIds.length > 0) {
    const { data: atts } = await sb
      .from('mission_remark_attachments')
      .select('id, remark_id, file_name, file_size, mime_type, uploaded_at')
      .in('remark_id', remarkIds)
    for (const a of atts || []) {
      ;(attachmentsByRemark[a.remark_id] ??= []).push(a)
    }
  }

  return NextResponse.json({
    ok: true,
    remarks: (remarks || []).map(r => ({
      ...r,
      attachments: attachmentsByRemark[r.id] || [],
    })),
  })
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const actor = await getActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await req.formData()
  const text = String(formData.get('text') || '').trim()
  if (!text) return NextResponse.json({ error: 'Texte requis' }, { status: 400 })

  const files = formData.getAll('files') as File[]
  for (const f of files) {
    if (f.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `Fichier "${f.name}" trop gros (max 10 MB)` }, { status: 400 })
    }
  }

  const sb = createAdminClient()

  const { data: remark, error: insErr } = await sb
    .from('mission_remarks')
    .insert({ mission_id: params.id, text, created_by: actor.id })
    .select()
    .single()
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  const attachments: any[] = []
  for (const file of files) {
    if (!file || file.size === 0) continue
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
    const path = `${params.id}/${remark.id}/${Date.now()}_${safeName}`
    const buf = new Uint8Array(await file.arrayBuffer())
    const { error: upErr } = await sb.storage
      .from('mission-remarks')
      .upload(path, buf, { contentType: file.type || 'application/octet-stream', upsert: false })
    if (upErr) {
      console.error('[remarks] upload error:', upErr.message)
      continue
    }
    const { data: att, error: attErr } = await sb
      .from('mission_remark_attachments')
      .insert({
        remark_id:   remark.id,
        file_path:   path,
        file_name:   file.name,
        file_size:   file.size,
        mime_type:   file.type || null,
        uploaded_by: actor.id,
      })
      .select()
      .single()
    if (!attErr) attachments.push(att)
  }

  return NextResponse.json({ ok: true, remark: { ...remark, attachments } })
}
