// src/lib/facturation/paiements.ts
//
// Facturation — temps 3 « Le paiement » (Olivier 16-21/09/2026, artefact
// HunVFDnNSQSBiK9VMhmJdu). Deux robots, appelés par le cron
// /api/cron/facturation-paiements :
//
//   1. syncInvoicePayments : pour chaque fiche facturée (n° ou id de facture)
//      pas encore marquée payée, lit dans Odoo `payment_state` /
//      `amount_residual` de la facture et pose `paid_at` + `payment_state_odoo`
//      sur TOUTES les fiches qui portent cette facture (racine, volets
//      gardiennage, relivraison). Journal mission_logs `invoice_paid`.
//      L'encaissement bureau se fait dans Odoo ; ici on ne fait que LIRE.
//
//   2. sendInvoiceReminders : facture postée, non payée, échéance dépassée →
//      J+15 une relance courtoise, J+30 une seconde plus ferme, au client
//      facturé (mail du res.partner de la facture). Une seule fois par niveau
//      et par facture (`reminder_15_at` / `reminder_30_at`), journal
//      mission_logs `invoice_reminder` {level}, ligne dans invoice_reminders
//      (historique du module Relances clients, /relances).
//      JAMAIS vers le Parquet / SPF (frais de justice, Domaine) ni vers les
//      assisteurs qui ont leur propre circuit (Touring COMEX, Allianz/Mondial
//      Hexalite, Kaze/IMA, VAB, AXA) : seulement les clients privés, les
//      garages et les sources sans plateforme. Le lien assisteur fait foi
//      (kaze_job_id, axa_mission_order_id, vab_assignment_ids,
//      touring_accepted_at), pas seulement la source.
//
// Réglages (app_settings, registre business-registry.ts, groupe Facturation) :
//   relance_facture_j1_jours (15) · relance_facture_j2_jours (30) ·
//   relance_facture_mode ('off' = lecture des paiements seule, 'on' = mails).

import { odooRpc }                      from '@/lib/odoo'
import { sendEmail, FROM_EMAIL, emailLayout, infoRow, badge, divider } from '@/lib/emails'
import { formatEur }                    from '@/lib/format'
import { COMPANY }                      from '@/config/company'
import { getBusinessNumber, getBusinessText } from '@/lib/settings/business'
import { listSourceCatalog }            from '@/lib/missions/source-catalog'
import { RELANCE_EXCLUDED_TAG_NAME }    from '@/lib/relances/constants'
import { fetchInvoicePdfFromOdoo }      from '@/lib/relances/odoo'
import { invalidateDossierCache }       from '@/lib/dossier/build'

export type ReminderLevel = 15 | 30

/** États Odoo qui valent « soldée » pour nous (in_payment = paiement enregistré, rapprochement bancaire à suivre). */
const PAID_STATES = new Set(['paid', 'in_payment'])
/** Familles de sources dont le règlement passe par la plateforme de l'assisteur ou par l'État. */
const NO_REMINDER_TAGS = ['hexalite', 'touring', 'integration', 'cloture_externe', 'saisie_scope'] as const
/** Partenaires Odoo « institutionnels » (réglages métier) : jamais relancés par ce robot. */
const NO_REMINDER_PARTNER_KEYS = ['odoo_partner_frais_justice', 'odoo_partner_spf_finances', 'odoo_partner_touring', 'odoo_partner_anwb']
const MAX_REMINDERS_PER_RUN = 25       // garde-fou : pas de rafale au premier passage
const MIN_DAYS_BETWEEN_LEVELS = 7      // J+30 au plus tôt 7 j après le J+15
const LOOKBACK_DAYS = 400              // fiches facturées depuis moins de ~13 mois

const MISSION_COLS = 'id, parent_mission_id, dossier_leg, external_id, mission_number, vehicle_plate, source, status, invoice_method, invoice_number, invoice_odoo_id, invoiced_at, paid_at, payment_state_odoo, reminder_15_at, reminder_30_at, billed_to_id, billed_to_name, client_name, kaze_job_id, axa_mission_order_id, vab_assignment_ids, touring_accepted_at'

