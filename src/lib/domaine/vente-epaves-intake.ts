// src/lib/domaine/vente-epaves-intake.ts
//
// Domaine — Sujet 2 « Vente d'épaves ». Capture les mails de
// rosemarie.lehnen@minfin.fed.be (sujet « Vente d'épaves »), présents n'importe
// où dans fourriere@ (souvent dans « A traiter par Mobi »). Pour chaque véhicule :
// match par les 5 DERNIERS du VIN sur une saisie ACTIVE (police_saisie, pas
// encore vendue) → pose domaine_vente_date (= date du mail), domaine_vente_firm
// (firme gagnante) et domaine_enlevement_date (= date max d'enlèvement = Date OUT,
// si pas déjà renseignée). Imprime une étiquette VENDU par véhicule. Trace tout
// dans domaine_ventes_epaves. On re-scanne à chaque passe : les no_match sont
// retentés (une saisie a pu être créée entre-temps). Olivier 2026-07-29.

import { createAdminClient } from '@/lib/supabase'
import { searchMessages, getMessageBody } from '@/lib/requisitoire/graph'
import { parseVenteEpaves } from './parse-vente-epaves'

export const VENTE_MAILBOX = 'fourriere@verviersdepannage.be'
export const VENTE_SENDER  = 'rosemarie.lehnen@minfin.fed.be'
const SUBJECT_KEY = 'paves'   // « Vente d'épaves » (comparé sans accent)

// Saisies à considérer : nouvelles fiches (police_saisie) + fiches historiques
// migrées de TowSoft/Odoo (legacy_odoo).
const SAISIE_SOURCES = ['police_saisie', 'legacy_odoo']

// Bornes anti-timeout (chaque étiquette peut attendre jusqu'à 10 s si le PC
// d'impression est lent) : fenêtre récente + plafonds par passe. Le re-scan
// des passes suivantes traite le reste.
const LOOKBACK_MONTHS   = 6
// On balaie jusqu'à 30 mails de la fenêtre (récents d'abord) mais on PLAFONNE
// les poses/étiquettes à 20 par passe (anti-timeout d'impression). Les passes
// suivantes drainent les mails plus anciens (les véhicules déjà appliqués sont
// skippés, donc la progression avance vers l'ancien).
const MAX_MAILS_PER_RUN = 30
const MAX_APPLY_PER_RUN = 20

function lookbackCutoff(): string {
  const c = new Date(); c.setMonth(c.getMonth() - LOOKBACK_MONTHS)
  return c.toISOString().slice(0, 10)
}

const noAccent = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export interface VenteEpavesSummary {
  scanned: number; processed: number; entries: number
  applied: number; alreadySet: number; noMatch: number; ambiguous: number; errors: number
  msgsSeen?: number; candidatesSeen?: number; searchError?: string   // diagnostic
}

