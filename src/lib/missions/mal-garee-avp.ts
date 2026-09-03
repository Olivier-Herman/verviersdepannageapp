// src/lib/missions/mal-garee-avp.ts
//
// RÈGLE (Olivier 2026-09-03) : une « mal garée » (police_mg) présente en parc
// depuis 60 jours passe normalement en ABANDON VOIE PUBLIQUE (police_avp) — mais
// on demande d'abord CONFIRMATION au policier de la fiche.
//
// Automate (cron journalier) : à J+60 en parc, mail courtois au policier
// (e-mail via son contact Odoo, comme la relance réquisitoire) lui demandant de
// confirmer le passage en abandon et de nous transmettre le réquisitoire
// administratif correspondant — par le lien de dépôt ou en réponse (réf SAI-).
// Le réquisitoire « abandon voie publique » qui revient est lu par l'intake →
// la fiche bascule seule en police_avp (requalify). Rappel tous les 14 j, 3 max.
// Sans e-mail de policier → alerte aux admins (une fois), à traiter à la main.

import { getOfficerEmail, ensureDepotToken, depotLink } from '@/lib/requisitoire/relance'
import { sendEmail, emailLayout, button, infoRow, divider } from '@/lib/emails'
import { sendNotificationToRoles } from '@/lib/notifications/send'
import { requestParcVerification, toVerificationItems } from '@/lib/missions/parc-verification'

const FOURRIERE_FROM = 'fourriere@verviersdepannage.be'
const PARC_STATUSES = ['parked', 'delivering', 'unlocated', 'awaiting_payment']
export const MAL_GAREE_AVP_DAYS = 60
const REMINDER_DAYS = 14
const MAX_ASKS = 3

const fmtDate = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
const daysSince = (iso?: string | null) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : 0

export interface MalGareeAvpSummary { checked: number; asked: number; noEmail: number; checksAsked: number; errors: string[] }
const PARC_CHECK_VALID_DAYS = 30

// Dispatchers de bureau actifs (destinataires du popup de vérification).
async function officeUserIds(sb: any): Promise<string[]> {
  const { data } = await sb.from('users').select('id, name').eq('active', true).or('role.eq.dispatcher,roles.ov.{dispatcher}')
  // Les comptes « fusionné » sont des alias historiques.
  return (data || []).filter((u: any) => !/fusionn/i.test(u.name || '')).map((u: any) => u.id)
}

