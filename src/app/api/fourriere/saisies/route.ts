// src/app/api/fourriere/saisies/route.ts
//
// Cockpit Facturation SAISIE :
//   GET  → dossiers suivis (+ états de frais, forclusion, réquisitoire ok) +
//          saisies en parc pas encore intégrées + mode d'envoi + dernier cron
//   POST { mission_id }            → intègre UNE saisie (crée son dossier)
//   POST { action:'sync_all' }     → intègre toutes les saisies en parc orphelines
//   POST { action:'set_mode', auto } → bascule Prépare+Alerte / Auto (admin)
//   POST { action:'send_all', ids } → envoie les états de frais dus (km = 0)
// Accès : admin / superadmin / module fourriere. Olivier 2026-08-09 / 2026-09-03.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { autoIntegrateNewSaisies, saisieScopeFrom, outOfParquetScope, sendEtatFrais } from '@/lib/missions/saisie-dossier'
import { forclusionDate, daysUntil, forclusionLevel } from '@/lib/missions/saisie-relance'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function canAccess(session: any): boolean {
  if (!session) return false
  const u = session.user as any
  return ['admin', 'superadmin'].includes(u.role || '') || (u.modules || []).includes('fourriere')
}

const SNAP = 'id, dossier_number, vehicle_plate, vehicle_brand, vehicle_model, client_name, parked_at, received_at, status, levee_saisie_at, levee_saisie_date, domaine_remise_date, domaine_enlevement_date, requisitoire_at, saisie_motif_code, saisie_motif_label'

function snapshotFromMission(m: any) {
  return {
    mission_id:    m.id,
    vehicle_plate: m.vehicle_plate || null,
    vehicle_brand: m.vehicle_brand || null,
    vehicle_model: m.vehicle_model || null,
    dossier_ref:   m.dossier_number || null,
    parked_at:     (m.parked_at || m.received_at || '').slice(0, 10) || null,
    levee_date:    m.levee_saisie_date ? String(m.levee_saisie_date).slice(0, 10) : null,
    motif_code:    m.saisie_motif_code || null,
    motif_label:   m.saisie_motif_label || null,
  }
}

