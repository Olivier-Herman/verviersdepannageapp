// src/lib/missions/saisie-relance.ts
//
// FORCLUSION + relance MANUELLE d'un état de frais (Olivier 2026-09-03).
//
// Forclusion : AR 15/12/2019 art. 41 — « à peine de forclusion, les prestataires
// introduisent leurs états de frais auprès du bureau de taxation dans les six
// mois à dater du jour de l'exécution de leur prestation ». Lecture prudente :
// la prestation la plus ancienne de l'état de frais = début de sa période
// (dépannage = jour de l'entrée). Le dépôt JustInvoice arrête l'horloge.
//
// Relance : JAMAIS automatique — le Parquet n'apprécie pas (Olivier 03/09).
// Bouton manuel, réservé aux cas proches de la forclusion.

import { renderEtatFraisPdf } from '@/lib/missions/saisie-etat-frais-pdf'
import { resolveRecipientEmail, resolveDestinataire, validationLink } from '@/lib/missions/saisie-dossier'
import { sendEmail, emailLayout, button, infoRow, divider } from '@/lib/emails'
import type { SaisieRecipient } from '@/lib/missions/saisie-billing'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.verviersdepannage.com'
const FOURRIERE_FROM = 'fourriere@verviersdepannage.be'
export const FORCLUSION_MONTHS = 6
export const FORCLUSION_STOPS = ['depose', 'liquide', 'facture']   // l'horloge s'arrête au dépôt

const fmtFR = (ymd?: string | null) => (ymd ? String(ymd).slice(0, 10).split('-').reverse().join('/') : '—')

/** Date de forclusion d'un état de frais (YYYY-MM-DD) ou null si non concerné. */
export function forclusionDate(ef: { period_from?: string | null; include_depannage?: boolean | null; status?: string | null }, parkedAt?: string | null): string | null {
  if (ef.status && FORCLUSION_STOPS.includes(ef.status)) return null
  const base = (ef.include_depannage && parkedAt) ? parkedAt : (ef.period_from || parkedAt)
  if (!base) return null
  const d = new Date(String(base).slice(0, 10) + 'T00:00:00Z')
  d.setUTCMonth(d.getUTCMonth() + FORCLUSION_MONTHS)
  return d.toISOString().slice(0, 10)
}

