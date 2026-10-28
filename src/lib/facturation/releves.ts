// src/lib/facturation/releves.ts — « Relevé des dossiers ouverts » des assistances habituelles (Olivier 28/10/2026,
// maquette https://claude.ai/artifact/F1DZojG1RjQxDVs9xtuV7w validée).
//
// Pas un « rappel de paiement » : un relevé courtois, toujours le même ton, UN MERCREDI SUR DEUX (premier envoi le
// mercredi 28/10/2026), groupé par assistance.
// Le mail liste chaque facture ouverte (notre n°, leur n° de dossier, plaque, date d'intervention, reste dû) et donne
// un lien personnel (90 jours, sans compte) vers /releve/<jeton> où chaque facture se télécharge (PDF, ZIP, Excel).
// Seules les factures échues y figurent ; sans facture échue, pas de relevé. Assistances : réglage releve_assistances_partner_ids
// (Touring, Ethias, Allianz-AP Solutions, VAB, AXA-IPA, P&V, AWP, IMA, ANWB, Eurocross, ACL). RES, Europ Assistance
// et les clients suivent les rappels classiques (paiements.ts). Jamais le Parquet.
// Envoi : réglage releve_assistances_mode (off / on) ET bloc « Relances clients » de « Mes assistants ».

import { randomBytes } from 'crypto'
import { odooRpc } from '@/lib/odoo'
import { createAdminClient } from '@/lib/supabase'
import { sendEmail, FROM_EMAIL, emailLayout } from '@/lib/emails'
import { formatEur } from '@/lib/format'
import { COMPANY } from '@/config/company'
import { getBusinessList, getBusinessNumber, getBusinessText } from '@/lib/settings/business'

const VALIDITE_JOURS = 90

export interface LigneReleve { id: number; facture: string; dossier: string | null; plaque: string | null; date: string | null; prestation: string | null; echeance: string | null; retard: number; montant: number; reste: number }
export interface Releve { partnerId: number; partner: string; email: string | null; lignes: LigneReleve[]; total: number; echues: number }

const jour = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
const jours = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
const fr = (d: string | null) => d ? d.split('-').reverse().join('/') : ''
const esc = (s: string) => s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]!))
const PRESTATION: Record<string, string> = { remorquage: 'Remorquage', depannage: 'Dépannage sur place', transport: 'Transport', relivraison: 'Relivraison', 'REM+REL': 'Remorquage + relivraison', gardiennage: 'Gardiennage' }

export async function assistancesDuReleve(): Promise<number[]> {
  return (await getBusinessList('releve_assistances_partner_ids').catch(() => [] as string[])).map(Number).filter(n => n > 0)
}

/** Adresse de facturation de l'assistance : contact « facturation » s'il existe, sinon la fiche elle-même. */
async function adresseFacturation(partnerId: number): Promise<string | null> {
  const ps: any[] = await odooRpc('res.partner', 'search_read', [['|', ['id', '=', partnerId], '&', ['parent_id', '=', partnerId], ['type', '=', 'invoice']]], { fields: ['id', 'type', 'email'] })
  const ok = (e: any) => { const v = String(e || '').trim(); return v.includes('@') && !/^exemple@|@verviersdepannage\.(be|com)$/i.test(v) ? v : null }
  return ok(ps.find(p => p.type === 'invoice')?.email) || ok(ps.find(p => p.id === partnerId)?.email)
}

