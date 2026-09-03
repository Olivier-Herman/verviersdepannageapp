// src/lib/missions/saisie-cron.ts
//
// Cron JOURNALIER de facturation saisie. Détecte les actions dues sur chaque
// dossier et, selon le mode :
//   • « Prépare + Alerte » (défaut) : pose pending_action + notifie → l'humain
//     clique « Envoyer » dans le cockpit après un coup d'œil.
//   • « Automatique » (bascule via app_settings) : envoie directement.
//
// Déclencheurs (Olivier 2026-08-09) :
//   A. À facturer  — dernier jour du mois SUIVANT la saisie, client absent.
//   B. Gardiennage — tous les 2 mois après la 1re facture (tant que Parquet).
//   C. Clôture Domaine — la Date IN (incoming_missions.domaine_remise_date) est
//      atteinte → état de frais de clôture au Parquet. ENSUITE le Domaine se
//      facture via le module Domaine (tableau validé par Rosemarie) : plus
//      aucun état de frais ici, et le dossier se clôture quand tout est facturé.
//
// + FORCLUSION (AR 15/12/2019 art. 41, 6 mois) : alerte par état de frais non
//   déposé à J-60 / J-30 / J-7. Pas de relance automatique du Parquet (Olivier
//   2026-09-03) : l'humain décide.
// + Le résumé de chaque passage est écrit dans app_settings.saisie_cron_last
//   (bandeau cockpit si erreurs ou cron muet).

import { sendEtatFrais, autoIntegrateNewSaisies, saisieScopeFrom, outOfParquetScope } from '@/lib/missions/saisie-dossier'
import { forclusionDate, daysUntil, forclusionLevel, FORCLUSION_STOPS } from '@/lib/missions/saisie-relance'
import { sendRequisitoireRelance } from '@/lib/requisitoire/relance'
import { hasValidRequisitoire } from '@/lib/requisitoire/doc'
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
const fmtFR = (ymd?: string | null) => (ymd ? String(ymd).slice(0, 10).split('-').reverse().join('/') : '—')

async function getAutoSend(sb: any): Promise<boolean> {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'saisie_auto_send').maybeSingle()
  if (!data?.value) return false
  try { return JSON.parse(data.value) === true } catch { return false }
}

export interface SaisieCronSummary {
  auto: boolean; checked: number; prepared: number; sent: number; relances: number
  integrated: number; closed: number; forclusionAlerts: number
  actions: { plate: string; kind: string }[]; errors: string[]
}