interface OdooMove {
  id: number; name: string; state: string; move_type: string
  payment_state: string | null; amount_residual: number; amount_total: number
  invoice_date: string | null; invoice_date_due: string | null
  partner_id: [number, string] | false; payment_reference: string | false
}

const chunk = <T,>(arr: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }
const daysBetween = (fromISO: string, to: Date) => Math.floor((to.getTime() - new Date(fromISO).getTime()) / 86_400_000)
const fmtDateFr = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
const isPostedInvoice = (mv: OdooMove | undefined): mv is OdooMove => !!mv && mv.state === 'posted' && mv.move_type === 'out_invoice' && !!mv.name && mv.name !== '/'

/** Fiches facturées (n° ou id Odoo) pas encore soldées, les plus récentes d'abord. */
async function loadOpenInvoicedMissions(sb: any, limit = 600): Promise<any[]> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString()
  const { data, error } = await sb.from('incoming_missions')
    .select(MISSION_COLS)
    .is('paid_at', null)
    .or('invoice_odoo_id.not.is.null,invoice_number.not.is.null')
    .gte('invoiced_at', since)
    .order('invoiced_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`Fiches facturées illisibles : ${error.message}`)
  // Un n° « brouillon Odoo #… » ou « auto-facturation » n'est pas une facture Odoo.
  return (data || []).filter((m: any) => m.invoice_odoo_id || /^[A-Z0-9/\-.]{4,}$/i.test(String(m.invoice_number || '').trim()))
}

/** Lit les factures Odoo par id et par numéro, en une passe par lot de 200. */
async function readMoves(missions: any[]): Promise<{ byId: Map<number, OdooMove>; byName: Map<string, OdooMove> }> {
  const ids = Array.from(new Set(missions.map(m => Number(m.invoice_odoo_id)).filter(n => Number.isFinite(n) && n > 0)))
  const names = Array.from(new Set(missions.filter(m => !m.invoice_odoo_id && m.invoice_number).map(m => String(m.invoice_number).trim())))
  const fields = ['id', 'name', 'state', 'move_type', 'payment_state', 'amount_residual', 'amount_total', 'invoice_date', 'invoice_date_due', 'partner_id', 'payment_reference']
  const byId = new Map<number, OdooMove>(); const byName = new Map<string, OdooMove>()
  const keep = (mv: OdooMove) => { byId.set(mv.id, mv); if (mv.name) byName.set(String(mv.name).trim(), mv) }
  for (const part of chunk(ids, 200)) {
    const moves = await odooRpc<OdooMove[]>('account.move', 'search_read', [[['id', 'in', part]]], { fields, limit: part.length })
    for (const mv of moves || []) keep(mv)
  }
  for (const part of chunk(names, 200)) {
    const moves = await odooRpc<OdooMove[]>('account.move', 'search_read', [[['name', 'in', part], ['move_type', '=', 'out_invoice']]], { fields, limit: part.length })
    for (const mv of moves || []) keep(mv)
  }
  return { byId, byName }
}

const moveOf = (m: any, idx: { byId: Map<number, OdooMove>; byName: Map<string, OdooMove> }): OdooMove | undefined =>
  (m.invoice_odoo_id && idx.byId.get(Number(m.invoice_odoo_id))) || (m.invoice_number && idx.byName.get(String(m.invoice_number).trim())) || undefined

// ─────────────────────────────────────────────────────────────────────────────
// 1. Statut « payée » lu dans Odoo → fiche payée
// ─────────────────────────────────────────────────────────────────────────────
export interface PaymentSyncSummary { scanned: number; paid: number; updated_states: number; missing: number; paid_refs: string[]; errors: string[] }