/** Factures ouvertes d'une assistance, enrichies de la plaque et de l'intervention (fiche VD Soft). */
export async function releveDe(partnerId: number): Promise<Releve> {
  const auj = jour()
  // Seulement les factures ÉCHUES (Olivier 28/10/2026 : « on ne prend que les échues »), dans le mail comme sur la page,
  // et émises depuis 2026 (avant : payées à l'époque sans lettrage possible, même règle que les rappels clients).
  const inv: any[] = await odooRpc('account.move', 'search_read', [[['move_type', '=', 'out_invoice'], ['state', '=', 'posted'], ['payment_state', 'in', ['not_paid', 'partial']], ['commercial_partner_id', '=', partnerId], ['amount_residual', '>', 0], ['invoice_date_due', '<', auj], ['invoice_date', '>=', '2026-01-01']]], { fields: ['id', 'name', 'ref', 'invoice_date', 'invoice_date_due', 'amount_total', 'amount_residual', 'commercial_partner_id', 'x_studio_plaque_1'], order: 'invoice_date_due asc, id asc', limit: 2000 })
  // Factures annoncées dans un avis de paiement pas encore arrivé à la banque (IMA, ANWB… Olivier 28/10/2026) : retirées
  // du relevé pendant 15 jours. Réglage releve_factures_annoncees = { "<n° facture>": "<date de l'avis>" }.
  const annoncees = await facturesAnnoncees()
  for (let i = inv.length - 1; i >= 0; i--) if (annoncees.has(inv[i].name)) inv.splice(i, 1)
  const [p]: any[] = await odooRpc('res.partner', 'read', [[partnerId]], { fields: ['name'] })
  const fiches = new Map<number, any>()
  if (inv.length) {
    const { data } = await createAdminClient().from('incoming_missions').select('invoice_odoo_id, vehicle_plate, intervention_date, mission_type, dossier_leg').in('invoice_odoo_id', inv.map(i => i.id))
    for (const m of data || []) if (!m.dossier_leg || !fiches.has(m.invoice_odoo_id)) fiches.set(m.invoice_odoo_id, m)
  }
  const lignes: LigneReleve[] = inv.map(i => {
    const f = fiches.get(i.id)
    const plaqueErp = Array.isArray(i.x_studio_plaque_1) ? String(i.x_studio_plaque_1[1] || '').split('/').pop()?.trim() : null
    return {
      id: i.id, facture: i.name, dossier: i.ref || null, plaque: f?.vehicle_plate || plaqueErp || null,
      date: f?.intervention_date ? String(f.intervention_date).slice(0, 10) : i.invoice_date, prestation: f ? (PRESTATION[f.mission_type] || null) : null,
      echeance: i.invoice_date_due || null, retard: i.invoice_date_due ? Math.max(0, jours(i.invoice_date_due, auj)) : 0,
      montant: Number(i.amount_total) || 0, reste: Number(i.amount_residual) || 0,
    }
  })
  return { partnerId, partner: p?.name || `#${partnerId}`, email: await adresseFacturation(partnerId), lignes, total: Math.round(lignes.reduce((s, l) => s + l.reste, 0) * 100) / 100, echues: lignes.filter(l => l.retard > 0).length }
}

/** Factures annoncées payées par un avis de paiement de moins de 15 jours. */
export async function facturesAnnoncees(): Promise<Set<string>> {
  const { data } = await createAdminClient().from('app_settings').select('value').eq('key', 'releve_factures_annoncees').maybeSingle()
  let v: Record<string, string> = {}
  try { v = typeof data?.value === 'string' ? JSON.parse(data.value) : (data?.value || {}) } catch { /* illisible */ }
  const limite = new Date(Date.now() - 15 * 86_400_000).toISOString().slice(0, 10)
  return new Set(Object.entries(v).filter(([, d]) => String(d) >= limite).map(([n]) => n))
}

/** Ajoute des factures annoncées par un avis de paiement (garde les autres, oublie celles de plus de 15 jours). */
export async function noterAvisDePaiement(factures: string[], dateAvis: string): Promise<void> {
  const sb = createAdminClient()
  const { data } = await sb.from('app_settings').select('value').eq('key', 'releve_factures_annoncees').maybeSingle()
  let v: Record<string, string> = {}
  try { v = typeof data?.value === 'string' ? JSON.parse(data.value) : (data?.value || {}) } catch { /* illisible */ }
  const limite = new Date(Date.now() - 15 * 86_400_000).toISOString().slice(0, 10)
  for (const k of Object.keys(v)) if (v[k] < limite) delete v[k]
  for (const f of factures) v[f] = dateAvis
  await sb.from('app_settings').upsert({ key: 'releve_factures_annoncees', value: JSON.stringify(v) }, { onConflict: 'key' })
}

export function lienReleve(token: string): string {
  return `${(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '').replace(/\/$/, '')}/releve/${token}`
}

