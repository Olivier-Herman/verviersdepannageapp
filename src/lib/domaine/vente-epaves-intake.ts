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

const noAccent = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export interface VenteEpavesSummary {
  scanned: number; processed: number; entries: number
  applied: number; alreadySet: number; noMatch: number; ambiguous: number; errors: number
}

export async function pollVenteEpaves(): Promise<VenteEpavesSummary> {
  const sb = createAdminClient()
  const s: VenteEpavesSummary = { scanned: 0, processed: 0, entries: 0, applied: 0, alreadySet: 0, noMatch: 0, ambiguous: 0, errors: 0 }

  let msgs: any[] = []
  try {
    msgs = await searchMessages(VENTE_MAILBOX, `from:${VENTE_SENDER} vente epaves`, 50)
  } catch (e: any) {
    console.error('[vente-epaves] recherche mail KO:', e?.message)
    return s
  }

  // Filtre strict (le $search est flou) : bon expéditeur + sujet « épaves ».
  const candidates = msgs.filter(m =>
    (m.from || '').toLowerCase() === VENTE_SENDER &&
    noAccent(m.subject).includes(SUBJECT_KEY),
  )
  s.scanned = candidates.length
  if (!candidates.length) return s

  // Traces déjà enregistrées (par email + VIN) : on ne retraite pas les
  // applied/already_set, mais on retente les no_match/ambiguous.
  const ids = candidates.map(m => m.id)
  const { data: seen } = await sb.from('domaine_ventes_epaves')
    .select('source_email_id, vin, outcome').in('source_email_id', ids)
  const doneSet = new Set(
    (seen || []).filter((r: any) => r.outcome === 'applied' || r.outcome === 'already_set')
      .map((r: any) => `${r.source_email_id}|${r.vin}`),
  )

  for (const msg of candidates) {
    try {
      const body = await getMessageBody(VENTE_MAILBOX, msg.id)
      const parsed = parseVenteEpaves({ content: body.content, contentType: body.contentType })
      if (!parsed.vehicles.length) { s.processed++; continue }

      const venteDate = String(msg.receivedDateTime || '').slice(0, 10)
      const firm      = parsed.firm
      const maxEnl    = parsed.maxEnlevementDate

      for (const v of parsed.vehicles) {
        s.entries++
        if (doneSet.has(`${msg.id}|${v.vin}`)) continue

        const { data: hits } = await sb.from('incoming_missions')
          .select('id, mission_number, vehicle_vin, vehicle_plate, vehicle_brand, vehicle_model, parc_zone_key, domaine_vente_date, domaine_enlevement_date')
          .eq('source', 'police_saisie')
          .is('domaine_vente_date', null)
          .is('archived_at', null)
          .neq('status', 'cancelled')
          .ilike('vehicle_vin', `%${v.vinTail}`)
          .limit(5)

        let outcome = 'no_match', matchedId: string | null = null
        if ((hits || []).length === 1) {
          const m = hits![0]
          matchedId = m.id
          if (m.domaine_vente_date) { outcome = 'already_set'; s.alreadySet++ }
          else {
            const upd: any = {
              domaine_vente_date: venteDate || null,
              domaine_vente_firm: firm,
            }
            // Date OUT = date max d'enlèvement, sauf si un enlèvement réel est déjà posé.
            if (maxEnl && !m.domaine_enlevement_date) upd.domaine_enlevement_date = maxEnl
            await sb.from('incoming_missions').update(upd).eq('id', m.id)

            await sb.from('mission_logs').insert({
              mission_id: m.id, actor_id: null, action: 'domaine_vente',
              notes: `Vendu par soumission${firm ? ` à ${firm}` : ''} (mail Vente d'épaves) · vente ${venteDate}${maxEnl ? ` · enlèvement max ${maxEnl}` : ''}`,
              metadata: { source: 'vente_epaves', firm, vente_date: venteDate, max_enlevement: maxEnl, vin: v.vin, email_id: msg.id },
            }).then(() => {}, () => {})
            outcome = 'applied'; s.applied++

            // Étiquette VENDU auto (firme + véhicule + zone + Date OUT) → file d'impression.
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