export async function runSaisieCron(sb: any): Promise<SaisieCronSummary> {
  const auto = await getAutoSend(sb)
  const today = belgianToday()
  const out: SaisieCronSummary = { auto, checked: 0, prepared: 0, sent: 0, relances: 0, actions: [], errors: [], integrated: 0, closed: 0, forclusionAlerts: 0 }

  // 0) Intègre automatiquement les nouvelles saisies en parc.
  out.integrated = await autoIntegrateNewSaisies(sb)

  const scopeFrom = await saisieScopeFrom(sb)
  const { data: dossiers } = await sb.from('saisie_dossiers').select('*').neq('state', 'clos')
  for (const d of (dossiers || [])) {
    // Périmètre : on ignore les saisies antérieures à juin 2026 (ancien système).
    if (d.parked_at && String(d.parked_at).slice(0, 10) < scopeFrom) continue
    out.checked++
    const mission = d.mission_id
      ? (await sb.from('incoming_missions')
          .select('status, domaine_remise_date, domaine_enlevement_date, levee_saisie_at, levee_saisie_date, requisitoire_at, requisitoire_doc_path, requisitoire_last_reminder_at')
          .eq('id', d.mission_id).maybeSingle()).data
      : null
    const remise = mission?.domaine_remise_date ? String(mission.domaine_remise_date).slice(0, 10) : null

    // Snapshot de la Date IN sur le dossier (visible au cockpit).
    if (remise && remise !== d.domaine_remise_date) {
      await sb.from('saisie_dossiers').update({ domaine_remise_date: remise }).eq('id', d.id)
    }

    // ── Hors circuit Parquet → clôture du dossier ────────────────────────────
    //   • Levée de saisie : plus de facturation au Parquet (règle Olivier
    //     2026-08-24). On ne clôture que si aucun état de frais n'est parti :
    //     un EF déjà chez le Parquet doit suivre son cycle jusqu'au bout.
    //   • Restitution client : véhicule sorti du parc + facturé, hors circuit
    //     Domaine, avant tout dépôt JustInvoice.
    // La levée peut venir de la fiche OU avoir été posée à la main sur le dossier.
    const scope = outOfParquetScope(mission
      ? { ...mission, levee_saisie_at: mission.levee_saisie_at || mission.levee_saisie_date || d.levee_date }
      : { levee_saisie_date: d.levee_date, domaine_remise_date: d.domaine_remise_date })
    const leveeClose = scope.out && !!(mission?.levee_saisie_at || mission?.levee_saisie_date || d.levee_date) && !d.ef_number
    const sortieClose = scope.out && !!mission && ['completed', 'to_invoice', 'cancelled'].includes(mission.status)
    if ((leveeClose || sortieClose) && !['justinvoice', 'liquide', 'facture', 'gardiennage_recurrent'].includes(d.state)) {
      await sb.from('saisie_dossiers').update({
        state: 'clos', pending_action: null, pending_action_at: null,
        levee_date: (mission?.levee_saisie_at || mission?.levee_saisie_date)
          ? String(mission.levee_saisie_at || mission.levee_saisie_date).slice(0, 10) : d.levee_date,
        notes: leveeClose
          ? `Clôturé auto : ${scope.reason} Gardiennage éventuel à facturer au client.`
          : 'Clôturé auto : restitution / facturation directe (hors Parquet/Domaine).',
        updated_at: new Date().toISOString(),
      }).eq('id', d.id)
      out.closed++
      continue
    }

    // ── Circuit Domaine : après l'état de clôture, plus rien à établir ici ───
    //    (le gardiennage Domaine passe par le tableau de Rosemarie). Le dossier
    //    se clôture quand tous ses états de frais sont facturés (ou refusés).
    if (d.recipient === 'domaine') {
      const { data: efs } = await sb.from('saisie_etats_frais').select('status').eq('dossier_id', d.id)
      const open = (efs || []).some((e: any) => !['facture', 'refuse'].includes(e.status))
      if (!open && (efs || []).length > 0) {
        await sb.from('saisie_dossiers').update({
          state: 'clos', pending_action: null, pending_action_at: null,
          notes: 'Clôturé auto : facturation Parquet terminée, suite du gardiennage au Domaine (module Domaine).',
          updated_at: new Date().toISOString(),
        }).eq('id', d.id)
        out.closed++
      } else if (d.pending_action) {
        await sb.from('saisie_dossiers').update({ pending_action: null, pending_action_at: null }).eq('id', d.id)
      }
      await checkForclusion(sb, d, out)
      continue
    }

    // ── GARDE-FOU : Date IN antérieure à l'entrée en parc = donnée fausse ────
    if (remise && d.parked_at && remise < String(d.parked_at).slice(0, 10)) {
      out.errors.push(`${d.vehicle_plate || '—'} : Date IN Domaine (${fmtFR(remise)}) antérieure à l'entrée en parc (${fmtFR(d.parked_at)}) — corriger la fiche`)
      if (d.pending_action) await sb.from('saisie_dossiers').update({ pending_action: null, pending_action_at: null }).eq('id', d.id)
      await checkForclusion(sb, d, out)
      continue
    }

    // ── Détermine l'action DUE + sa date de coupe (calculée automatiquement) ──
    let action: { kind: 'cloture_domaine' | 'facturer' | 'gardiennage'; cut: string } | null = null
    if (remise && remise <= today && (!d.billed_to_date || d.billed_to_date < remise)) {
      action = { kind: 'cloture_domaine', cut: remise }                               // coupe = Date IN
    } else if (remise && d.billed_to_date && d.billed_to_date >= remise) {
      // État de clôture déjà établi → le dossier bascule au Domaine (plus de gardiennage ici).
      await sb.from('saisie_dossiers').update({ recipient: 'domaine', pending_action: null, pending_action_at: null, updated_at: new Date().toISOString() }).eq('id', d.id)
      await checkForclusion(sb, d, out)
      continue
    } else if (d.state === 'en_parc' && d.parked_at && today >= endOfMonthAfter(d.parked_at)) {
      action = { kind: 'facturer', cut: endOfMonthAfter(d.parked_at) }                // dernier jour du mois suivant
    } else if (d.billed_to_date && today >= addMonths(d.billed_to_date, 2)) {
      // Gardiennage récurrent tous les 2 mois — MÊME en attente de retour Parquet
      // (règle B, Olivier 2026-08-10). Dès que le 1er EF est fait (billed_to_date).
      action = { kind: 'gardiennage', cut: addMonths(d.billed_to_date, 2) }           // dernière coupe + 2 mois
    }

    await checkForclusion(sb, d, out)

    // ── GATE réquisitoire : un réquisitoire = document PDF/JPG (jamais une
    //    capture de mail). Sans lui : pas d'état de frais, et surtout pas de dépôt
    //    JustInvoice → on relance le policier (throttle 7 j) sur TOUT dossier
    //    ouvert, action due ou non. Olivier 2026-08-09 / 2026-09-03. ─────────────
    if (mission && !hasValidRequisitoire(mission)) {
      if (d.mission_id && daysSince(mission.requisitoire_last_reminder_at) >= 7) {
        const r = await sendRequisitoireRelance(d.mission_id)
        if (r.ok) { out.relances++; out.actions.push({ plate: d.vehicle_plate || '—', kind: 'relance réquisitoire' }) }
      }
      continue
    }
    if (!action) continue

    // ── Exécute l'action (Auto = envoie ; sinon Prépare + Alerte) ─────────────
    // Exception : levée de saisie → gardiennage hors saisie → JAMAIS d'envoi auto,
    // le dossier doit être vérifié à la main. Olivier 2026-08-10.
    const manualOnly = !!d.levee_date
    if (auto && !manualOnly) {
      // Clôture Domaine = état final au Parquet ; sinon on respecte le destinataire
      // du dossier (client possible), jamais « domaine » (module Domaine).
      const recipient = action.kind === 'cloture_domaine' ? 'parquet' : (d.recipient === 'client' ? 'client' : 'parquet')
      const res = await sendEtatFrais(sb, d.id, { billingTo: action.cut, recipient }, null)
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

  // Trace du passage (bandeau cockpit : erreurs, ou cron muet depuis > 36 h).
  await sb.from('app_settings').upsert({
    key: 'saisie_cron_last',
    value: JSON.stringify({ at: new Date().toISOString(), ok: out.errors.length === 0, ...out }),
  }, { onConflict: 'key' }).then(() => {}, () => {})

  return out
}

// ── Forclusion : alerte par palier (une fois chacun) sur les EF non déposés ──
async function checkForclusion(sb: any, d: any, out: SaisieCronSummary): Promise<void> {
  const { data: efs } = await sb.from('saisie_etats_frais')
    .select('id, numero, status, period_from, include_depannage, forclusion_alert_level')
    .eq('dossier_id', d.id)
  for (const ef of (efs || [])) {
    if (FORCLUSION_STOPS.includes(ef.status)) continue
    const fd = forclusionDate(ef, d.parked_at)
    const level = forclusionLevel(daysUntil(fd))
    if (level <= (ef.forclusion_alert_level || 0)) continue
    await sb.from('saisie_etats_frais').update({ forclusion_alert_level: level }).eq('id', ef.id)
    out.forclusionAlerts++
    const days = daysUntil(fd)
    await sendNotificationToRoles(['admin', 'superadmin'], 'saisie_facturation', {
      title: `⏳ Forclusion ${days != null && days < 0 ? 'DÉPASSÉE' : `dans ${days} j`} — ${d.vehicle_plate || ''}`,
      body: `${ef.numero} (${ef.status}) doit être déposé sur JustInvoice avant le ${fmtFR(fd)} (6 mois à dater de la prestation).`,
      action_url: '/fourriere/saisies',
    }).catch(() => {})
  }
}
