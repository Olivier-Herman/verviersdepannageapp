// src/lib/domaine/intake.ts
//
// Domaine — Sujet 1 « Dates IN ». Capture les mails de rosemarie.lehnen@minfin.fed.be
// (sujet contenant « Dates IN »), présents n'importe où dans fourriere@ (souvent
// dans le dossier « A traiter par Mobi », pas l'inbox → recherche toute la boîte).
// Pour chaque véhicule : match par les 5 DERNIERS du VIN sur une saisie ACTIVE
// (police_saisie, pas encore vendue, non annulée/archivée) → pose automatiquement
// domaine_remise_date si UNIQUE et pas déjà posée. Trace tout dans domaine_dates_in.
// Olivier 2026-07-29.

import { createAdminClient } from '@/lib/supabase'
import { searchMessages, getMessageBody } from '@/lib/requisitoire/graph'
import { parseDatesIn } from './parse-dates-in'

export const DOMAINE_MAILBOX = 'fourriere@verviersdepannage.be'
export const DOMAINE_SENDER  = 'rosemarie.lehnen@minfin.fed.be'
const SUBJECT_KEY = 'dates in'

// Saisies à considérer : nouvelles fiches (police_saisie) + fiches historiques
// migrées de TowSoft/Odoo (legacy_odoo). Olivier 2026-07-29.
const SAISIE_SOURCES = ['police_saisie', 'legacy_odoo']

// Bornes anti-timeout : chaque étiquette peut attendre jusqu'à 10 s si le PC
// d'impression est lent. On ne remonte pas trop loin et on plafonne le nb de
// mails traités par passe ; le re-scan des passes suivantes draine le reste.
const LOOKBACK_MONTHS   = 6
const MAX_MAILS_PER_RUN = 6
const MAX_APPLY_PER_RUN = 20

function lookbackCutoff(): string {
  const c = new Date(); c.setMonth(c.getMonth() - LOOKBACK_MONTHS)
  return c.toISOString().slice(0, 10)
}

export interface DomaineIntakeSummary {
  scanned: number       // mails candidats
  processed: number     // mails nouvellement traités
  entries: number       // lignes véhicule vues
  applied: number       // dates posées
  alreadySet: number    // fiche déjà avec une date de remise
  noMatch: number       // véhicule non trouvé en saisie
  ambiguous: number     // plusieurs saisies pour un même VIN
  errors: number
}

