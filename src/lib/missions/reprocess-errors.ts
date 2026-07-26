// src/lib/missions/reprocess-errors.ts
//
// Récupération des missions en erreur (parse_error / source unknown /
// placeholders PROCESSING_ vides). Deux mécanismes :
//   - re-parse du raw_content stocké (modèle réparé)
//   - re-téléchargement de l'email via son id Graph (placeholder vide)
//
// Utilisé par : le cron auto (/api/cron/reprocess-errors), l'admin
// (/api/admin/missions/errors POST) et le dispatcher (/api/missions/reprocess).
//
// Lot limité car le re-fetch + parse Claude prend ~10s/mission (limite Vercel).
// Olivier 2026-06-16.

import { createAdminClient } from '@/lib/supabase'

export interface ReprocessResult {
  reparsed:  number
  refetched: number
  failed:    number
  processed: number
  more:      boolean
  errors:    string[]
  sample?:   { incident_address: string | null; incident_city: string | null; destination_address: string | null } | null
}

const REPROCESS_FILTER = 'status.eq.parse_error,source.eq.unknown,external_id.like.PROCESSING_%,external_id.like.UNKNOWN_SENDER_%'

// Un placeholder vide est re-téléchargé (delete + processEmailMessage). Si l'email
// TIMEOUTE systématiquement (lot trop lourd, pièce jointe énorme), ce refetch
// recrée un orphelin qui sera re-nettoyé puis re-retenté → boucle infinie sur 72h
// qui spamme l'alerte « Webhook crashe ». On plafonne : après MAX_REFETCH échecs
// pour un même email, on l'ABANDONNE (marqueur TIMEOUT_, exclu du reprocess).
// Compteur persistant par source_email_id dans app_settings. Olivier 2026-07-26.
const MAX_REFETCH = 2
const FAILMAP_KEY = 'webhook_refetch_fails'

// Le cron ne ré-essaye que les blocages récents : au-delà, c'est du contenu
// non parsable (spam, mails hors-sujet) qu'on ne veut pas re-parser en boucle
// (coût Claude inutile). Olivier 2026-06-16.
const REPROCESS_WINDOW_HOURS = 72

/**
 * Nombre de missions RÉCENTES réellement bloquées (badge dispatch).
 * Volontairement étroit : uniquement les échecs de traitement récents
 *   (a) status = parse_error
 *   (b) placeholder PROCESSING_ resté bloqué > 4 min
 * On exclut le bruit historique (source unknown ancien, UNKNOWN_SENDER_) qui
 * gonflait le compteur et faisait peur pour rien.
 */