function buildHtml(m: any, days: number, link: string, ref: string): string {
  const veh = [m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ') || '—'
  const content = `
    <p style="margin:0 0 4px;font-size:22px;font-weight:700;color:#111;">Véhicule en fourrière depuis ${days} jours</p>
    <p style="margin:0 0 20px;font-size:14px;color:#888;">Réf. dossier <span style="font-weight:600;color:#444;">${ref}</span></p>
    <p style="margin:0 0 16px;font-size:14px;color:#333;line-height:1.6;">
      Madame, Monsieur,<br><br>
      Le véhicule repris ci-dessous, enlevé à votre demande pour stationnement, est toujours dans notre parc
      et n'a pas été réclamé depuis son entrée.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;">
      ${infoRow('Plaque', m.vehicle_plate || '—')}
      ${infoRow('Véhicule', veh)}
      ${m.vehicle_vin ? infoRow('N° de châssis (VIN)', m.vehicle_vin) : ''}
      ${m.police_pv_number || m.dossier_number ? infoRow('N° PV', m.police_pv_number || m.dossier_number) : ''}
      ${infoRow('Lieu d\'enlèvement', m.incident_address || '—')}
      ${infoRow('Entrée en parc', fmtDate(m.parked_at || m.received_at))}
    </table>
    ${divider()}
    <p style="margin:0 0 16px;font-size:14px;color:#333;line-height:1.6;">
      Le délai de 60 jours étant écoulé, auriez-vous l'amabilité de nous confirmer si ce véhicule doit désormais
      être traité comme <strong>abandonné sur la voie publique</strong> et, dans ce cas, de nous transmettre le
      réquisitoire administratif correspondant&nbsp;? Vous pouvez le déposer directement ci-dessous ou nous le
      renvoyer en réponse à ce courriel.
    </p>
    <p style="margin:0 0 24px;text-align:center;">${button(link, 'Déposer le réquisitoire')}</p>
    <p style="margin:0 0 16px;font-size:14px;color:#333;line-height:1.6;">
      Si le véhicule doit au contraire rester en stationnement gênant ou être restitué, un simple mot en réponse nous suffit.
    </p>
    <p style="margin:24px 0 0;font-size:13px;color:#888;">Nous vous remercions par avance de votre collaboration.<br>Le service Fourrière — Verviers Dépannage</p>
  `
  return emailLayout(content, `Véhicule ${m.vehicle_plate || ''} — ${ref}`)
}

/** Un passage : demande (ou rappelle) la confirmation AVP au policier pour chaque mal garée à J+60 en parc. */
export async function runMalGareeAvpCheck(sb: any): Promise<MalGareeAvpSummary> {
  const out: MalGareeAvpSummary = { checked: 0, asked: 0, noEmail: 0, checksAsked: 0, errors: [] }
  const limit = new Date(Date.now() - MAL_GAREE_AVP_DAYS * 86400000).toISOString()
  const { data: rows } = await sb.from('incoming_missions')
    .select('id, mission_number, vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin, incident_address, parked_at, received_at, police_pv_number, dossier_number, police_zone, officer_name, officer_partner_id, avp_confirm_asked_at, avp_confirm_count, requisitoire_token, parc_verified_at, parc_verified_present, parc_check_asked_at')
    .eq('source', 'police_mg').in('status', PARC_STATUSES).is('archived_at', null)
    .or(`parked_at.lte.${limit},and(parked_at.is.null,received_at.lte.${limit})`)
    .limit(100)

  // ── Étape 0 : vérification PHYSIQUE au parc par le bureau (popup bloquant)
  //    avant toute demande au policier. Une vérification vaut 30 jours.
  //    Olivier 2026-09-03. ─────────────────────────────────────────────────────
  const needCheck = (rows || []).filter((m: any) =>
    (m.avp_confirm_count || 0) < MAX_ASKS &&
    (!m.parc_verified_at || daysSince(m.parc_verified_at) > PARC_CHECK_VALID_DAYS) &&
    !(m.parc_check_asked_at && daysSince(m.parc_check_asked_at) < 2))   // pas de re-demande le lendemain
  if (needCheck.length) {
    const ids = await officeUserIds(sb)
    const items = toVerificationItems(needCheck, (m: any) => `Mal garée depuis ${daysSince(m.parked_at || m.received_at)} j — passage en abandon voie publique à confirmer au policier ensuite`)
    const r = await requestParcVerification(sb, ids, items, 'Merci de vérifier physiquement que ces véhicules sont toujours dans le parc. Tant que ce n\'est pas confirmé, aucune demande ne part vers la police.')
    out.checksAsked += r.sent ? items.length : 0
  }

  for (const m of (rows || [])) {
    out.checked++
    const count = m.avp_confirm_count || 0
    if (count >= MAX_ASKS) continue
    // Pas de mail au policier sans présence confirmée récemment au parc.
    if (!m.parc_verified_at || daysSince(m.parc_verified_at) > PARC_CHECK_VALID_DAYS || m.parc_verified_present !== true) continue
    if (m.avp_confirm_asked_at && daysSince(m.avp_confirm_asked_at) < REMINDER_DAYS) continue
    const days = daysSince(m.parked_at || m.received_at)
    const ref = m.mission_number != null ? `SAI-${m.mission_number}` : `SAI-${String(m.id).slice(0, 8)}`

    const officer = await getOfficerEmail(m.officer_partner_id)
    if (!officer) {
      out.noEmail++
      if (!m.avp_confirm_asked_at) {   // alerte une seule fois
        await sb.from('incoming_missions').update({ avp_confirm_asked_at: new Date().toISOString() }).eq('id', m.id)
        await sb.from('mission_remarks').insert({ mission_id: m.id, text: `⏳ Mal garée en parc depuis ${days} j : passage en abandon voie publique à confirmer par le policier — e-mail du policier inconnu (lier le contact Odoo puis relancer).` }).then(() => {}, () => {})
        await sendNotificationToRoles(['admin', 'superadmin'], 'saisie_facturation', {
          title: `Mal garée ${m.vehicle_plate || ''} : ${days} j en parc`,
          body: `Confirmation AVP à demander au policier (${m.officer_name || 'inconnu'}, ${m.police_zone || '—'}) — pas d'e-mail lié à la fiche.`,
          action_url: `/dispatch/${m.id}`,
        }).catch(() => {})
      }
      continue
    }

    const token = m.requisitoire_token || await ensureDepotToken(m.id)
    const link = token ? depotLink(token) : 'https://app.verviersdepannage.com'
    const subject = `Véhicule ${m.vehicle_plate || 'sans plaque'} en fourrière depuis ${days} jours — réf ${ref}`
    try {
      await sendEmail(officer.email, subject, buildHtml(m, days, link, ref), officer.name, undefined, undefined, FOURRIERE_FROM)
    } catch (e: any) { out.errors.push(`${m.vehicle_plate || m.id} : ${e?.message || e}`); continue }

    await sb.from('incoming_missions').update({ avp_confirm_asked_at: new Date().toISOString(), avp_confirm_count: count + 1 }).eq('id', m.id)
    await sb.from('mission_logs').insert({
      mission_id: m.id, action: 'avp_confirm_asked',
      notes: `Demande de confirmation « abandon voie publique » n°${count + 1} envoyée à ${officer.email} (${days} j en parc).`,
      metadata: { email: officer.email, ref, days },
    }).then(() => {}, () => {})
    await sb.from('mission_remarks').insert({ mission_id: m.id, text: `📨 Mal garée en parc depuis ${days} j : confirmation de passage en abandon voie publique demandée à ${officer.name || officer.email}.` }).then(() => {}, () => {})
    out.asked++
  }

  if (out.asked > 0) {
    await sendNotificationToRoles(['admin', 'superadmin'], 'saisie_facturation', {
      title: `Mal garées > 60 j : ${out.asked} confirmation(s) AVP demandée(s)`,
      body: 'Le réquisitoire « abandon » reçu en retour basculera la fiche en AVP automatiquement.',
      action_url: '/fourriere/relance-requisitoire',
    }).catch(() => {})
  }
  return out
}
