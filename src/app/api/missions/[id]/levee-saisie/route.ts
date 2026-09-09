// src/app/api/missions/[id]/levee-saisie/route.ts
//
// POST /api/missions/[id]/levee-saisie
//   multipart : type (definitive|temporaire) + date (YYYY-MM-DD) + note? + file?
//   Enregistre une levée de saisie sur une mission police_saisie.
//
// Règle métier (Olivier 2026-06-13) :
//   (document OU commentaire) ET date de levée  ->  police_levee_saisie_ok = true
//   (enlève le blocage police de la fiche).
//   La date de levée pilote le calcul du gardiennage à 2 tarifs.
//
// Le document est stocké comme pièce jointe d'une mission_remark (réutilise le
// bucket 'mission-remarks' + l'UI Remarques pour le download).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

// Frais de Justice Verviers — le partenaire Odoo qui paie quand la levée
// répond « frais de justice » (Olivier 09/09/2026 : « l'id 67 »).
const FRAIS_JUSTICE_ODOO_ID = 67
const FRAIS_JUSTICE_NAME    = 'Frais de Justice Verviers'

async function getActor() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  const sb = createAdminClient()
  const { data } = await sb.from('users').select('id, name, email').eq('email', session.user.email).maybeSingle()
  return data ?? null
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const actor = await getActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await req.formData()
  const type = String(formData.get('type') || '').trim()
  const date = String(formData.get('date') || '').trim()           // YYYY-MM-DD
  const note = String(formData.get('note') || '').trim()
  // Qui paie après la levée ? Posé à la levée plutôt que déduit après coup
  // (Olivier 09/09/2026) : « frais de justice » garde le dossier en état de
  // frais, « client » l'envoie vers une facture Odoo.
  const payer = String(formData.get('payer') || '').trim()
  const files = (formData.getAll('files') as File[]).filter(f => f && f.size > 0)

  if (type !== 'definitive' && type !== 'temporaire') {
    return NextResponse.json({ error: 'Type de levée invalide (définitive ou temporaire).' }, { status: 400 })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Date de levée requise (format AAAA-MM-JJ).' }, { status: 400 })
  }
  if (payer && payer !== 'frais_justice' && payer !== 'client') {
    return NextResponse.json({ error: 'Réponse invalide : frais de justice ou client.' }, { status: 400 })
  }
  // Déblocage : document OU commentaire obligatoire
  if (files.length === 0 && !note) {
    return NextResponse.json({ error: 'Annexe un document de levée OU saisis un commentaire (ex : « Levée par téléphone »).' }, { status: 400 })
  }
  for (const f of files) {
    if (f.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `Fichier "${f.name}" trop gros (max 10 MB)` }, { status: 400 })
    }
  }

  const sb = createAdminClient()

  const { data: mission, error: mErr } = await sb
    .from('incoming_missions')
    .select('id, source')
    .eq('id', params.id)
    .maybeSingle()
  if (mErr)     return NextResponse.json({ error: mErr.message }, { status: 500 })
  if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  // Sur une saisie, une levée DÉFINITIVE doit dire où va la suite : c'est elle
  // qui décide entre l'état de frais et la facture au client.
  if (mission.source === 'police_saisie' && type === 'definitive' && !payer) {
    return NextResponse.json({ error: 'Indique qui paie les frais : frais de justice, ou le client.' }, { status: 400 })
  }

  const payerLabel = payer === 'frais_justice' ? 'frais de justice' : payer === 'client' ? 'à charge du client' : null
  const typeLabel = type === 'definitive' ? 'définitive' : 'temporaire'
  const dateFr = date.split('-').reverse().join('/')
  const remarkText = `🔓 Levée de saisie ${typeLabel} (date : ${dateFr})${payerLabel ? ` — ${payerLabel}` : ''}${note ? ` — ${note}` : ''}`
  const { data: remark, error: insErr } = await sb
    .from('mission_remarks')
    .insert({ mission_id: params.id, text: remarkText, created_by: actor.id })
    .select()
    .single()
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  let firstPath: string | null = null
  for (const file of files) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
    const path = `${params.id}/${remark.id}/${Date.now()}_${safeName}`
    const buf = new Uint8Array(await file.arrayBuffer())
    const { error: upErr } = await sb.storage
      .from('mission-remarks')
      .upload(path, buf, { contentType: file.type || 'application/octet-stream', upsert: false })
    if (upErr) { console.error('[levee-saisie] upload error:', upErr.message); continue }
    await sb.from('mission_remark_attachments').insert({
      remark_id:   remark.id,
      file_path:   path,
      file_name:   file.name,
      file_size:   file.size,
      mime_type:   file.type || null,
      uploaded_by: actor.id,
    })
    if (!firstPath) firstPath = path
  }

  // Enregistre la levée + lève le blocage police
  const { error: updErr } = await sb
    .from('incoming_missions')
    .update({
      levee_saisie_at:        new Date().toISOString(),
      levee_saisie_date:      date,
      levee_saisie_type:      type,
      levee_saisie_note:      note || null,
      levee_saisie_doc_path:  firstPath,
      levee_saisie_by:        actor.id,
      police_levee_saisie_ok: true,
      ...(payer ? { levee_saisie_payer: payer } : {}),
      // Frais de justice : on pose le payeur tout de suite, pour que la
      // facturation n'ait pas à le deviner.
      ...(payer === 'frais_justice'
        ? { billed_to_id: FRAIS_JUSTICE_ODOO_ID, billed_to_name: FRAIS_JUSTICE_NAME }
        : {}),
    })
    .eq('id', params.id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  await sb.from('mission_logs').insert({
    mission_id: params.id,
    actor_id:   actor.id,
    action:     'levee_saisie',
    notes:      remarkText,
    metadata:   { type, date, has_doc: !!firstPath, payer: payer || null },
  })

  // Levée DÉFINITIVE : le dossier Parquet sort du circuit tout de suite (sinon
  // la Vue dossier affiche « état de frais à venir » jusqu'au cron du matin).
  if (type !== 'temporaire') {
    try {
      const { closeSaisieDossierIfOutOfScope } = await import('@/lib/missions/saisie-cron')
      const closed = await closeSaisieDossierIfOutOfScope(sb, params.id)
      if (closed) {
        const { invalidateDossierCache } = await import('@/lib/dossier/build')
        invalidateDossierCache(params.id)
      }
    } catch (e: any) { console.warn('[levee-saisie] clôture dossier Parquet KO :', e?.message) }
  }

  return NextResponse.json({ ok: true })
}