export function mailReleve(r: Releve, lien: string, dateReleve: string, semaines = 2): { sujet: string; html: string } {
  const sujet = `Relevé des dossiers ouverts au ${fr(dateReleve)} — ${r.lignes.length} facture${r.lignes.length > 1 ? 's' : ''} · ${formatEur(r.total)} · ${COMPANY.name}`
  const rouge = '#CC2222'
  const lignes = r.lignes.map(l => `
    <tr>
      <td style="padding:9px 10px;border-top:1px solid #eee;font-size:13px;color:#141414;"><strong>${esc(l.facture)}</strong><br><span style="font-size:11px;color:#666;">échéance ${esc(fr(l.echeance))}</span></td>
      <td style="padding:9px 10px;border-top:1px solid #eee;font-size:13px;color:#141414;">${esc(l.dossier || '—')}</td>
      <td style="padding:9px 10px;border-top:1px solid #eee;font-size:12px;color:#141414;font-family:Menlo,Monaco,monospace;">${esc(l.plaque || '—')}</td>
      <td style="padding:9px 10px;border-top:1px solid #eee;font-size:13px;color:#141414;">${esc(fr(l.date))}</td>
      <td style="padding:9px 10px;border-top:1px solid #eee;font-size:13px;color:#141414;text-align:right;font-weight:700;">${esc(formatEur(l.reste))}</td>
    </tr>`).join('')
  const content = `
    <p style="margin:0 0 6px;font-size:13px;color:#666;">Madame, Monsieur,</p>
    <p style="margin:0 0 10px;font-size:22px;font-weight:800;color:#141414;">Relevé des dossiers ouverts</p>
    <p style="margin:0 0 18px;"><span style="display:inline-block;background:#FDECEC;color:#B71C1C;font-size:12px;font-weight:700;padding:4px 10px;border-radius:20px;">Relevé du ${esc(fr(dateReleve))}</span></p>
    <p style="margin:0 0 18px;font-size:14px;color:#333;line-height:1.6;">Veuillez trouver ci-dessous le relevé de nos dossiers dont la facture est en attente de règlement à ce jour. Nous vous remercions d'avance pour leur traitement. Chaque facture est consultable et téléchargeable en ligne, avec votre numéro de dossier et la plaque du véhicule.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e3e3e3;border-radius:8px;border-collapse:separate;margin-bottom:18px;">
      <tr style="background:#f5f5f5;">
        <td style="padding:8px 10px;font-size:11px;font-weight:700;color:#444;text-transform:uppercase;">Facture</td>
        <td style="padding:8px 10px;font-size:11px;font-weight:700;color:#444;text-transform:uppercase;">Votre dossier</td>
        <td style="padding:8px 10px;font-size:11px;font-weight:700;color:#444;text-transform:uppercase;">Véhicule</td>
        <td style="padding:8px 10px;font-size:11px;font-weight:700;color:#444;text-transform:uppercase;">Intervention</td>
        <td style="padding:8px 10px;font-size:11px;font-weight:700;color:#444;text-transform:uppercase;text-align:right;">Reste dû</td>
      </tr>
      ${lignes}
      <tr style="background:#fafafa;">
        <td colspan="4" style="padding:11px 10px;border-top:2px solid #e3e3e3;font-size:14px;font-weight:700;color:#141414;">Total en attente</td>
        <td style="padding:11px 10px;border-top:2px solid #e3e3e3;font-size:17px;font-weight:800;color:#B71C1C;text-align:right;">${esc(formatEur(r.total))}</td>
      </tr>
    </table>
    <p style="margin:0 0 6px;text-align:center;"><a href="${esc(lien)}" style="display:inline-block;background:${rouge};color:#fff;font-weight:700;font-size:15px;padding:13px 26px;border-radius:9px;text-decoration:none;">Voir et télécharger les factures</a></p>
    <p style="margin:0 0 22px;text-align:center;font-size:12px;color:#666;">Lien personnel valable ${VALIDITE_JOURS} jours, sans identifiant.</p>
    <p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:0.5px;">Modalités de paiement</p>
    <p style="margin:0 0 18px;font-size:14px;color:#333;line-height:1.6;">Virement sur le compte <strong style="font-family:Menlo,Monaco,monospace;">${esc(COMPANY.iban)}</strong>, avec en communication le numéro de chaque facture (une ligne par facture).</p>
    <p style="margin:0 0 22px;font-size:14px;color:#333;line-height:1.6;">Si certains règlements sont déjà en cours, nous vous prions de ne pas tenir compte des factures concernées. Pour toute question sur l'un de ces dossiers, notre service reste à votre disposition. Prochain relevé dans ${semaines > 1 ? `${semaines} semaines` : 'une semaine'}.</p>
    <p style="margin:0 0 2px;font-size:13px;color:#666;">Cordialement,</p>
    <p style="margin:0;font-size:14px;font-weight:700;color:#141414;">Le service Facturation</p>
    <p style="margin:0;font-size:13px;color:#666;">${esc(COMPANY.name)} · ${esc(COMPANY.phone)}</p>`
  return { sujet, html: emailLayout(content, 'Relevé des dossiers ouverts') }
}