export async function syncInvoicePayments(sb: any): Promise<PaymentSyncSummary> {
  const out: PaymentSyncSummary = { scanned: 0, paid: 0, updated_states: 0, missing: 0, paid_refs: [], errors: [] }
  const missions = await loadOpenInvoicedMissions(sb)
  out.scanned = missions.length
  if (!missions.length) return out
  const idx = await readMoves(missions)
  const now = new Date().toISOString()
  const paidMoves = new Set<number>()

  for (const m of missions) {
    const mv = moveOf(m, idx)
    if (!mv) { out.missing++; continue }
    if (!isPostedInvoice(mv)) continue
    const state = mv.payment_state || null
    const paid = !!state && PAID_STATES.has(state)
    try {
      if (paid) {
        // Toutes les fiches qui portent cette facture passent payées d'un coup
        // (racine + volets + REL facturés sur le même n°) ; log une fois par fiche.
        if (paidMoves.has(mv.id)) continue
        paidMoves.add(mv.id)
        const { data: rows } = await sb.from('incoming_missions')
          .update({ paid_at: now, payment_state_odoo: state, updated_at: now })
          .is('paid_at', null)
          .or(`invoice_odoo_id.eq.${mv.id},invoice_number.eq."${String(mv.name).replace(/["\\,()]/g, '')}"`)   // valeur entre guillemets : le n° contient des « / »
          .select('id, parent_mission_id')
        for (const r of rows || []) {
          await sb.from('mission_logs').insert({
            mission_id: r.id, actor_id: null, action: 'invoice_paid',
            notes: `Facture ${mv.name} soldée dans Odoo (${state === 'in_payment' ? 'paiement enregistré' : 'payée'}) — ${formatEur(Number(mv.amount_total || 0))}`,
            metadata: { invoice_number: mv.name, invoice_odoo_id: mv.id, payment_state: state, amount_total: mv.amount_total },
          }).then(() => {}, () => {})
          invalidateDossierCache(r.parent_mission_id || r.id)
        }
        out.paid += (rows || []).length
        out.paid_refs.push(mv.name)
      } else if (state && state !== m.payment_state_odoo) {
        // Partiel / non payé / extourné : on mémorise l'état lu (visible sur la carte).
        await sb.from('incoming_missions').update({ payment_state_odoo: state, ...(m.invoice_odoo_id ? {} : { invoice_odoo_id: mv.id }) }).eq('id', m.id)
        out.updated_states++
      }
    } catch (e: any) { out.errors.push(`${m.external_id || m.id} : ${e?.message || e}`) }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Relances J+15 / J+30 au client facturé
// ─────────────────────────────────────────────────────────────────────────────
export interface ReminderSummary { mode: string; candidates: number; sent: number; skipped: Record<string, number>; sent_refs: string[]; errors: string[] }

interface ReminderTexts { subject: string; title: string; intro: string; closing: string; accent: string; badge: string }
function textsFor(level: ReminderLevel, invoice: string, due: number): ReminderTexts {
  return level === 15
    ? {
        subject: `Rappel — facture ${invoice} (${formatEur(due)})`,
        title: 'Rappel de paiement', badge: 'Premier rappel', accent: '#1F75D9',
        intro: `Sauf erreur de notre part, la facture ${invoice} reprise ci-dessous, dont la date d'échéance est dépassée, reste impayée à ce jour. Nous vous remercions de bien vouloir procéder à son règlement dans les meilleurs délais.`,
        closing: `Si ce paiement a été effectué entre-temps, nous vous prions de ne pas tenir compte de ce message. Pour toute question sur cette intervention, notre équipe reste à votre disposition.`,
      }
    : {
        subject: `Second rappel — facture ${invoice} (${formatEur(due)})`,
        title: 'Second rappel de paiement', badge: 'Second rappel', accent: '#D97706',
        intro: `Malgré notre précédent rappel, la facture ${invoice} reprise ci-dessous reste impayée. Nous vous prions de procéder à son règlement sous huit jours à compter de la présente. À défaut, le dossier suivra la procédure prévue par nos conditions générales de vente.`,
        closing: `Si ce paiement a été effectué entre-temps, nous vous prions de ne pas tenir compte de ce message.`,
      }
}

function esc(s: string) { return s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]!)) }

