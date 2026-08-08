// src/lib/requisitoire/relance.ts
//
// Relance du réquisitoire police pour un véhicule saisi (fourrière).
// Envoie un mail depuis fourriere@verviersdepannage.be au policier (email tiré
// du contact Odoo), contenant les infos du dossier + un LIEN PUBLIC de dépôt.
// Le policier peut aussi RÉPONDRE en joignant le PDF → l'intake réquisitoire
// existant (poll-requisitoires) le capte et le rattache. Réutilisable par le
// bouton manuel ET le cron. Olivier 2026-08-08. Cf [[project_requisitoire_relance]].

import { randomUUID }        from 'crypto'
import { createAdminClient } from '@/lib/supabase'
import { odooRpc }           from '@/lib/odoo'
import { sendEmail, emailLayout, button, infoRow, divider } from '@/lib/emails'

export const RELANCE_SOURCES = ['police_saisie', 'police_rodeo', 'police_avp']

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.verviersdepannage.com'
const FOURRIERE_FROM = 'fourriere@verviersdepannage.be'

export function depotLink(token: string): string {
  return `${APP_URL}/requisitoire/${token}`
}

// Garantit un token de dépôt pour une fiche (le crée s'il manque). À la demande.
export async function ensureDepotToken(missionId: string): Promise<string | null> {
  const sb = createAdminClient()
  const { data } = await sb.from('incoming_missions').select('requisitoire_token').eq('id', missionId).maybeSingle()
  if (data?.requisitoire_token) return data.requisitoire_token
  const token = randomUUID().replace(/-/g, '')
  const { error } = await sb.from('incoming_missions').update({ requisitoire_token: token }).eq('id', missionId)
  if (error) return null
  return token
}

// Email du policier via son contact Odoo (res.partner). null si pas de partner
// lié ou pas d'email → le process n'est pas opérationnel (à compléter dans Odoo).
export async function getOfficerEmail(partnerId?: number | null): Promise<{ email: string; name: string } | null> {
  if (!partnerId) return null
  try {
    const rows = await odooRpc<any[]>('res.partner', 'read', [[partnerId]], { fields: ['name', 'email'] })
    const p = rows?.[0]
    const email = (p?.email || '').trim()
    if (!email || !/@/.test(email)) return null
    return { email, name: p?.name || '' }
  } catch { return null }
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch { return '—' }
}

type MissionRow = {
  id: string; mission_number: number | null; vehicle_plate: string | null
  vehicle_brand: string | null; vehicle_model: string | null
  incident_address: string | null
  created_at: string | null; parked_at: string | null
  police_pv_number: string | null; police_zone: string | null
  saisie_motif_label: string | null; officer_name: string | null
  officer_partner_id: number | null; requisitoire_token: string | null
  requisitoire_at: string | null; requisitoire_stop: boolean
  requisitoire_reminder_count: number
}

const SELECT = 'id, mission_number, vehicle_plate, vehicle_brand, vehicle_model, incident_address, created_at, parked_at, police_pv_number, police_zone, saisie_motif_label, officer_name, officer_partner_id, requisitoire_token, requisitoire_at, requisitoire_stop, requisitoire_reminder_count'

