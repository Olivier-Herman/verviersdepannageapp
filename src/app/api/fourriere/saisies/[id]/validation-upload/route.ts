// src/app/api/fourriere/saisies/[id]/validation-upload/route.ts
//
// Dépôt DIRECT (interne) du retour signé d'un dossier saisie — pour les retours
// papier isolés (sans passer par le scan groupé). Stocke le doc signé, passe le
// dossier en 'accepte' (ou 'refuse'). Accès : admin/superadmin/module fourriere.
// Olivier 2026-08-10.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30
const MAX = 15 * 1024 * 1024

function canAccess(session: any): boolean {
  if (!session) return false
  const u = session.user as any
  return ['admin', 'superadmin'].includes(u.role || '') || (u.modules || []).includes('fourriere')
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const userId = (session!.user as any).id || null
  const sb = createAdminClient()

  const { data: d } = await sb.from('saisie_dossiers').select('id, mission_id, ef_number').eq('id', params.id).maybeSingle()
  if (!d) return NextResponse.json({ error: 'Dossier introuvable' }, { status: 404 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file') as File | null
  const refus = String(form?.get('refus') || '') === 'true'
  if (!file || file.size === 0) return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 })
  if (file.size > MAX) return NextResponse.json({ error: 'Fichier trop volumineux (max 15 MB)' }, { status: 400 })

  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'signe.pdf'
  const path = `saisie-validation/${d.id}/${Date.now()}_${safe}`
  const buf = new Uint8Array(await file.arrayBuffer())
  const { error: upErr } = await sb.storage.from('mission-remarks').upload(path, buf, { contentType: file.type || 'application/pdf', upsert: false })
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  await sb.from('saisie_dossiers').update({
    validation_doc_path: path,
    validation_at: new Date().toISOString(),
    state: refus ? 'refuse' : 'accepte',
    notes: refus ? 'Refusé par le Parquet (dépôt manuel).' : 'Accepté par le Parquet (dépôt manuel).',
    updated_at: new Date().toISOString(),
  }).eq('id', d.id)

  if (d.mission_id) {
    await sb.from('mission_remarks')
      .insert({ mission_id: d.mission_id, text: `${refus ? '❌ Refus' : '✅ Accord'} Parquet — état de frais ${d.ef_number || ''} (dépôt manuel)`, created_by: userId })
      .then(() => {}, () => {})
  }

  return NextResponse.json({ ok: true })
}