export interface ResultatReleves { mode: string; envoyes: { partner: string; email: string; factures: number; total: number }[]; ignores: { partner: string; raison: string }[]; erreurs: string[] }

/** Passage du mercredi : un relevé par assistance dont le dernier date d'au moins 13 jours et qui a une facture échue. */
export async function envoyerReleves(opts: { apercu?: boolean } = {}): Promise<ResultatReleves> {
  const sb = createAdminClient()
  const mode = (await getBusinessText('releve_assistances_mode').catch(() => 'off')).toLowerCase()
  const out: ResultatReleves = { mode, envoyes: [], ignores: [], erreurs: [] }
  if (!opts.apercu) {
    const { assistantEnPause } = await import('@/lib/facturation/suspension')
    if (await assistantEnPause(sb, 'relances')) { out.ignores.push({ partner: '—', raison: 'Mes assistants : relances en pause' }); return out }
    if (mode !== 'on') { out.ignores.push({ partner: '—', raison: 'envoi désactivé (releve_assistances_mode)' }); return out }
  }
  const auj = jour()
  // Rythme : réglage releve_assistances_semaines (2 = un mercredi sur deux, 1 = chaque mercredi). Le passage du
  // mercredi envoie si le dernier relevé date d'au moins 7 × semaines − 1 jours.
  const semaines = Math.max(1, Math.round(await getBusinessNumber('releve_assistances_semaines').catch(() => 2)))
  for (const pid of await assistancesDuReleve()) {
    try {
      const { data: der } = await sb.from('releves_assistances').select('sent_at').eq('partner_id', pid).not('sent_at', 'is', null).order('sent_at', { ascending: false }).limit(1)
      const dernier = der?.[0]?.sent_at ? String(der[0].sent_at).slice(0, 10) : null
      const r = await releveDe(pid)
      if (dernier && jours(dernier, auj) < 7 * semaines - 1) { out.ignores.push({ partner: r.partner, raison: `relevé envoyé le ${fr(dernier)}` }); continue }
      if (!r.echues) { out.ignores.push({ partner: r.partner, raison: r.lignes.length ? 'aucune facture échue' : 'aucune facture ouverte' }); continue }
      if (!r.email) { out.ignores.push({ partner: r.partner, raison: 'pas d’adresse de facturation' }); continue }
      if (opts.apercu) { out.envoyes.push({ partner: r.partner, email: r.email, factures: r.lignes.length, total: r.total }); continue }
      const token = randomBytes(24).toString('base64url')
      const lien = lienReleve(token)
      const { sujet, html } = mailReleve(r, lien, auj, semaines)
      const { data: row, error } = await sb.from('releves_assistances').insert({ partner_id: pid, partner_name: r.partner, token, email_to: r.email, invoice_ids: r.lignes.map(l => l.id), nb_factures: r.lignes.length, total: r.total, expires_at: new Date(Date.now() + VALIDITE_JOURS * 86_400_000).toISOString() }).select('id').single()
      if (error) throw new Error(error.message)
      await sendEmail(r.email, sujet, html, r.partner, undefined, undefined, FROM_EMAIL)
      await sb.from('releves_assistances').update({ sent_at: new Date().toISOString() }).eq('id', row.id)
      out.envoyes.push({ partner: r.partner, email: r.email, factures: r.lignes.length, total: r.total })
    } catch (e: any) { out.erreurs.push(`${pid} : ${e?.message || e}`) }
  }
  return out
}

/** Relevé d'un jeton (page publique) : null si inconnu ou expiré. Les factures sont relues en direct (les payées disparaissent). */
export async function releveParJeton(token: string): Promise<{ releve: Releve; date: string } | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null
  const sb = createAdminClient()
  const { data } = await sb.from('releves_assistances').select('id, partner_id, sent_at, created_at, expires_at, opened_at').eq('token', token).maybeSingle()
  if (!data || Date.parse(data.expires_at) < Date.now()) return null
  if (!data.opened_at) await sb.from('releves_assistances').update({ opened_at: new Date().toISOString() }).eq('id', data.id)
  return { releve: await releveDe(data.partner_id), date: String(data.sent_at || data.created_at).slice(0, 10) }
}
