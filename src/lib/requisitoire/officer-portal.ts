// src/lib/requisitoire/officer-portal.ts
//
// PORTAIL POLICIER — un lien signé PAR POLICIER (contact Odoo), pas par véhicule.
// La page publique /police/[token] montre au policier :
//   • ses véhicules saisis dont le réquisitoire manque → dépôt direct (réutilise
//     le dépôt par fiche /api/requisitoire/depot/[token]) ;
//   • ceux déjà reçus (pour qu'il n'appelle plus) ;
//   • les saisies EN PARC sans policier identifié → « C'est mon dossier » :
//     il se l'attribue, puis dépose le réquisitoire.
// Un seul mail par policier (liste + bouton), envoyé à la main depuis la
// relance ou par le cron (throttle 7 j inchangé). Olivier 16/09/2026.
// Cf [[project_requisitoire_relance]].

import crypto                 from 'crypto'
import { createAdminClient }  from '@/lib/supabase'
import { odooRpc }            from '@/lib/odoo'
import { sourcesWithTag }     from '@/lib/missions/source-catalog'
import { sendEmail, emailLayout, button, divider } from '@/lib/emails'
import { sendNotificationToRoles } from '@/lib/notifications/send'
import { ensureDepotToken }   from './relance'

const SECRET   = process.env.NEXTAUTH_SECRET || ''
const TTL_S    = 90 * 24 * 60 * 60          // un lien vit 90 jours ; renvoyé à chaque relance
const APP_URL  = process.env.NEXT_PUBLIC_APP_URL || 'https://app.verviersdepannage.com'
const FOURRIERE_FROM = 'fourriere@verviersdepannage.be'
// « EN PARC » = mêmes statuts que la relance réquisitoire.
const PARC_STATUSES = ['parked', 'delivering', 'unlocated', 'awaiting_payment']

// ── Jeton signé { pid, exp } (HMAC-SHA256, même patron que relances/invoice-token) ──
const b64u  = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64 = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4), 'base64')

export function signOfficerToken(partnerId: number, ttlSec = TTL_S): string {
  const payload = b64u(Buffer.from(JSON.stringify({ pid: partnerId, exp: Math.floor(Date.now() / 1000) + ttlSec })))
  return `${payload}.${b64u(crypto.createHmac('sha256', SECRET).update(payload).digest())}`
}

export function verifyOfficerToken(token: string): number | null {
  if (!token || !SECRET) return null
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return null
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest()
  const given = unb64(sig)
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null
  try {
    const p = JSON.parse(unb64(payload).toString('utf-8'))
    if (typeof p.pid !== 'number' || typeof p.exp !== 'number' || Date.now() / 1000 > p.exp) return null
    return p.pid
  } catch { return null }
}

export const portalLink = (partnerId: number) => `${APP_URL}/police/${signOfficerToken(partnerId)}`

// ── Policier (contact Odoo) + sa zone (police_zones.odoo_company_id) ─────────
export interface PortalOfficer { id: number; name: string; email: string | null; zone: string | null }

export async function getPortalOfficer(partnerId: number): Promise<PortalOfficer | null> {
  const rows = await odooRpc<any[]>('res.partner', 'read', [[partnerId]], { fields: ['name', 'email', 'parent_id', 'is_company'] }).catch(() => null)
  const p = rows?.[0]
  if (!p || p.is_company) return null
  const companyId = Array.isArray(p.parent_id) ? Number(p.parent_id[0]) : null
  let zone: string | null = null
  if (companyId) {
    const { data } = await createAdminClient().from('police_zones').select('name').eq('odoo_company_id', companyId).maybeSingle()
    zone = data?.name || null
  }
  const email = String(p.email || '').trim()
  return { id: p.id, name: p.name || '', email: /@/.test(email) ? email : null, zone }
}

// ── Données de la page ───────────────────────────────────────────────────────
export interface PortalVehicle {
  id: string; ref: string | null; plate: string | null; vehicle: string | null
  location: string | null; saisie_at: string | null; motif: string | null; pv: string | null
  zone: string | null; officer_name: string | null
  token: string | null          // jeton de dépôt par fiche (uniquement pour les siens en attente)
  received_at: string | null
}
export interface PortalData {
  officer: PortalOfficer
  pending: PortalVehicle[]      // les siens, réquisitoire manquant
  received: PortalVehicle[]     // les siens, réquisitoire reçu (encore en parc)
  unassigned: PortalVehicle[]   // saisies en parc sans policier lié (sa zone d'abord)
}

const SELECT = 'id, mission_number, vehicle_plate, vehicle_brand, vehicle_model, incident_address, created_at, saisie_motif_label, police_pv_number, police_zone, officer_name, officer_partner_id, requisitoire_at, requisitoire_token, requisitoire_stop'