export async function countErrorMissions(): Promise<number> {
  const sb = createAdminClient()
  const since    = new Date(Date.now() - 48 * 3600_000).toISOString()
  const inFlight = new Date(Date.now() - 4 * 60_000).toISOString()

  const [a, b] = await Promise.all([
    sb.from('incoming_missions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'parse_error')
      .not('external_id', 'like', 'TIMEOUT_%')   // exclut les emails abandonnés (timeout chronique)
      .gte('received_at', since),
    sb.from('incoming_missions')
      .select('id', { count: 'exact', head: true })
      .like('external_id', 'PROCESSING_%')
      .gte('received_at', since)
      .lt('received_at', inFlight),
  ])
  return (a.count || 0) + (b.count || 0)
}

export async function reprocessErrorMissions(opts: { onlyId?: string | null; batch?: number } = {}): Promise<ReprocessResult> {
  const onlyId = opts.onlyId || null
  const BATCH  = onlyId ? 1 : (opts.batch ?? 4)
  const sb = createAdminClient()

  let q = sb
    .from('incoming_missions')
    .select('id, status, source, source_format, raw_content, external_id, source_email_id, received_at')
  if (onlyId) {
    // Olivier 2026-06-18 : action manuelle ciblée sur UNE fiche → on autorise le
    // re-parsing quel que soit le statut (pas seulement les erreurs). Permet de
    // re-parser une fiche "réussie" mais mal extraite (ex: adresse Touring).
    q = q.eq('id', onlyId)
  } else {
    // Lot auto : seulement les blocages récents (pas de re-parsing en boucle
    // de vieux contenus non parsables).
    q = q
      .or(REPROCESS_FILTER)
      .gte('received_at', new Date(Date.now() - REPROCESS_WINDOW_HOURS * 3600_000).toISOString())
      .order('received_at', { ascending: false })
  }
  const { data: rows, error } = await q.limit(BATCH + 4)  // marge pour filtrer les in-flight
  if (error) throw new Error(error.message)

  // Ne pas toucher aux placeholders PROCESSING_ encore EN COURS de traitement
  // (créés il y a < 4 min) — sauf si on cible un id précis (action manuelle).
  const inFlightCutoff = Date.now() - 4 * 60 * 1000
  const candidates = (rows || []).filter(m => {
    if (onlyId) return true
    // Emails ABANDONNÉS (timeout chronique) : ne plus jamais les retenter.
    if (String(m.external_id || '').startsWith('TIMEOUT_')) return false
    if (String(m.external_id || '').startsWith('PROCESSING_') && m.received_at) {
      return new Date(m.received_at).getTime() < inFlightCutoff
    }
    return true
  }).slice(0, BATCH)

  // Compteur d'échecs de refetch par email (persistant) — pour plafonner les
  // retentatives et casser la boucle de timeout. Chargé une fois, sauvé à la fin.
  let failMap: Record<string, number> = {}
  if (!onlyId) {
    try {
      const { data: fm } = await sb.from('app_settings').select('value').eq('key', FAILMAP_KEY).maybeSingle()
      if (fm?.value && typeof fm.value === 'object') failMap = { ...(fm.value as any) }
    } catch { /* best-effort */ }
  }
  let failMapDirty = false

  const { parseMissionContent } = await import('./parser')
  const { processEmailMessage } = await import('./processor')
  let reparsed = 0, refetched = 0, failed = 0
  const errors: string[] = []
  // Olivier 2026-06-18 : pour une action ciblée (onlyId), on renvoie l'adresse
  // d'intervention re-parsée afin que la fiche affiche immédiatement le résultat.
  let sample: { incident_address: string | null; incident_city: string | null; destination_address: string | null } | null = null

  for (const m of candidates) {
    const raw = (m.raw_content || '').trim()
    const isEmptyPlaceholder = String(m.external_id || '').startsWith('PROCESSING_') &&
      (!raw || raw.length < 80 || /placeholder orphelin/i.test(raw))

    // Cas 1 : placeholder vide → re-fetch l'email (delete placeholder + reprocess).
    if (isEmptyPlaceholder && m.source_email_id) {
      const emailKey = String(m.source_email_id)
      const priorFails = failMap[emailKey] || 0

      // Plafond atteint → ABANDON : on marque la fiche TIMEOUT_ (exclue du
      // reprocess et de la boucle) au lieu de re-télécharger un email qui
      // timeoute à tous les coups. Purge auto > 72h par le cron de cleanup.
      if (priorFails >= MAX_REFETCH) {
        await sb.from('incoming_missions').update({
          external_id: `TIMEOUT_${Date.now()}`,
          status:      'parse_error',
          raw_content: `Email abandonné après ${priorFails} timeouts de traitement (lot trop lourd / pièce jointe). Vérifier manuellement la boîte si mission attendue.`,
        }).eq('id', m.id).then(() => {}, () => {})
        delete failMap[emailKey]; failMapDirty = true
        failed++; errors.push(`${m.id}: abandonné (${priorFails} timeouts)`)
        continue
      }

      // On PRÉ-incrémente et on SAUVE le compteur AVANT le refetch : si le cron
      // reprocess est lui-même tué par le timeout pendant processEmailMessage,
      // l'échec est quand même compté (sinon le compteur n'avancerait jamais et
      // la boucle ne se casserait pas). En cas de succès on ré-efface ensuite.
      failMap[emailKey] = priorFails + 1
      await sb.from('app_settings').upsert(
        { key: FAILMAP_KEY, value: failMap }, { onConflict: 'key' },
      ).then(() => {}, () => {})

      try {
        await sb.from('incoming_missions').delete().eq('id', m.id)
        const res: any = await processEmailMessage(m.source_email_id)
        if (res.status === 'inserted' || res.status === 'duplicate') {
          refetched++
          delete failMap[emailKey]; failMapDirty = true   // succès → reset compteur
        } else {
          failed++; errors.push(`${m.id}: refetch ${res.status} ${res.error || res.reason || ''}`.slice(0, 140))
        }
      } catch (e: any) {
        failed++; errors.push(`${m.id}: refetch ${e.message?.slice(0, 100)}`)
      }
      continue
    }

    // Cas 2 : contenu présent → re-parse.
    if (!raw) { failed++; continue }
    try {
      const parsed = await parseMissionContent(
        (m.source as any) || 'unknown',
        { textContent: raw, sourceFormat: (m.source_format as any) || 'email_plain', rawContent: raw },
        'Reprocess parse_error',
      )
      // Olivier 2026-06-18 : on ne remet 'new' QUE si la fiche était en erreur.
      // Re-parser une fiche déjà avancée (parked, to_invoice, dispatching…) ne
      // doit PAS la renvoyer en "En commande" — on garde son statut, on ne
      // rafraîchit que les champs extraits (ex: corriger l'adresse).
      const wasError = m.status === 'parse_error'
        || String(m.external_id || '').startsWith('PROCESSING_')
        || String(m.external_id || '').startsWith('UNKNOWN_')
      const upd: Record<string, any> = {
        parse_confidence: parsed.confidence ?? 0.5,
        updated_at:       new Date().toISOString(),
      }
      if (wasError) upd.status = 'new'
      for (const f of ['dossier_number','mission_type','incident_type','incident_description',
        'client_name','client_phone','client_address','vehicle_plate','vehicle_brand','vehicle_model',
        'vehicle_vin','vehicle_fuel','vehicle_gearbox','incident_address','incident_city',
        'destination_name','destination_address','amount_guaranteed'] as const) {
        if ((parsed as any)[f] != null && (parsed as any)[f] !== '') upd[f] = (parsed as any)[f]
      }
      // incident_at : valider la date (LLM peut renvoyer un format invalide →
      // rejet timestamptz qui ferait échouer tout l'UPDATE).
      if (parsed.incident_at && !isNaN(Date.parse(String(parsed.incident_at)))) upd.incident_at = parsed.incident_at
      const { error: uErr } = await sb.from('incoming_missions').update(upd).eq('id', m.id)
      if (uErr) { failed++; errors.push(`${m.id}: ${uErr.message}`) } else {
        reparsed++
        // Olivier 2026-06-18 : on relit la ligne pour renvoyer la valeur RÉELLEMENT
        // en base (pas juste ce que le LLM a renvoyé) — diagnostic fiable du
        // "ça affiche encore l'ancienne adresse".
        if (onlyId) {
          const { data: after } = await sb
            .from('incoming_missions')
            .select('incident_address, incident_city, destination_address')
            .eq('id', m.id)
            .maybeSingle()
          sample = {
            incident_address:    after?.incident_address ?? parsed.incident_address ?? null,
            incident_city:       after?.incident_city ?? parsed.incident_city ?? null,
            destination_address: after?.destination_address ?? parsed.destination_address ?? null,
          }
        }
      }
    } catch (e: any) {
      failed++; errors.push(`${m.id}: ${e.message?.slice(0, 120)}`)
    }
  }

  // Sauve la carte des compteurs si modifiée (resets après succès / abandons).
  if (!onlyId && failMapDirty) {
    await sb.from('app_settings').upsert(
      { key: FAILMAP_KEY, value: failMap }, { onConflict: 'key' },
    ).then(() => {}, () => {})
  }

  const processed = (rows || []).length
  return { reparsed, refetched, failed, processed, more: !onlyId && processed >= BATCH, errors: errors.slice(0, 10), sample }
}