export function daysUntil(ymd: string | null): number | null {
  if (!ymd) return null
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date())
  return Math.round((Date.parse(ymd + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000)
}

/** Niveau d'alerte forclusion : 0 rien · 1 ≤ 60 j · 2 ≤ 30 j · 3 ≤ 7 j (ou dépassé). */
export function forclusionLevel(days: number | null): 0 | 1 | 2 | 3 {
  if (days == null) return 0
  if (days <= 7) return 3
  if (days <= 30) return 2
  if (days <= 60) return 1
  return 0
}

export interface RelanceResult { ok: boolean; email?: string; error?: string }

function buildRelanceHtml(d: any, ef: any, link: string, sentAt: string): string {
  const veh = [d.vehicle_brand, d.vehicle_model].filter(Boolean).join(' ') || '—'
  const eur = `${Number(ef.total_tvac || 0).toFixed(2).replace('.', ',')} €`
  const content = `
    <p style="margin:0 0 4px;font-size:22px;font-weight:700;color:#111;">État de frais ${ef.numero}</p>
    <p style="margin:0 0 20px;font-size:14px;color:#888;">Verviers Dépannage SA — service Fourrière</p>
    <p style="margin:0 0 16px;font-size:14px;color:#333;line-height:1.6;">
      Madame, Monsieur,<br><br>
      Nous nous permettons de revenir vers vous au sujet de l'état de frais ci-joint, transmis le ${sentAt},
      relatif au véhicule saisi repris ci-dessous. Sauf erreur de notre part, nous n'en avons pas encore reçu le retour.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;">
      ${infoRow('Plaque', d.vehicle_plate || '—')}
      ${infoRow('Véhicule', veh)}
      ${d.dossier_ref ? infoRow('N° PV', d.dossier_ref) : ''}
      ${infoRow('Montant TVAC', eur)}
    </table>
    ${divider()}
    <p style="margin:0 0 16px;font-size:14px;color:#333;line-height:1.6;">
      Le délai légal d'introduction auprès du bureau de taxation approchant, auriez-vous l'amabilité de nous le
      retourner signé, pour accord ou pour refus, par retour de courriel ou par courrier&nbsp;?
    </p>
    <p style="margin:0 0 24px;text-align:center;">${button(link, 'Déposer l\'état de frais signé')}</p>
    <p style="margin:24px 0 0;font-size:13px;color:#888;">Avec nos remerciements anticipés.<br>Le service Fourrière — Verviers Dépannage</p>
  `
  return emailLayout(content, `État de frais ${ef.numero}`)
}

/** Relance manuelle : renvoie l'état de frais (PDF reconstruit depuis ses lignes) au destinataire routé. */
export async function sendEfRelance(sb: any, dossierId: string, efId: string): Promise<RelanceResult> {
  const { data: d } = await sb.from('saisie_dossiers').select('*').eq('id', dossierId).maybeSingle()
  if (!d) return { ok: false, error: 'Dossier introuvable' }
  const { data: ef } = await sb.from('saisie_etats_frais').select('*').eq('id', efId).eq('dossier_id', dossierId).maybeSingle()
  if (!ef) return { ok: false, error: 'État de frais introuvable' }
  if (ef.status !== 'envoye') return { ok: false, error: `Cet état de frais est « ${ef.status} » : pas de relance.` }

  const recipient = (ef.recipient || d.recipient || 'parquet') as SaisieRecipient
  let mission: any = null
  if (d.mission_id) {
    mission = (await sb.from('incoming_missions')
      .select('client_name, billed_to_name, incident_address, incident_city, vehicle_vin, client_email, received_at')
      .eq('id', d.mission_id).maybeSingle()).data
  }
  const dest = resolveRecipientEmail(recipient, d.motif_code, mission?.client_email)
  if (!dest) return { ok: false, error: 'Destinataire sans adresse e-mail' }

  const link = d.validation_token ? validationLink(d.validation_token) : `${APP_URL}/fourriere/saisies`
  const pdf = await renderEtatFraisPdf({
    numero: ef.numero, dateEmission: ef.period_to, recipient,
    destinataire: resolveDestinataire(recipient, mission, dest.email),
    pv: d.dossier_ref, dateSaisie: mission?.received_at || d.parked_at, parkedAt: d.parked_at,
    periodFrom: ef.period_from, periodTo: ef.period_to,
    plate: d.vehicle_plate || '', vehicle: [d.vehicle_brand, d.vehicle_model].filter(Boolean).join(' '),
    vin: mission?.vehicle_vin || null, motif: d.motif_label || null,
    billing: { lines: ef.lines_json || [], totalHtva: Number(ef.total_htva || 0), totalTvac: Number(ef.total_tvac || 0), recipient },
    qrUrl: link,
  })

  const sentAt = fmtFR(ef.created_at)
  try {
    await sendEmail(
      dest.email, `État de frais ${ef.numero} — ${d.vehicle_plate || 'véhicule'} (rappel)`,
      buildRelanceHtml(d, ef, link, sentAt), dest.label, undefined,
      [{ name: `etat-de-frais-${ef.numero}.pdf`, contentType: 'application/pdf', contentBytes: pdf.toString('base64') }],
      FOURRIERE_FROM,
    )
  } catch (e: any) { return { ok: false, error: `Envoi impossible : ${e?.message || e}` } }

  await sb.from('saisie_etats_frais').update({ relance_count: (ef.relance_count || 0) + 1, last_relance_at: new Date().toISOString() }).eq('id', ef.id)
  if (d.mission_id) {
    await sb.from('mission_remarks').insert({ mission_id: d.mission_id, text: `📨 Rappel état de frais ${ef.numero} envoyé à ${dest.email}` }).then(() => {}, () => {})
  }
  return { ok: true, email: dest.email }
}