const toVehicle = (m: any, token: string | null): PortalVehicle => ({
  id: m.id, ref: m.mission_number != null ? `SAI-${m.mission_number}` : null,
  plate: m.vehicle_plate || null, vehicle: [m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ') || null,
  location: m.incident_address || null, saisie_at: m.created_at || null, motif: m.saisie_motif_label || null,
  pv: m.police_pv_number || null, zone: m.police_zone || null, officer_name: m.officer_name || null,
  token, received_at: m.requisitoire_at || null,
})

export async function loadOfficerPortal(partnerId: number): Promise<PortalData | null> {
  const officer = await getPortalOfficer(partnerId)
  if (!officer) return null
  const sb = createAdminClient()
  const sources = await sourcesWithTag('requisitoire')
  const base = () => sb.from('incoming_missions').select(SELECT).in('source', sources).in('status', PARC_STATUSES).eq('dossier_leg', false)

  const [{ data: mine }, { data: free }] = await Promise.all([
    base().eq('officer_partner_id', partnerId).order('created_at', { ascending: true }).limit(200),
    base().is('officer_partner_id', null).is('requisitoire_at', null).order('created_at', { ascending: false }).limit(200),
  ])

  const pending: PortalVehicle[] = []
  for (const m of (mine || []).filter((m: any) => !m.requisitoire_at)) {
    // Jeton de dépôt garanti — quelques fiches par policier, jamais 200 UPDATE.
    pending.push(toVehicle(m, m.requisitoire_token || await ensureDepotToken(m.id)))
  }
  const received = (mine || []).filter((m: any) => !!m.requisitoire_at).map((m: any) => toVehicle(m, null)).reverse()
  const unassigned = (free || []).map((m: any) => toVehicle(m, null))
    .sort((a, b) => Number(!!b.zone && b.zone === officer.zone) - Number(!!a.zone && a.zone === officer.zone))

  return { officer, pending, received, unassigned }
}

// ── « C'est mon dossier » : le policier s'attribue une saisie sans policier ──
export async function claimMission(partnerId: number, missionId: string): Promise<{ ok: true; token: string | null } | { ok: false; error: string }> {
  const officer = await getPortalOfficer(partnerId)
  if (!officer) return { ok: false, error: 'Policier inconnu' }
  const sb = createAdminClient()
  const sources = await sourcesWithTag('requisitoire')
  const { data: m } = await sb.from('incoming_missions').select('id, mission_number, vehicle_plate, officer_partner_id, officer_name, source, status').eq('id', missionId).maybeSingle()
  if (!m || !sources.includes(m.source) || !PARC_STATUSES.includes(m.status)) return { ok: false, error: 'Dossier introuvable ou déjà sorti' }
  if (m.officer_partner_id && m.officer_partner_id !== partnerId) return { ok: false, error: 'Ce dossier est déjà attribué à un autre policier' }

  const previous = m.officer_name || null
  const { error } = await sb.from('incoming_missions')
    .update({ officer_partner_id: partnerId, officer_name: officer.name, updated_at: new Date().toISOString() })
    .eq('id', missionId)
  if (error) return { ok: false, error: error.message }

  const ref = m.mission_number != null ? `SAI-${m.mission_number}` : missionId.slice(0, 8)
  await sb.from('mission_logs').insert({
    mission_id: missionId, action: 'officer_claimed_portal',
    notes: `Le policier ${officer.name}${officer.zone ? ` (${officer.zone})` : ''} s'est attribué ce dossier via le portail.${previous ? ` Nom saisi par le chauffeur : « ${previous} ».` : ''}`,
    metadata: { partner_id: partnerId, email: officer.email, previous_officer_name: previous },
  }).then(() => {}, () => {})
  await sb.from('mission_remarks').insert({
    mission_id: missionId, created_by: null,
    text: `🚔 ${officer.name}${officer.zone ? ` (${officer.zone})` : ''} s'est attribué ce dossier via le portail policier${previous ? ` — nom saisi à l'enlèvement : « ${previous} »` : ''}.`,
  }).then(() => {}, () => {})
  await sendNotificationToRoles(['admin', 'superadmin'], 'requisitoire_claim', {
    title: `🚔 ${m.vehicle_plate || ref} : policier identifié`,
    body:  `${officer.name}${officer.zone ? ` (${officer.zone})` : ''} s'est attribué la saisie via le portail.`,
    action_url: `/dispatch/${missionId}`, mission_id: missionId,
  }).catch(() => {})

  return { ok: true, token: await ensureDepotToken(missionId) }
}

// ── Un seul mail par policier : ses véhicules en attente + bouton portail ─────
const fmtDate = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
const esc = (s: string | null | undefined) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

function buildPortalHtml(d: PortalData, link: string): string {
  const rows = d.pending.map(v => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #eef1f5;font-weight:700;color:#111;font-family:monospace;">${esc(v.plate) || '—'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eef1f5;color:#333;">${esc(v.vehicle) || '—'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eef1f5;color:#333;white-space:nowrap;">${fmtDate(v.saisie_at)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eef1f5;color:#666;">${esc(v.pv) || '—'}</td>
    </tr>`).join('')
  const n = d.pending.length
  const content = `
    <p style="margin:0 0 4px;font-size:22px;font-weight:700;color:#111;">${n} réquisitoire${n > 1 ? 's' : ''} non reçu${n > 1 ? 's' : ''}</p>
    <p style="margin:0 0 20px;font-size:14px;color:#888;">${esc(d.officer.name)}${d.officer.zone ? ` · ${esc(d.officer.zone)}` : ''}</p>
    <p style="margin:0 0 16px;font-size:14px;color:#333;line-height:1.6;">
      Madame, Monsieur,<br><br>
      Les véhicules ci-dessous ont été enlevés et placés en fourrière à la suite d'une saisie.
      Sauf erreur de notre part, le <strong>réquisitoire</strong> correspondant ne nous est pas encore parvenu.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;">
      <tr style="background:#f8fafc;color:#64748b;font-size:12px;">
        <th align="left" style="padding:8px 10px;">Plaque</th><th align="left" style="padding:8px 10px;">Véhicule</th>
        <th align="left" style="padding:8px 10px;">Saisie</th><th align="left" style="padding:8px 10px;">N° PV</th>
      </tr>${rows}
    </table>
    ${divider()}
    <p style="margin:0 0 20px;font-size:14px;color:#333;line-height:1.6;">
      Votre espace personnel vous permet de déposer chaque réquisitoire en quelques secondes (PDF ou photo),
      de voir ceux que nous avons déjà reçus, et de vous attribuer une saisie pour laquelle le policier n'a pas été identifié.
    </p>
    <p style="margin:0 0 24px;text-align:center;">${button(link, 'Ouvrir mon espace')}</p>
    <p style="margin:0 0 20px;font-size:13px;color:#666;line-height:1.6;">
      Ce lien vous est personnel — merci de ne pas le transmettre. Vous pouvez aussi répondre à cet e-mail en joignant le réquisitoire (PDF).
    </p>
    <p style="margin:24px 0 0;font-size:13px;color:#888;">Nous vous remercions par avance de votre collaboration.<br>Le service Fourrière — Verviers Dépannage</p>
  `
  return emailLayout(content, `Réquisitoires — ${d.officer.name}`)
}

export interface PortalMailResult { ok: boolean; error?: string; email?: string; count?: number }

export async function sendOfficerPortalMail(partnerId: number): Promise<PortalMailResult> {
  const d = await loadOfficerPortal(partnerId)
  if (!d) return { ok: false, error: 'Policier inconnu' }
  if (!d.officer.email) return { ok: false, error: "Email du policier inconnu (compléter le contact Odoo)" }
  const targets = d.pending.filter(v => v.received_at == null)
  if (!targets.length) return { ok: false, error: 'Aucun réquisitoire en attente pour ce policier' }

  const link = portalLink(partnerId)
  const subject = targets.length === 1
    ? `Réquisitoire non reçu — ${targets[0].plate || 'véhicule'} — réf ${targets[0].ref || ''}`.trim()
    : `${targets.length} réquisitoires non reçus — véhicules saisis en fourrière`
  try {
    await sendEmail(d.officer.email, subject, buildPortalHtml({ ...d, pending: targets }, link), d.officer.name, undefined, undefined, FOURRIERE_FROM)
  } catch (e: any) {
    return { ok: false, error: `Envoi impossible : ${e?.message || e}` }
  }

  const sb = createAdminClient()
  const now = new Date().toISOString()
  for (const v of targets) {
    const { data: cur } = await sb.from('incoming_missions').select('requisitoire_reminder_count').eq('id', v.id).maybeSingle()
    const count = (cur?.requisitoire_reminder_count || 0) + 1
    await sb.from('incoming_missions').update({ requisitoire_last_reminder_at: now, requisitoire_reminder_count: count }).eq('id', v.id)
    await sb.from('mission_logs').insert({
      mission_id: v.id, action: 'requisitoire_relance',
      notes: `Relance réquisitoire n°${count} envoyée à ${d.officer.email} (mail groupé portail, ${targets.length} véhicule(s)).`,
      metadata: { email: d.officer.email, ref: v.ref, portal: true, count: targets.length },
    }).then(() => {}, () => {})
  }
  return { ok: true, email: d.officer.email, count: targets.length }
}
