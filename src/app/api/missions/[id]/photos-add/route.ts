// src/app/api/missions/[id]/photos-add/route.ts
//
// POST multipart { files[] } — ajoute des photos à une fiche depuis l'écran
// d'étiquette QR (Olivier 07/09/2026 : « on scanne, on rajoute un bouton
// ajouter photo et on fait les photos. Elles vont se placer avec celles des
// chauffeurs »). Même bucket et même colonne (driver_photos) que l'app
// chauffeur, donc elles apparaissent partout où les photos chauffeur sont
// lues (fiche dispatch, PDF, Odoo FSM). Ouvert à tout utilisateur connecté :
// c'est le scan de l'étiquette qui donne l'accès, comme pour le reste du hub.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const user = session.user as any

  const sb = createAdminClient()
  const { data: mission } = await sb.from('incoming_missions')
    .select('id, mission_number, driver_photos, odoo_task_id')
    .eq('id', params.id).maybeSingle()
  if (!mission) return NextResponse.json({ error: 'Fiche introuvable' }, { status: 404 })

  const formData = await req.formData()
  const files = formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0)
  if (!files.length) return NextResponse.json({ error: 'Aucune photo' }, { status: 400 })

  const urls: string[] = []
  for (const file of files) {
    const ext  = (file.name.split('.').pop() || 'jpg').toLowerCase()
    const path = `${params.id}/qr-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const { error } = await sb.storage.from('mission-photos')
      .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || 'image/jpeg', upsert: true })
    if (error) return NextResponse.json({ error: `Envoi impossible : ${error.message}` }, { status: 500 })
    urls.push(sb.storage.from('mission-photos').getPublicUrl(path).data.publicUrl)
  }

  // Ajout en fin de liste, sans écraser ce que le chauffeur a déjà envoyé
  // (relecture juste avant l'écriture pour limiter la fenêtre de conflit).
  const { data: fresh } = await sb.from('incoming_missions').select('driver_photos').eq('id', params.id).maybeSingle()
  const existing: string[] = Array.isArray((fresh as any)?.driver_photos) ? (fresh as any).driver_photos : []
  const all = [...existing, ...urls.filter(u => !existing.includes(u))]
  const now = new Date().toISOString()
  const { error: upErr } = await sb.from('incoming_missions').update({ driver_photos: all, updated_at: now }).eq('id', params.id)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  const who = user.name || user.email || 'utilisateur'
  await sb.from('mission_logs').insert({
    mission_id: params.id, actor_id: user.id || null, action: 'photos_added',
    notes: `${urls.length} photo${urls.length > 1 ? 's' : ''} ajoutée${urls.length > 1 ? 's' : ''} depuis l'étiquette QR par ${who}`,
    metadata: { urls, via: 'qr' },
  }).then(() => {}, () => {})

  // Comme pour les photos chauffeur : pièces jointes sur la tâche FSM (best effort).
  if ((mission as any).odoo_task_id) {
    import('@/lib/odoo-fsm').then(({ attachPhotosToFsmTask }) => attachPhotosToFsmTask((mission as any).odoo_task_id, urls))
      .catch(e => console.error('[photos-add] FSM attach KO (non bloquant):', e?.message))
  }

  return NextResponse.json({ ok: true, urls, total: all.length })
}