/** Corps du mail : même bandeau, mêmes helpers que les autres mails VD (emails.ts). */
export function buildInvoiceReminderHtml(p: { level: ReminderLevel; partnerName: string; invoice: string; invoiceDate: string | null; dueDate: string | null; total: number; residual: number; reference: string; plate: string | null; ref: string | null }): string {
  const t = textsFor(p.level, p.invoice, p.residual)
  const content = `
    <p style="margin:0 0 6px;font-size:13px;color:#888;">Madame, Monsieur,</p>
    <p style="margin:0 0 18px;font-size:22px;font-weight:700;color:#111;line-height:1.25;">${esc(t.title)}</p>
    <div style="margin-bottom:20px;">${badge(t.accent, t.badge)}</div>
    <p style="margin:0 0 20px;font-size:14px;color:#333;line-height:1.6;text-align:justify;">${esc(t.intro)}</p>
    <div style="background:#f8f8f8;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${infoRow('Facture', `<strong>${esc(p.invoice)}</strong>`)}
        ${infoRow('Date', esc(fmtDateFr(p.invoiceDate)))}
        ${infoRow('Échéance', esc(fmtDateFr(p.dueDate)))}
        ${infoRow('Client', `<strong>${esc(p.partnerName)}</strong>`)}
        ${p.plate ? infoRow('Véhicule', esc(p.plate)) : ''}
        ${p.ref ? infoRow('Notre référence', esc(p.ref)) : ''}
        ${p.residual < p.total - 0.005 ? infoRow('Montant de la facture', esc(formatEur(p.total))) : ''}
      </table>
    </div>
    <div style="background:${t.accent}10;border:1px solid ${t.accent}40;border-radius:10px;padding:16px 20px;margin-bottom:20px;text-align:center;">
      <p style="margin:0 0 4px;font-size:11px;color:#666;letter-spacing:0.5px;text-transform:uppercase;">Reste à régler</p>
      <p style="margin:0;font-size:28px;font-weight:800;color:${t.accent};letter-spacing:-0.5px;">${formatEur(p.residual)}</p>
    </div>
    ${divider()}
    <p style="margin:0 0 8px;font-size:13px;color:#888;letter-spacing:0.5px;text-transform:uppercase;font-weight:600;">Modalités de paiement</p>
    <p style="margin:0 0 6px;font-size:14px;color:#333;line-height:1.6;">Veuillez verser <strong>${formatEur(p.residual)}</strong> sur le compte :</p>
    <p style="margin:0 0 6px;font-size:18px;font-weight:700;color:#111;font-family:'Menlo','Monaco',monospace;">${esc(COMPANY.iban)}</p>
    <p style="margin:0 0 24px;font-size:13px;color:#666;">Communication : <strong>${esc(p.reference)}</strong></p>
    <p style="margin:0 0 20px;font-size:14px;color:#333;line-height:1.6;text-align:justify;">${esc(t.closing)}</p>
    <p style="margin:24px 0 0;font-size:13px;color:#666;line-height:1.6;">📎 La facture est jointe à ce message.</p>
    <p style="margin:32px 0 4px;font-size:13px;color:#666;">Cordialement,</p>
    <p style="margin:0;font-size:14px;font-weight:700;color:#111;">Le service Facturation</p>
    <p style="margin:0;font-size:13px;color:#888;">${esc(COMPANY.name)} · ${esc(COMPANY.phone)}</p>
  `
  return emailLayout(content, t.title)
}