export async function pollVenteEpaves(): Promise<VenteEpavesSummary> {
  const sb = createAdminClient()
  const s: VenteEpavesSummary = { scanned: 0, processed: 0, entries: 0, applied: 0, alreadySet: 0, noMatch: 0, ambiguous: 0, errors: 0 }

  let msgs: any[] = []
  try {
    // Recherche sur l'expéditeur seul : « épaves » est indexé accentué par Graph,
    // le terme « epaves » ne matcherait pas. Le filtre sujet (sans accent) se fait
    // en code juste après.
    msgs = await searchMessages(VENTE_MAILBOX, `from:${VENTE_SENDER}`, 100)
    s.msgsSeen = msgs.length
  } catch (e: any) {
    console.error('[vente-epaves] recherche mail KO:', e?.message)
    s.searchError = String(e?.message || e).slice(0, 200)
    return s
  }

  // Filtre strict (le $search est flou) : bon expéditeur + sujet « épaves ».
  const candidates = msgs.filter(m =>
    (m.from || '').toLowerCase() === VENTE_SENDER &&
    noAccent(m.subject).includes(SUBJECT_KEY),
  )
  s.candidatesSeen = candidates.length
  // Fenêtre récente + mails les plus récents d'abord + plafond par passe.
  const cutoff = lookbackCutoff()
  const bounded = candidates
    .filter(m => String(m.receivedDateTime || '') >= cutoff)
    .sort((a, b) => String(b.receivedDateTime || '').localeCompare(String(a.receivedDateTime || '')))
    .slice(0, MAX_MAILS_PER_RUN)
  s.scanned = bounded.length
  if (!bounded.length) return s

  // Traces déjà enregistrées (par email + VIN) : on ne retraite pas les
  // applied/already_set, mais on retente les no_match/ambiguous.
  const ids = bounded.map(m => m.id)
  const { data: seen } = await sb.from('domaine_ventes_epaves')
    .select('source_email_id, vin, outcome').in('source_email_id', ids)
  // On ne skippe QUE les ventes déjà entièrement traitées (applied) ; les
  // already_set/no_match/ambiguous sont re-traités pour compléter les champs
  // manquants (Date OUT, firme) sur des véhicules déjà marqués vendus ailleurs.
  const doneSet = new Set(
    (seen || []).filter((r: any) => r.outcome === 'applied')
      .map((r: any) => `${r.source_email_id}|${r.vin}`),
  )

  for (const msg of bounded) {
    if (s.applied >= MAX_APPLY_PER_RUN) break
    try {
      const body = await getMessageBody(VENTE_MAILBOX, msg.id)
      const parsed = parseVenteEpaves({ content: body.content, contentType: body.contentType })
      if (!parsed.vehicles.length) { s.processed++; continue }

      const venteDate = String(msg.receivedDateTime || '').slice(0, 10)
      const firm      = parsed.firm
      const maxEnl    = parsed.maxEnlevementDate

      for (const v of parsed.vehicles) {
        if (s.applied >= MAX_APPLY_PER_RUN) break
        s.entries++
        if (doneSet.has(`${msg.id}|${v.vin}`)) continue

        const { data: hits } = await sb.from('incoming_missions')
          .select('id, mission_number, source, vehicle_vin, vehicle_plate, vehicle_brand, vehicle_model, parc_zone_key, domaine_vente_date, domaine_vente_firm, domaine_remise_date, domaine_enlevement_date')
          .in('source', SAISIE_SOURCES)
          .is('domaine_vente_date', null)
          .is('archived_at', null)
          .neq('status', 'cancelled')
          .ilike('vehicle_vin', `%${v.vinTail}`)
          .limit(5)

        let outcome = 'no_match', matchedId: string | null = null
        if ((hits || []).length === 1) {
          const m = hits![0]
          matchedId = m.id
          // Présent dans le tableau Domaine ⇒ c'est une saisie : normalise la source.
          if (m.source !== 'police_saisie') {
            await sb.from('incoming_missions').update({ source: 'police_saisie' }).eq('id', m.id)
            await sb.from('mission_logs').insert({
              mission_id: m.id, actor_id: null, action: 'source_requalified',
              notes: `Source « ${m.source} » → « police_saisie » (véhicule listé dans le tableau Vente d'épaves de Rosemarie)`,
              metadata: { source: 'vente_epaves', from: m.source, to: 'police_saisie', email_id: msg.id },
            }).then(() => {}, () => {})
          }
          const wasNew = !m.domaine_vente_date
          // Complète les champs domaine manquants depuis le mail SANS écraser un
          // existant : vente (si nouveau), firme, Date IN (colonne après le VIN),
          // Date OUT (= date max d'enlèvement). Garantit un montant calculable.
          const upd: any = {}
          if (wasNew && venteDate)                   upd.domaine_vente_date = venteDate
          if (firm && !m.domaine_vente_firm)         upd.domaine_vente_firm = firm
          if (v.emailDate && !m.domaine_remise_date) upd.domaine_remise_date = v.emailDate
          if (maxEnl && !m.domaine_enlevement_date)  upd.domaine_enlevement_date = maxEnl
          if (Object.keys(upd).length) await sb.from('incoming_missions').update(upd).eq('id', m.id)

          const dateIn = m.domaine_remise_date || v.emailDate || null
          if (wasNew) {
            await sb.from('mission_logs').insert({
              mission_id: m.id, actor_id: null, action: 'domaine_vente',
              notes: `Vendu par soumission${firm ? ` à ${firm}` : ''} (mail Vente d'épaves) · vente ${venteDate}${dateIn ? ` · date IN ${dateIn}` : ''}${maxEnl ? ` · enlèvement max ${maxEnl}` : ''}`,
              metadata: { source: 'vente_epaves', firm, vente_date: venteDate, date_in: dateIn, max_enlevement: maxEnl, vin: v.vin, email_id: msg.id },
            }).then(() => {}, () => {})
            outcome = 'applied'; s.applied++

            // Étiquette VENDU auto (uniquement sur une vente NOUVELLE → jamais de
            // réimpression pour un véhicule déjà vendu).
            try {
              const { buildEpaveLabelZPL } = await import('@/lib/print/zpl-templates/epave-label')
              const { printZPLRaw } = await import('@/lib/print/zebra-raw')
              const zpl = buildEpaveLabelZPL({
                missionId: m.id, missionNumber: m.mission_number, firm: firm || '',
                dateOut: maxEnl, brand: m.vehicle_brand, model: m.vehicle_model,
                plate: m.vehicle_plate, vin: m.vehicle_vin || v.vin, zone: m.parc_zone_key,
              })
              await printZPLRaw(zpl, { missionId: m.id })
            } catch (pe: any) {
              console.warn('[vente-epaves] impression étiquette KO (non bloquant):', pe?.message)
            }
          } else {
            // Déjà marqué vendu : complément silencieux (Date OUT/firme), pas d'étiquette.
            outcome = 'already_set'; s.alreadySet++
            if (upd.domaine_enlevement_date || upd.domaine_vente_firm || upd.domaine_remise_date) {
              await sb.from('mission_logs').insert({
                mission_id: m.id, actor_id: null, action: 'domaine_vente_complement',
                notes: `Complément Vente d'épaves${upd.domaine_vente_firm ? ` · firme ${firm}` : ''}${upd.domaine_enlevement_date ? ` · Date OUT ${maxEnl}` : ''}${upd.domaine_remise_date ? ` · Date IN ${v.emailDate}` : ''}`,
                metadata: { source: 'vente_epaves', backfill: upd, vin: v.vin, email_id: msg.id },
              }).then(() => {}, () => {})
            }
          }
        } else if ((hits || []).length > 1) {
          outcome = 'ambiguous'; s.ambiguous++
        } else {
          s.noMatch++
        }

        await sb.from('domaine_ventes_epaves').upsert({
          source_email_id: msg.id, received_at: msg.receivedDateTime,
          firm, vente_date: venteDate || null, max_enlevement_date: maxEnl,
          numero: v.numero, brand: v.brand, model: v.model, vin: v.vin, vin_tail: v.vinTail,
          matched_mission_id: matchedId, outcome,
        }, { onConflict: 'source_email_id,vin' }).then(() => {}, () => {})
      }
      s.processed++
    } catch (err: any) {
      console.error(`[vente-epaves] mail ${msg.id} KO:`, err?.message)
      s.errors++
    }
  }
  return s
}
