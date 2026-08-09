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
import { sendNotificationToRoles } from '@/lib/notifications/send'

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
  auto: boolean; checked: number; prepared: number; sent: number
  actions: { plate: string; kind: string }[]; errors: string[]
}

export async function runSaisieCron(sb: any): Promise<SaisieCronSummary> {
  const auto = await getAutoSend(sb)
  const today = belgianToday()
  const out: SaisieCronSummary = { auto, checked: 0, prepared: 0, sent: 0, actions: [], errors: [] }

  const { data: dossiers } = await sb.from('saisie_dossiers').select('*').neq('state', 'clos')
  for (const d of (dossiers || [])) {
    out.checked++
    const mission = d.mission_id
      ? (await sb.from('incoming_missions').select('domaine_remise_date').eq('id', d.mission_id).maybeSingle()).data
      : null
    const remise = mission?.domaine_remise_date ? String(mission.domaine_remise_date).slice(0, 10) : null

    // Snapshot de la Date IN sur le dossier (visible au cockpit).
    if (remise && remise !== d.domaine_remise_date) {
      await sb.from('saisie_dossiers').update({ domaine_remise_date: remise }).eq('id', d.id)
    }

    const flag = async (kind: string, at: string) => {
      await sb.from('saisie_dossiers').update({ pending_action: kind, pending_action_at: at, updated_at: new Date().toISOString() }).eq('id', d.id)
      out.prepared++; out.actions.push({ plate: d.vehicle_plate || '—', kind })
    }
    const fire = async (billingTo: string, recipient?: string) => {
      const res = await sendEtatFrais(sb, d.id, { billingTo, recipient: recipient as any }, null)
      if (res.ok) { out.sent++; out.actions.push({ plate: d.vehicle_plate || '—', kind: 'envoyé' }) }
      else out.errors.push(`${d.vehicle_plate}: ${res.error}`)
      return res.ok
    }

    // ── C. Clôture Domaine (prioritaire) ──────────────────────────────────────
    if (remise && remise <= today && d.recipient !== 'domaine' && (!d.billed_to_date || d.billed_to_date < remise)) {
      if (auto) await fire(remise, 'parquet')   // sendEtatFrais bascule recipient→domaine (pending cloture)
      else await flag('cloture_domaine', remise)
      continue
    }

    // ── A. À facturer (1er état de frais) ─────────────────────────────────────
    if (d.state === 'en_parc' && d.parked_at && today >= endOfMonthAfter(d.parked_at)) {
      if (auto) await fire(today)
      else {
        await sb.from('saisie_dossiers').update({ state: 'a_facturer', pending_action: 'facturer', pending_action_at: today, updated_at: new Date().toISOString() }).eq('id', d.id)
        out.prepared++; out.actions.push({ plate: d.vehicle_plate || '—', kind: 'facturer' })
      }
      continue
    }

    // ── B. Gardiennage récurrent (tous les 2 mois après facturation) ──────────
    if (['facture', 'gardiennage_recurrent'].includes(d.state) && d.last_ef_at && today >= addMonths(d.last_ef_at, 2)) {
      if (auto) { if (await fire(today)) await sb.from('saisie_dossiers').update({ state: 'gardiennage_recurrent' }).eq('id', d.id) }
      else await flag('gardiennage', today)
      continue
    }
  }

  // Alerte (une notif récap aux admins/superadmins).
  if (out.actions.length > 0) {
    const title = auto ? `Saisies : ${out.sent} état(s) de frais envoyé(s)` : `Saisies : ${out.prepared} action(s) à traiter`
    const body = out.actions.slice(0, 8).map(a => `${a.plate} (${a.kind})`).join(', ')
    await sendNotificationToRoles(['admin', 'superadmin'], 'saisie_facturation', {
      title, body, action_url: '/fourriere/saisies',
    }).catch(() => {})
  }

  return out
}