export async function sendInvoiceReminders(sb: any): Promise<ReminderSummary> {
  const out: ReminderSummary = { mode: 'off', candidates: 0, sent: 0, skipped: {}, sent_refs: [], errors: [] }
  const skip = (why: string) => { out.skipped[why] = (out.skipped[why] || 0) + 1 }
  const mode = (await getBusinessText('relance_facture_mode').catch(() => 'off')).toLowerCase()
  out.mode = mode
  const J1 = await getBusinessNumber('relance_facture_j1_jours')
  const J2 = await getBusinessNumber('relance_facture_j2_jours')

  // Sources exclues (familles du catalogue) + partenaires institutionnels (réglages).
  const catalog = await listSourceCatalog()
  const noReminderSources = new Set(catalog.filter(r => r.tags.some(t => (NO_REMINDER_TAGS as readonly string[]).includes(t))).map(r => r.key.toLowerCase()))
  const noReminderPartners = new Set<number>()
  for (const k of NO_REMINDER_PARTNER_KEYS) { try { noReminderPartners.add(await getBusinessNumber(k)) } catch { /* réglage absent : pas d'exclusion sur cet id */ } }

  const missions = await loadOpenInvoicedMissions(sb)
  if (!missions.length) return out
  const idx = await readMoves(missions)
  const today = new Date()

  // Une relance par FACTURE (pas par fiche) : on regroupe les fiches sur la facture.
  const byMove = new Map<number, { mv: OdooMove; fiches: any[] }>()
  for (const m of missions) {
    const mv = moveOf(m, idx)
    if (!isPostedInvoice(mv)) continue
    const e = byMove.get(mv.id) || { mv, fiches: [] }
    e.fiches.push(m); byMove.set(mv.id, e)
  }

  type Job = { mv: OdooMove; fiches: any[]; level: ReminderLevel; lead: any }
  const jobs: Job[] = []
  for (const { mv, fiches } of byMove.values()) {
    const state = mv.payment_state || 'not_paid'
    if (PAID_STATES.has(state) || state === 'reversed') continue
    if (!(Number(mv.amount_residual) > 0)) continue
    if (!mv.invoice_date_due) { skip('sans_echeance'); continue }
    const overdue = daysBetween(mv.invoice_date_due, today)
    if (overdue < J1) continue
    out.candidates++
    // Fiche « meneuse » : la racine si elle porte la facture, sinon la première.
    const lead = fiches.find(f => !f.dossier_leg && !f.parent_mission_id) || fiches[0]
    // Le lien assisteur fait foi : une fiche rattachée à une plateforme n'est jamais relancée d'ici.
    if (fiches.some(f => f.kaze_job_id || f.axa_mission_order_id || f.vab_assignment_ids || f.touring_accepted_at)) { skip('assisteur_lien'); continue }
    if (fiches.some(f => noReminderSources.has(String(f.source || '').toLowerCase()))) { skip('assisteur_source'); continue }
    if (fiches.some(f => /parquet|frais de justice|fdj\b|spf|domaine/i.test(String(f.billed_to_name || '')))) { skip('parquet_domaine'); continue }
    const partnerId = Array.isArray(mv.partner_id) ? mv.partner_id[0] : null
    if (!partnerId) { skip('sans_partenaire'); continue }
    if (noReminderPartners.has(partnerId)) { skip('partenaire_institutionnel'); continue }
    const r15 = fiches.map(f => f.reminder_15_at).filter(Boolean).sort()[0] || null
    const r30 = fiches.map(f => f.reminder_30_at).filter(Boolean).sort()[0] || null
    let level: ReminderLevel | null = null
    if (!r15) level = 15
    else if (!r30 && overdue >= J2 && daysBetween(r15, today) >= MIN_DAYS_BETWEEN_LEVELS) level = 30
    if (!level) continue
    jobs.push({ mv, fiches, level, lead })
  }
  if (!jobs.length) return out
  if (mode !== 'on') { skip('mode_off'); out.skipped.mode_off = jobs.length; return out }

  // Partenaires : mail + tag « Exclure relances » (même règle que /relances).
  const partnerIds = Array.from(new Set(jobs.map(j => (j.mv.partner_id as [number, string])[0])))
  const partners = new Map<number, { name: string; email: string | null; excluded: boolean }>()
  const rows = await odooRpc<any[]>('res.partner', 'read', [partnerIds], { fields: ['id', 'name', 'email', 'category_id'] })
  const catIds = Array.from(new Set((rows || []).flatMap(r => r.category_id || [])))
  const excludedCats = new Set<number>()
  if (catIds.length) {
    const cats = await odooRpc<any[]>('res.partner.category', 'read', [catIds], { fields: ['id', 'name'] })
    for (const c of cats || []) if (String(c.name || '').toLowerCase() === RELANCE_EXCLUDED_TAG_NAME.toLowerCase()) excludedCats.add(c.id)
  }
  for (const r of rows || []) partners.set(r.id, { name: r.name, email: r.email && String(r.email).includes('@') ? String(r.email).trim() : null, excluded: (r.category_id || []).some((c: number) => excludedCats.has(c)) })

  let sentThisRun = 0
  const nowISO = new Date().toISOString()
  for (const job of jobs) {
    if (sentThisRun >= MAX_REMINDERS_PER_RUN) { skip('plafond_par_passage'); continue }
    const partnerId = (job.mv.partner_id as [number, string])[0]
    const p = partners.get(partnerId)
    if (!p) { skip('sans_partenaire'); continue }
    if (p.excluded) { skip('tag_exclure_relances'); continue }
    if (!p.email) { skip('sans_email'); continue }
    // Anti-doublon avec le module Relances clients (envoi manuel groupé récent sur cette facture).
    const { data: recent } = await sb.from('invoice_reminders').select('id')
      .contains('invoice_ids_odoo', [job.mv.id]).eq('dry_run', false)
      .gte('sent_at', new Date(Date.now() - 10 * 86_400_000).toISOString()).limit(1)
    if ((recent || []).length) { skip('relance_manuelle_recente'); continue }

    const residual = Number(job.mv.amount_residual || 0)
    const reference = (job.mv.payment_reference && String(job.mv.payment_reference)) || job.mv.name
    const html = buildInvoiceReminderHtml({
      level: job.level, partnerName: p.name, invoice: job.mv.name, invoiceDate: job.mv.invoice_date, dueDate: job.mv.invoice_date_due,
      total: Number(job.mv.amount_total || 0), residual, reference, plate: job.lead?.vehicle_plate || null,
      ref: job.lead?.mission_number != null ? `#${job.lead.mission_number}` : (job.lead?.external_id || null),
    })
    const { subject } = textsFor(job.level, job.mv.name, residual)
    // PDF de la facture en pièce jointe — best-effort (mail envoyé même sans).
    let attachments: { name: string; contentType: string; contentBytes: string }[] | undefined
    try { const pdf = await fetchInvoicePdfFromOdoo(job.mv.id); attachments = [{ name: `${job.mv.name.replace(/\//g, '-')}.pdf`, contentType: 'application/pdf', contentBytes: pdf.toString('base64') }] } catch { /* sans PJ */ }

    try {
      await sendEmail(p.email, subject, html, p.name, undefined, attachments, FROM_EMAIL)
    } catch (e: any) { out.errors.push(`${job.mv.name} → ${p.email} : ${e?.message || e}`); continue }
    sentThisRun++
    out.sent++; out.sent_refs.push(`${job.mv.name} L${job.level}`)

    const col = job.level === 15 ? 'reminder_15_at' : 'reminder_30_at'
    await sb.from('incoming_missions').update({ [col]: nowISO, payment_state_odoo: job.mv.payment_state || null }).in('id', job.fiches.map(f => f.id))
    for (const f of job.fiches) {
      await sb.from('mission_logs').insert({
        mission_id: f.id, actor_id: null, action: 'invoice_reminder',
        notes: `Relance J+${job.level} envoyée à ${p.name} (${p.email}) — facture ${job.mv.name}, reste ${formatEur(residual)}`,
        metadata: { level: job.level, invoice_number: job.mv.name, invoice_odoo_id: job.mv.id, to: p.email, residual, due: job.mv.invoice_date_due },
      }).then(() => {}, () => {})
      invalidateDossierCache(f.parent_mission_id || f.id)
    }
    // Historique du module Relances clients (/relances) : niveau 1 = courtois, 2 = ferme.
    await sb.from('invoice_reminders').insert({
      partner_id_odoo: partnerId, partner_name: p.name, level: job.level === 15 ? 1 : 2, sent_by_user_id: null,
      email_to: p.email, invoice_count: 1, total_amount: residual, invoice_ids_odoo: [job.mv.id], dry_run: false,
    }).then(() => {}, (e: any) => out.errors.push(`historique relances ${job.mv.name} : ${e?.message || e}`))
  }
  return out
}