export async function pollDomaineDatesIn(): Promise<DomaineIntakeSummary> {
  const sb = createAdminClient()
  const s: DomaineIntakeSummary = { scanned: 0, processed: 0, entries: 0, applied: 0, alreadySet: 0, noMatch: 0, ambiguous: 0, errors: 0 }

  let msgs: any[] = []
  try {
    msgs = await searchMessages(DOMAINE_MAILBOX, `from:${DOMAINE_SENDER} ${SUBJECT_KEY}`, 50)
  } catch (e: any) {
    console.error('[domaine dates-in] recherche mail KO:', e?.message)
    return s
  }

  // Filtre strict (le $search est flou) : bon expéditeur + sujet « Dates IN ».
  const candidates = msgs.filter(m =>
    (m.from || '').toLowerCase() === DOMAINE_SENDER &&
    (m.subject || '').toLowerCase().includes(SUBJECT_KEY),
  )
  // Fenêtre récente + mails les plus récents d'abord + plafond par passe.
  const cutoff = lookbackCutoff()
  const bounded = candidates
    .filter(m => String(m.receivedDateTime || '') >= cutoff)
    .sort((a, b) => String(b.receivedDateTime || '').localeCompare(String(a.receivedDateTime || '')))
    .slice(0, MAX_MAILS_PER_RUN)
  s.scanned = bounded.length
  if (!bounded.length) return s

  // Mails déjà traités (dédup par source_email_id).
  const ids = bounded.map(m => m.id)
  const { data: seen } = await sb.from('domaine_dates_in').select('source_email_id').in('source_email_id', ids)
  const seenSet = new Set((seen || []).map((r: any) => r.source_email_id))

  for (const msg of bounded) {
    if (seenSet.has(msg.id)) continue
    if (s.applied >= MAX_APPLY_PER_RUN) break
    try {
      const body = await getMessageBody(DOMAINE_MAILBOX, msg.id)
      const entries = parseDatesIn({ content: body.content, contentType: body.contentType })
      if (!entries.length) { s.processed++; continue }

      for (const e of entries) {
        s.entries++
        // Saisies actives (parked en pratique) pas encore vendues, non annulées/archivées.
        const { data: hits } = await sb.from('incoming_missions')
          .select('id, mission_number, source, vehicle_vin, vehicle_plate, vehicle_brand, vehicle_model, parc_zone_key, domaine_remise_date')
          .in('source', SAISIE_SOURCES)
          .is('domaine_vente_date', null)
          .is('archived_at', null)
          .neq('status', 'cancelled')
          .ilike('vehicle_vin', `%${e.vinTail}`)
          .limit(5)

        let outcome = 'no_match', matchedId: string | null = null, appliedDate: string | null = null
        if ((hits || []).length === 1) {
          const m = hits![0]
          matchedId = m.id
          // Présent dans le tableau Domaine ⇒ c'est une saisie : normalise la
          // source (les fiches historiques migrées sont en legacy_odoo).
          if (m.source !== 'police_saisie') {
            await sb.from('incoming_missions').update({ source: 'police_saisie' }).eq('id', m.id)
            await sb.from('mission_logs').insert({
              mission_id: m.id, actor_id: null, action: 'source_requalified',
              notes: `Source « ${m.source} » → « police_saisie » (véhicule listé dans le tableau Domaine de Rosemarie)`,
              metadata: { source: 'domaine_dates_in', from: m.source, to: 'police_saisie', email_id: msg.id },
            }).then(() => {}, () => {})
          }
          if (m.domaine_remise_date) { outcome = 'already_set' ; s.alreadySet++ }
          else {
            await sb.from('incoming_missions').update({
              domaine_remise_date: e.remiseDate,
              domaine_at:          new Date().toISOString(),
              domaine_note:        `Remise au Domaine (mail Dates IN)${e.pvName ? ` — PV de remise ${e.pvName}` : ''}`,
            }).eq('id', m.id)
            await sb.from('mission_logs').insert({
              mission_id: m.id, actor_id: null, action: 'domaine_remise',
              notes: `Date de remise Domaine ${e.remiseDate} posée automatiquement (mail Dates IN)${e.pvName ? ` · PV ${e.pvName}` : ''}`,
              metadata: { source: 'domaine_dates_in', remise_date: e.remiseDate, vin: e.vin, email_id: msg.id },
            }).then(() => {}, () => {})
            outcome = 'applied'; appliedDate = e.remiseDate; s.applied++

            // Étiquette DOMAINE auto (véhicule + zone + date remise) → file d'impression.
            try {
              const { buildDomaineLabelZPL } = await import('@/lib/print/zpl-templates/domaine-label')
              const { printZPLRaw } = await import('@/lib/print/zebra-raw')
              const zpl = buildDomaineLabelZPL({
                missionId: m.id, missionNumber: m.mission_number, remiseDate: e.remiseDate,
                brand: m.vehicle_brand, model: m.vehicle_model, plate: m.vehicle_plate,
                vin: m.vehicle_vin || e.vin, zone: m.parc_zone_key, pvName: e.pvName,
              })
              await printZPLRaw(zpl, { missionId: m.id })
            } catch (pe: any) {
              console.warn('[domaine dates-in] impression étiquette KO (non bloquant):', pe?.message)
            }
          }
        } else if ((hits || []).length > 1) {
          outcome = 'ambiguous'; s.ambiguous++
        } else {
          s.noMatch++
        }

        await sb.from('domaine_dates_in').insert({
          source_email_id: msg.id, received_at: msg.receivedDateTime, remise_date: e.remiseDate,
          brand: e.brand, model: e.model, vin: e.vin, vin_tail: e.vinTail, pv_remise_name: e.pvName,
          matched_mission_id: matchedId, outcome, applied_date: appliedDate,
        }).then(() => {}, () => {})
      }
      s.processed++
    } catch (err: any) {
      console.error(`[domaine dates-in] mail ${msg.id} KO:`, err?.message)
      s.errors++
    }
  }
  return s
}