// Corps HTML de la relance.
function buildHtml(m: MissionRow, token: string): string {
  const veh = [m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ') || '—'
  const lieu = m.incident_address || '—'
  const ref = m.mission_number != null ? `SAI-${m.mission_number}` : '—'
  const link = depotLink(token)
  const n = m.requisitoire_reminder_count
  const relanceLine = n > 0
    ? `<p style="margin:0 0 20px;font-size:14px;color:#b45309;">Rappel n°${n + 1} — nous n'avons pas encore reçu le réquisitoire pour ce véhicule.</p>`
    : ''
  const content = `
    <p style="margin:0 0 4px;font-size:22px;font-weight:700;color:#111;">Réquisitoire à transmettre</p>
    <p style="margin:0 0 20px;font-size:14px;color:#888;">Réf. dossier <span style="font-weight:600;color:#444;">${ref}</span></p>
    ${relanceLine}
    <p style="margin:0 0 16px;font-size:14px;color:#333;line-height:1.6;">
      Bonjour,<br><br>
      Le véhicule ci-dessous a été enlevé et placé en fourrière à la suite d'une saisie.
      Afin de finaliser le dossier, nous vous remercions de nous transmettre le
      <strong>réquisitoire</strong> correspondant.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;">
      ${infoRow('Plaque', m.vehicle_plate || '—')}
      ${infoRow('Véhicule', veh)}
      ${infoRow('Date de saisie', fmtDate(m.created_at))}
      ${infoRow('Lieu', lieu)}
      ${m.police_pv_number ? infoRow('N° PV', m.police_pv_number) : ''}
      ${m.saisie_motif_label ? infoRow('Motif', m.saisie_motif_label) : ''}
    </table>
    ${divider()}
    <p style="margin:0 0 16px;font-size:14px;color:#333;line-height:1.6;">
      <strong>Deux possibilités&nbsp;:</strong>
    </p>
    <p style="margin:0 0 20px;font-size:14px;color:#333;line-height:1.6;">
      1️⃣ Déposer directement le document via le lien sécurisé ci-dessous&nbsp;:
    </p>
    <p style="margin:0 0 24px;text-align:center;">${button(link, 'Déposer le réquisitoire')}</p>
    <p style="margin:0 0 20px;font-size:14px;color:#333;line-height:1.6;">
      2️⃣ Ou <strong>répondre simplement à cet e-mail</strong> en joignant le réquisitoire
      (PDF) — il sera automatiquement rattaché au dossier <strong>${ref}</strong>.
    </p>
    <p style="margin:24px 0 0;font-size:13px;color:#888;">Merci pour votre collaboration,<br>Le service Fourrière — Verviers Dépannage</p>
  `
  return emailLayout(content, `Réquisitoire ${ref}`)
}

export interface RelanceResult { ok: boolean; error?: string; email?: string }

// Envoie (ou renvoie) une relance pour une fiche. Génère le token si absent.
export async function sendRequisitoireRelance(missionId: string): Promise<RelanceResult> {
  const sb = createAdminClient()
  const { data } = await sb.from('incoming_missions').select(SELECT).eq('id', missionId).maybeSingle()
  const m = data as MissionRow | null
  if (!m) return { ok: false, error: 'Fiche introuvable' }
  if (m.requisitoire_at) return { ok: false, error: 'Réquisitoire déjà reçu' }
  if (m.requisitoire_stop) return { ok: false, error: 'Rappels stoppés pour cette fiche' }

  const officer = await getOfficerEmail(m.officer_partner_id)
  if (!officer) return { ok: false, error: "Email du policier inconnu (compléter le contact Odoo)" }

  // Token de dépôt (stable une fois créé).
  let token = m.requisitoire_token
  if (!token) {
    token = randomUUID().replace(/-/g, '')
    await sb.from('incoming_missions').update({ requisitoire_token: token }).eq('id', missionId)
  }

  const ref = m.mission_number != null ? `SAI-${m.mission_number}` : `SAI-${missionId.slice(0, 8)}`
  const subject = `Réquisitoire à transmettre — ${m.vehicle_plate || 'véhicule'} — réf ${ref}`
  try {
    await sendEmail(officer.email, subject, buildHtml(m, token), officer.name, undefined, undefined, FOURRIERE_FROM)
  } catch (e: any) {
    return { ok: false, error: `Envoi impossible : ${e?.message || e}` }
  }

  await sb.from('incoming_missions').update({
    requisitoire_last_reminder_at: new Date().toISOString(),
    requisitoire_reminder_count:   (m.requisitoire_reminder_count || 0) + 1,
  }).eq('id', missionId)

  await sb.from('mission_logs').insert({
    mission_id: missionId, action: 'requisitoire_relance',
    notes: `Relance réquisitoire n°${(m.requisitoire_reminder_count || 0) + 1} envoyée à ${officer.email}.`,
    metadata: { email: officer.email, ref },
  }).then(() => {}, () => {})

  return { ok: true, email: officer.email }
}
