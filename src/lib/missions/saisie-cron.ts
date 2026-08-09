// src/lib/missions/saisie-cron.ts
//
// Cron JOURNALIER de facturation saisie. Détecte les actions dues sur chaque
// dossier et, selon le mode :
//   • « Prépare + Alerte » (défaut) : pose pending_action + notifie → l'humain
//     clique « Envoyer » dans le cockpit après un coup d'œil.
//   • « Automatique » (bascule ultérieure via app_settings) : envoie directement.
//
// Déclencheurs (Olivier 2026-08-09) :
//   A. À facturer  — dernier jour du mois SUIVANT la saisie, client absent.
//   B. Gardiennage — tous les 2 mois après la 1re facture.
//   C. Clôture Domaine — la Date IN (incoming_missions.domaine_remise_date) est
//      atteinte → état de frais de clôture au Parquet, puis bascule au Domaine.

import { sendEtatFrais } from '@/lib/missions/saisie-dossier'
import { sendRequisitoireRelance } from '@/lib/requisitoire/relance'
import { sendNotificationToRoles } from '@/lib/notifications/send'

const daysSince = (iso?: string | null) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : Infinity

const belgianToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date())

// Dernier jour du mois SUIVANT une date (saisie 14/09 → 31/10).
function endOfMonthAfter(ymd: string): string {
  const [y, m] = ymd.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10)  // jour 0 du mois (m+1)+1 = dernier jour de m+1
}
function addMonths(ymd: string, n: number): string {
  const d = new Date(ymd.slice(0, 10) + 'T00:00:00Z')
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 10)
}

async function getAutoSend(sb: any): Promise<boolean> {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'saisie_auto_send').maybeSingle()
  if (!data?.value) return false
  try { return JSON.parse(data.value) === true } catch { return false }
}

export interface SaisieCronSummary {
  auto: boolean; checked: number; prepared: number; sent: number; relances: number
  actions: { plate: string; kind: string }[]; errors: string[]
}

export async function runSaisieCron(sb: any): Promise<SaisieCronSummary> {
  const auto = await getAutoSend(sb)
  const today = belgianToday()
  const out: SaisieCronSummary = { auto, checked: 0, prepared: 0, sent: 0, relances: 0, actions: [], errors: [] }

  const { data: dossiers } = await sb.from('saisie_dossiers').select('*').neq('state', 'clos')
  for (const d of (dossiers || [])) {
    out.checked++
    const mission = d.mission_id
      ? (await sb.from('incoming_missions')
          .select('domaine_remise_date, requisitoire_at, requisitoire_last_reminder_at')
          .eq('id', d.mission_id).maybeSingle()).data
      : null
    const remise = mission?.domaine_remise_date ? String(mission.domaine_remise_date).slice(0, 10) : null

    // Snapshot de la Date IN sur le dossier (visible au cockpit).
    if (remise && remise !== d.domaine_remise_date) {
      await sb.from('saisie_dossiers').update({ domaine_remise_date: remise }).eq('id', d.id)
    }

    // ── Détermine l'action DUE + sa date de coupe (calculée automatiquement) ──
    let action: { kind: 'cloture_domaine' | 'facturer' | 'gardiennage'; cut: string } | null = null
    if (remise && remise <= today && d.recipient !== 'domaine' && (!d.billed_to_date || d.billed_to_date < remise)) {
      action = { kind: 'cloture_domaine', cut: remise }                               // coupe = Date IN
    } else if (d.state === 'en_parc' && d.parked_at && today >= endOfMonthAfter(d.parked_at)) {
      action = { kind: 'facturer', cut: endOfMonthAfter(d.parked_at) }                // dernier jour du mois suivant
    } else if (['facture', 'gardiennage_recurrent'].includes(d.state) && d.billed_to_date && today >= addMonths(d.billed_to_date, 2)) {
      action = { kind: 'gardiennage', cut: addMonths(d.billed_to_date, 2) }           // dernière coupe + 2 mois
    }
    if (!action) continue

    // ── GATE réquisitoire : pas d'état de frais sans réquisitoire → on relance
    //    le policier (throttle 7 j) au lieu de facturer. Olivier 2026-08-09. ────
    if (mission && !mission.requisitoire_at) {
      if (d.mission_id && daysSince(mission.requisitoire_last_reminder_at) >= 7) {
        const r = await sendRequisitoireRelance(d.mission_id)
        if (r.ok) { out.relances++; out.actions.push({ plate: d.vehicle_plate || '—', kind: 'relance réquisitoire' }) }
      }
      continue
    }

    // ── Exécute l'action (Auto = envoie ; sinon Prépare + Alerte) ─────────────
    if (auto) {
      const res = await sendEtatFrais(sb, d.id, { billingTo: action.cut, recipient: action.kind === 'cloture_domaine' ? 'parquet' : undefined }, null)
      if (res.ok) {
        out.sent++; out.actions.push({ plate: d.vehicle_plate || '—', kind: 'envoyé' })
        if (action.kind === 'gardiennage') await sb.from('saisie_dossiers').update({ state: 'gardiennage_recurrent' }).eq('id', d.id)
      } else out.errors.push(`${d.vehicle_plate}: ${res.error}`)
    } else {
      const patch: any = { pending_action: action.kind, pending_action_at: action.cut, updated_at: new Date().toISOString() }
      if (action.kind === 'facturer') patch.state = 'a_facturer'
      await sb.from('saisie_dossiers').update(patch).eq('id', d.id)
      out.prepared++; out.actions.push({ plate: d.vehicle_plate || '—', kind: action.kind })
    }
  }

  // Alerte (une notif récap aux admins/superadmins).
  if (out.actions.length > 0) {
    const bits: string[] = []
    if (auto && out.sent) bits.push(`${out.sent} envoyé(s)`)
    if (!auto && out.prepared) bits.push(`${out.prepared} à traiter`)
    if (out.relances) bits.push(`${out.relances} relance(s) réquisitoire`)
    const title = `Saisies : ${bits.join(' · ') || out.actions.length + ' action(s)'}`
    const body = out.actions.slice(0, 8).map(a => `${a.plate} (${a.kind})`).join(', ')
    await sendNotificationToRoles(['admin', 'superadmin'], 'saisie_facturation', {
      title, body, action_url: '/fourriere/saisies',
    }).catch(() => {})
  }

  return out
}
