// src/app/api/missions/remarks/[remarkId]/attachments/route.ts
//
// POST /api/missions/remarks/[remarkId]/attachments
//   FormData : files (1+ fichiers, max 10 MB chacun)
//   Ajoute des fichiers a une remarque existante.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const MAX_FILE_SIZE = 10 * 1024 * 1024

async function getActor() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  const sb = createAdminClient()
  const { data } = await sb.from('users').select('id, name, email').eq('email', session.user.email).maybeSingle()
  return data ?? null
}

export async function POST(req: Request, { params }: { params: { remarkId: string } }) {
  const actor = await getActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const { data: remark } = await sb
    .from('mission_remarks')
    .select('id, mission_id')
    .eq('id', params.remarkId)
    .maybeSingle()
  if (!remark) return NextResponse.json({ error: 'Remarque introuvable' }, { status: 404 })

  const formData = await req.formData()
  const files = formData.getAll('files') as File[]
  if (files.length === 0) return NextResponse.json({ error: 'Aucun fichier' }, { status: 400 })

  const added: any[] = []
  for (const file of files) {
    if (!file || file.size === 0) continue
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `Fichier "${file.name}" trop gros (max 10 MB)` }, { status: 400 })
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
    const path = `${remark.mission_id}/${remark.id}/${Date.now()}_${safeName}`
    const buf = new Uint8Array(await file.arrayBuffer())
    const { error: upErr } = await sb.storage
      .from('mission-remarks')
      .upload(path, buf, { contentType: file.type || 'application/octet-stream', upsert: false })
    if (upErr) {
      console.error('[remarks/attachments] upload error:', upErr.message)
      continue
    }
    const { data: att, error: insErr } = await sb
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
    if (!insErr) added.push(att)
  }

  return NextResponse.json({ ok: true, attachments: added })
}