const EF_SELECT = 'id, dossier_id, numero, status, recipient, period_from, period_to, include_depannage, total_htva, total_tvac, justinvoice_ref, justinvoice_detail_url, odoo_invoice_id, created_at, validation_at, liquide_at, status_note, relance_count, last_relance_at, relance_stop'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()

  // Auto-intégration des nouvelles saisies (idempotent), pour que le cockpit soit à jour à l'ouverture.
  await autoIntegrateNewSaisies(sb).catch(() => 0)

  const scopeFrom = await saisieScopeFrom(sb)

  // Dossiers suivis (périmètre juin 2026+ ; masque l'ancien parc).
  const { data: dossiersRaw, error } = await sb.from('saisie_dossiers').select('*')
    .or(`parked_at.gte.${scopeFrom},parked_at.is.null`)
    .order('parked_at', { ascending: true }).order('id', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Réquisitoire présent ? (règle : pas d'état de frais sans réquisitoire)
  const missionIds = Array.from(new Set((dossiersRaw || []).map((d: any) => d.mission_id).filter(Boolean)))
  const reqOk = new Map<string, boolean>()
  const leveeByMission = new Map<string, string | null>()   // levée réelle (la fiche fait foi)
  if (missionIds.length) {
    const { data: ms } = await sb.from('incoming_missions').select('id, requisitoire_at, levee_saisie_at, levee_saisie_date').in('id', missionIds)
    for (const m of (ms || [])) { reqOk.set(m.id, !!m.requisitoire_at); leveeByMission.set(m.id, m.levee_saisie_at || m.levee_saisie_date || null) }
  }
  // États de frais (devis) par dossier — pour les actions par état de frais.
  const dIds = (dossiersRaw || []).map((d: any) => d.id)
  const efByDossier = new Map<string, any[]>()
  if (dIds.length) {
    const { data: efs } = await sb.from('saisie_etats_frais')
      .select(EF_SELECT)
      .in('dossier_id', dIds).order('created_at', { ascending: true }).order('id', { ascending: true })
    for (const e of (efs || [])) {
      if (!efByDossier.has(e.dossier_id)) efByDossier.set(e.dossier_id, [])
      efByDossier.get(e.dossier_id)!.push(e)
    }
  }

  const dossiers = (dossiersRaw || []).map((d: any) => ({
    ...d,
    requisitoire_ok: d.mission_id ? (reqOk.get(d.mission_id) ?? false) : true,  // dossier manuel sans fiche = pas de blocage
    // Levée : la fiche fait foi (le snapshot du dossier peut être antérieur).
    levee_date: (d.mission_id ? leveeByMission.get(d.mission_id) : null) || d.levee_date || null,
    etats: (efByDossier.get(d.id) || []).map((e: any) => {
      // Forclusion (6 mois à dater de la prestation) tant que l'EF n'est pas déposé.
      const forclusion_at = forclusionDate(e, d.parked_at)
      const forclusion_days = daysUntil(forclusion_at)
      return { ...e, forclusion_at, forclusion_days, forclusion_level: forclusionLevel(forclusion_days) }
    }),
  }))

  // Saisies EN PARC pas encore intégrées (à proposer en 1 clic).
  const linked = new Set(dossiers.map((d: any) => d.mission_id).filter(Boolean))
  const { data: saisies } = await sb.from('incoming_missions')
    .select(SNAP)
    .eq('source', 'police_saisie')
    .in('status', ['parked', 'completed', 'to_invoice'])
    .gte('received_at', scopeFrom)   // périmètre : à partir de juin 2026
    .order('received_at', { ascending: false })
    .limit(200)
  // Hors circuit Parquet (levée de saisie, véhicule déjà sorti/facturé) → on ne
  // le propose plus à l'intégration : il n'y a rien à facturer au Parquet.
  const orphans = (saisies || []).filter((m: any) => !linked.has(m.id) && !outOfParquetScope(m).out)

  // Mode d'envoi du cron (Prépare+Alerte vs Auto) + dernier passage du cron.
  const { data: settings } = await sb.from('app_settings').select('key, value').in('key', ['saisie_auto_send', 'saisie_cron_last'])
  let autoSend = false
  let cronLast: any = null
  for (const s of (settings || [])) {
    try {
      if (s.key === 'saisie_auto_send') autoSend = JSON.parse(s.value) === true
      if (s.key === 'saisie_cron_last') cronLast = JSON.parse(s.value)
    } catch {}
  }

  return NextResponse.json({ dossiers, orphans, autoSend, cronLast })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const u = session!.user as any
  const sb = createAdminClient()
  const body = await req.json().catch(() => ({}))

  // Bascule du mode d'envoi (admin uniquement).
  if (body.action === 'set_mode') {
    if (!['admin', 'superadmin'].includes(u.role || '')) return NextResponse.json({ error: 'Réservé aux admins' }, { status: 403 })
    const auto = body.auto === true
    const { error } = await sb.from('app_settings').upsert({ key: 'saisie_auto_send', value: JSON.stringify(auto) }, { onConflict: 'key' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, auto })
  }

  // Envoi groupé des états de frais dus (km aller-retour = 0, coupe calculée).
  if (body.action === 'send_all') {
    const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: any) => typeof x === 'string').slice(0, 60) : []
    if (!ids.length) return NextResponse.json({ error: 'Aucun dossier' }, { status: 400 })
    const results: { id: string; ok: boolean; numero?: string; email?: string; error?: string }[] = []
    for (const id of ids) {
      const { data: d } = await sb.from('saisie_dossiers').select('id, recipient, pending_action').eq('id', id).maybeSingle()
      if (!d) { results.push({ id, ok: false, error: 'Dossier introuvable' }); continue }
      const recipient = d.pending_action === 'cloture_domaine' ? 'parquet' : (d.recipient === 'domaine' ? 'parquet' : d.recipient)
      const r = await sendEtatFrais(sb, id, { recipient }, u.id || null)
      results.push({ id, ok: r.ok, numero: r.numero, email: r.email, error: r.error })
    }
    return NextResponse.json({ ok: true, sent: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results })
  }

  const scopeFrom = await saisieScopeFrom(sb)
  if (body.action === 'sync_all') {
    const { data: dossiers } = await sb.from('saisie_dossiers').select('mission_id')
    const linked = new Set((dossiers || []).map((d: any) => d.mission_id).filter(Boolean))
    const { data: saisies } = await sb.from('incoming_missions').select(SNAP)
      .eq('source', 'police_saisie').in('status', ['parked', 'completed', 'to_invoice']).gte('received_at', scopeFrom).limit(200)
    const toCreate = (saisies || []).filter((m: any) => !linked.has(m.id) && !outOfParquetScope(m).out).map(snapshotFromMission)
    if (toCreate.length === 0) return NextResponse.json({ ok: true, created: 0 })
    const { error } = await sb.from('saisie_dossiers').insert(toCreate)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, created: toCreate.length })
  }

  const missionId = String(body.mission_id || '')
  if (!missionId) return NextResponse.json({ error: 'mission_id requis' }, { status: 400 })
  const { data: m } = await sb.from('incoming_missions').select(SNAP).eq('id', missionId).maybeSingle()
  if (!m) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  const scope = outOfParquetScope(m)
  if (scope.out) return NextResponse.json({ error: `${scope.reason} Ce dossier n'a pas à être traité au Parquet.` }, { status: 400 })

  const { data: dossier, error } = await sb.from('saisie_dossiers')
    .insert(snapshotFromMission(m)).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, dossier })
}
