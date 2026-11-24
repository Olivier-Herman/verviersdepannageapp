// src/lib/supervision/index.ts — suivi du travail du bureau (Olivier 24/11/2026, à la demande de la direction).
// Rapports envoyés à Olivier seul : chaque soir à 21 h (le détail de la journée par personne suivie), le samedi
// (la semaine) et le 1er du mois (le mois écoulé, avec « Qui fait quoi ? »). Rien n'apparaît dans l'application :
// ni écran, ni menu, ni notification. Les personnes suivies ont été informées (réunion de la direction du 24/11 pour
// Jona ; demande de Momo lui-même).
//
// Sources, toutes dans les outils de la société :
//   • VD Soft : journal des fiches (mission_logs.actor_id) ;
//   • l'ERP : pièces, paiements et lettrages créés avec le compte de la personne (sa clé personnelle : ce qu'elle fait
//     depuis VD Soft porte aussi son nom) ;
//   • boîtes partagées : mails envoyés, attribués à la signature (« Jona », « Momo » seuls sur une ligne).
// Tout ce que font les automatismes (aucun nom) compte pour Mobi (Olivier 24/11/2026 : « c'est un rattrapage de mes
// agents parce qu'un user n'a pas fait une action ») ; dans le rapport de la personne, il apparaît en « rattrapé ».
//
// Réglage unique `supervision_config` (app_settings, texte JSON), volontairement hors de l'écran des réglages métier :
// la direction ne veut rien de visible dans les outils.

import type { createAdminClient } from '@/lib/supabase'
import { categorieDe as categorieAuto } from '@/lib/journal-mobi'

type Sb = ReturnType<typeof createAdminClient>

export interface Personne { nom: string; user_ids: string[]; odoo_uids: number[]; signatures: string[]; depuis: string; files?: string[] }
export interface Config {
  destinataires: string[]
  boites: string[]                    // boîtes partagées dont on lit les éléments envoyés
  boites_a_traiter: string[]          // boîtes dont les mails non lus restent « de côté »
  personnes: Personne[]
  mobi_signatures: string[]
  poids: Record<string, number>
  seuil_jours: number
  app_url: string
}

export async function lireConfig(sb: Sb): Promise<Config> {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'supervision_config').maybeSingle()
  const raw = (data as any)?.value
  if (!raw) throw new Error('Réglage « supervision_config » absent')
  const c = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!Array.isArray(c.destinataires) || !c.destinataires.length) throw new Error('supervision_config : aucun destinataire')
  return c as Config
}

// ── Catégories des actions de fiche ─────────────────────────────────────────────────────────────────────────────
// points = false : conséquence automatique d'une action (synchronisation vers une assistance ou l'ERP), montrée en
// total mais sans valeur propre.
export const CATS: { cle: string; titre: string; compte: boolean; test: (a: string) => boolean }[] = [
  { cle: 'sync', titre: 'Synchronisations déclenchées (assistances, ERP)', compte: false, test: a => /_synced$|^received$/.test(a) },
  { cle: 'sync_err', titre: 'Erreurs de synchronisation rencontrées', compte: false, test: a => /_sync_error$/.test(a) },
  { cle: 'facturation', titre: 'Facturation (factures, sans frais, passages « à facturer »)', compte: true, test: a => /dossier_invoice|^invoiced$|no_charge|force_status_to_invoice|auto_completed|billing|commission|regularisation|^completed$|invoice/.test(a) },
  { cle: 'fourriere', titre: 'Fourrière (levées, abandons, réquisitoires, sorties, Domaine, états de frais)', compte: true, test: a => /levee_saisie|abandon|requisitoire|exit_control|restitution|domaine|^ef_|etat_frais|scratch|snc_|officer|justinvoice|epave/.test(a) },
  { cle: 'parc', titre: 'Parc (vérifications, transferts de zone, clés)', compte: true, test: a => /parc|zone|key_|gardiennage|force_status_parked/.test(a) },
  { cle: 'dispatch', titre: 'Dispatch (attributions, annulations, relivraisons, adresses)', compte: true, test: a => /dispatch|reassign|cancel|rel_|relivraison|address|redelivery|merge|reoffered|appel|transfer_call/.test(a) },
  { cle: 'fiches', titre: 'Fiches (notes, photos, corrections)', compte: true, test: () => true },
]
export const catDe = (action: string) => CATS.find(c => c.test(action))!

// Catégories hors fiches.
export const AUTRES: Record<string, string> = {
  mail: 'Mails envoyés depuis les boîtes partagées',
  erp_piece: 'ERP : pièces encodées (achats, opérations diverses)',
  erp_facture: 'ERP : factures et notes de crédit clients créées',
  erp_paiement: 'ERP : paiements enregistrés',
  erp_lettrage: 'ERP : lettrages et rapprochements',
}

const LIBELLES: Record<string, string> = {
  dossier_invoice: 'Facture du dossier', invoiced: 'Facturée', no_charge: 'Clôturée sans frais', force_status_to_invoice: 'Passée en « à facturer »',
  force_status_parked: 'Remise au parc', force_status_dispatching: 'Remise au dispatch', parc_verified: 'Présence au parc vérifiée', parc_transfer: 'Changement de zone',
  parc_verification: 'Vérification du parc', key_location: 'Emplacement de la clé', key_hook: 'Clé accrochée', levee_saisie: 'Levée de saisie',
  abandon_vehicule: 'Abandon du véhicule', dispatched: 'Attribuée à un chauffeur', reassigned: 'Réattribuée', cancelled: 'Annulée', note: 'Note',
  photos_added: 'Photos ajoutées', updated: 'Fiche modifiée', address_change_applied: 'Changement d’adresse appliqué', address_change_kept: 'Adresse gardée',
  request_relivraison: 'Relivraison demandée', rel_attached: 'Relivraison rattachée', rel_reserved: 'Relivraison réservée', auto_completed: 'Clôturée',
  requisitoire_ocr: 'Réquisitoire lu', source_requalified: 'Assistance changée', exit_control_identity: 'Sortie : identité contrôlée',
  exit_control_path: 'Sortie : parcours', exit_control_signed: 'Sortie : signature', snc_scenario: 'Scénario police choisi',
}
export const libelle = (a: string) => LIBELLES[a] || a.replace(/_/g, ' ')

export interface Action {
  at: string                 // ISO
  qui: string                // nom de la personne, « Mobi » ou « Agents »
  cat: string                // clé CATS ou AUTRES
  titre: string              // ce qui a été fait
  fiche?: { id: string; numero: string | null; plaque: string | null } | null
  detail?: string | null
  montant?: number | null    // HTVA, factures clients
  points: number
  cleUnique: string          // une même fiche dans une même catégorie un même jour ne compte qu'une fois
}

const jourBxl = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date(iso))
export const heureBxlTxt = (iso: string) => new Date(iso).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })

/** Bornes UTC d'un jour belge (AAAA-MM-JJ). */
export function bornesJour(jour: string): [string, string] {
  const off = (d: string) => {
    const s = new Date(`${d}T12:00:00Z`).toLocaleString('en-US', { timeZone: 'Europe/Brussels', timeZoneName: 'shortOffset' })
    const m = s.match(/GMT([+-]\d+)/); return m ? Number(m[1]) : 1
  }
  const start = new Date(`${jour}T00:00:00Z`); start.setUTCHours(-off(jour))
  const end = new Date(`${jour}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 1); end.setUTCHours(-off(end.toISOString().slice(0, 10)))
  return [start.toISOString(), end.toISOString()]
}

async function missionLogs(sb: Sb, filtre: (q: any) => any, d1: string, d2: string): Promise<any[]> {
  const out: any[] = []
  for (let off = 0; ; off += 1000) {
    const { data, error } = await filtre(sb.from('mission_logs').select('id, mission_id, actor_id, action, notes, created_at'))
      .gte('created_at', d1).lt('created_at', d2).order('id').range(off, off + 999)
    if (error) throw new Error(`journal des fiches : ${error.message}`)
    out.push(...(data || [])); if ((data || []).length < 1000) break
  }
  return out
}

async function fiches(sb: Sb, ids: string[]) {
  const m = new Map<string, { id: string; numero: string | null; plaque: string | null }>()
  const u = [...new Set(ids.filter(Boolean))]
  for (let i = 0; i < u.length; i += 200) {
    const { data } = await sb.from('incoming_missions').select('id, mission_number, vehicle_plate').in('id', u.slice(i, i + 200))
    for (const x of data || []) m.set(x.id, { id: x.id, numero: x.mission_number, plaque: x.vehicle_plate })
  }
  return m
}

function depuisLogs(logs: any[], qui: string, fm: Map<string, any>, poids: Record<string, number>): Action[] {
  return logs.map(l => {
    const c = catDe(String(l.action))
    return {
      at: l.created_at, qui, cat: c.cle, titre: libelle(String(l.action)), fiche: fm.get(l.mission_id) || null,
      detail: l.notes ? String(l.notes).slice(0, 160) : null, points: c.compte ? (poids[c.cle] ?? 1) : 0,
      cleUnique: `${qui}:${c.cle}:${l.mission_id || l.id}:${jourBxl(l.created_at)}`,
    }
  })
}

// ── Mails envoyés des boîtes partagées, par signature ───────────────────────────────────────────────────────────
export interface MailEnvoye { at: string; boite: string; sujet: string; a: string; signataire: string | null }
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\s-]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase()

export async function mailsEnvoyes(boites: string[], d1: string, d2: string, signatures: Record<string, string[]>): Promise<{ mails: MailEnvoye[]; erreurs: string[] }> {
  const { getAppOnlyToken } = await import('@/lib/graph-mail-search')
  const mails: MailEnvoye[] = [], erreurs: string[] = []
  const sigs = Object.entries(signatures).flatMap(([qui, l]) => l.map(s => [qui, norm(s)] as const))
  for (const b of boites) {
    let url: string | null = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(b)}/mailFolders/sentitems/messages?$filter=sentDateTime ge ${d1} and sentDateTime lt ${d2}&$select=sentDateTime,subject,toRecipients,uniqueBody&$top=100`
    let essai = 0
    while (url) {
      const tok = await getAppOnlyToken(essai > 0)
      const r: Response = await fetch(url, { headers: { Authorization: `Bearer ${tok}`, Prefer: 'outlook.body-content-type="text"' }, cache: 'no-store' })
      if (r.status === 401 && essai === 0) { essai = 1; continue }
      if (!r.ok) { erreurs.push(`${b} illisible (${r.status})`); break }
      const j: any = await r.json()
      for (const m of j.value || []) {
        const lignes = String(m.uniqueBody?.content || '').replace(/\r/g, '').split('\n').map(norm).filter(Boolean).slice(-15)
        const s = sigs.find(([, sig]) => lignes.some(l => l === sig || l.startsWith(sig + ' service') || l.startsWith(sig + ' verviers')))
        mails.push({ at: m.sentDateTime, boite: b, sujet: String(m.subject || '(sans objet)'), a: (m.toRecipients || []).map((x: any) => x.emailAddress?.address).filter(Boolean).join(', '), signataire: s ? s[0] : null })
      }
      url = j['@odata.nextLink'] || null
    }
  }
  return { mails, erreurs }
}

// ── L'ERP ─────────────────────────────────────────────────────────────────────────────────────────────────────
async function erp(uids: number[], d1: string, d2: string, qui: string, poids: Record<string, number>): Promise<{ actions: Action[]; erreurs: string[] }> {
  const actions: Action[] = [], erreurs: string[] = []
  if (!uids.length) return { actions, erreurs }
  const { odooRpcCompany, ODOO_COMPANIES } = await import('@/lib/odoo')
  const dt = (iso: string) => iso.slice(0, 19).replace('T', ' ')
  const iso = (d: string) => d.replace(' ', 'T') + 'Z'
  const dom = [['create_uid', 'in', uids], ['create_date', '>=', dt(d1)], ['create_date', '<', dt(d2)]]
  for (const c of [...new Set(Object.values(ODOO_COMPANIES).map(Number))]) {
    try {
      const moves: any[] = await odooRpcCompany(c, 'account.move', 'search_read', [[['company_id', '=', c], ...dom]], { fields: ['name', 'move_type', 'partner_id', 'amount_untaxed_signed', 'state', 'create_date', 'ref'], limit: 2000 })
      for (const m of moves) {
        const client = m.move_type === 'out_invoice' || m.move_type === 'out_refund'
        const cat = client ? 'erp_facture' : 'erp_piece'
        const genre = ({ out_invoice: 'Facture', out_refund: 'Note de crédit', in_invoice: 'Facture d’achat', in_refund: 'Note de crédit fournisseur', entry: 'Opération diverse' } as any)[m.move_type] || m.move_type
        actions.push({
          at: iso(m.create_date), qui, cat, titre: `${genre} ${m.name && m.name !== '/' ? m.name : '(brouillon)'}`, detail: [m.partner_id?.[1], m.ref].filter(Boolean).join(' · ') || null,
          montant: client ? Number(m.amount_untaxed_signed || 0) : null, points: poids[cat] ?? (client ? 0 : 3), cleUnique: `${qui}:erp:${c}:${m.id}`,
        })
      }
      const pays: any[] = await odooRpcCompany(c, 'account.payment', 'search_read', [[['company_id', '=', c], ...dom]], { fields: ['name', 'amount', 'payment_type', 'partner_id', 'create_date'], limit: 2000 })
      for (const p of pays) actions.push({ at: iso(p.create_date), qui, cat: 'erp_paiement', titre: `${p.payment_type === 'outbound' ? 'Paiement fournisseur' : 'Paiement reçu'} ${p.name || ''}`.trim(), detail: [p.partner_id?.[1], `${Number(p.amount || 0).toFixed(2)} €`].filter(Boolean).join(' · '), points: poids.erp_paiement ?? 2, cleUnique: `${qui}:pay:${c}:${p.id}` })
      const lett: any[] = await odooRpcCompany(c, 'account.partial.reconcile', 'search_read', [[['company_id', '=', c], ...dom]], { fields: ['create_date', 'amount'], limit: 5000 })
      for (const l of lett) actions.push({ at: iso(l.create_date), qui, cat: 'erp_lettrage', titre: 'Lettrage', detail: `${Number(l.amount || 0).toFixed(2)} €`, points: poids.erp_lettrage ?? 1, cleUnique: `${qui}:rec:${c}:${l.id}` })
    } catch (e: any) { erreurs.push(`ERP société ${c} : ${String(e?.message || e).slice(0, 120)}`) }
  }
  return { actions, erreurs }
}

// ── Collecte d'une période pour tout le monde ──────────────────────────────────────────────────────────────────
export interface Collecte { d1: string; d2: string; actions: Action[]; erreurs: string[] }

export async function collecter(sb: Sb, cfg: Config, d1: string, d2: string): Promise<Collecte> {
  const { getBusinessList } = await import('@/lib/settings/business')
  const mobiIds = await getBusinessList('mobi_user_ids').catch(() => [] as string[])
  const mobiUids = (await getBusinessList('mobi_odoo_uids').catch(() => [] as string[])).map(Number)
  const erreurs: string[] = []
  const actions: Action[] = []
  const suivis = cfg.personnes
  const tousIds = [...suivis.flatMap(p => p.user_ids), ...mobiIds]
  const logs = await missionLogs(sb, q => q.or(`actor_id.is.null,actor_id.in.(${tousIds.join(',')})`), d1, d2)
  const fm = await fiches(sb, logs.map(l => l.mission_id))
  const qui = (actor: string | null) => !actor ? 'Agents' : suivis.find(p => p.user_ids.includes(actor))?.nom || (mobiIds.includes(actor) ? 'Mobi' : null)
  for (const [nom, ls] of Object.entries(groupBy(logs, l => qui(l.actor_id) || ''))) {
    if (!nom) continue
    // Automatismes : seules les actions qui remplacent un humain (mêmes règles que le journal de Mobi).
    const garde = nom === 'Agents' ? ls.filter(l => categorieAuto(String(l.action)).compte) : ls
    actions.push(...depuisLogs(garde, nom, fm, cfg.poids))
  }
  // Une personne n'est suivie qu'à partir de sa date de début.
  const debut = new Map(suivis.map(p => [p.nom, p.depuis]))
  for (const p of suivis) {
    const r = await erp(p.odoo_uids, d1, d2, p.nom, cfg.poids); actions.push(...r.actions); erreurs.push(...r.erreurs)
  }
  { const r = await erp(mobiUids, d1, d2, 'Mobi', cfg.poids); actions.push(...r.actions); erreurs.push(...r.erreurs) }
  const sigs: Record<string, string[]> = Object.fromEntries(suivis.map(p => [p.nom, p.signatures]))
  sigs.Mobi = cfg.mobi_signatures || []
  try {
    const { mails, erreurs: e } = await mailsEnvoyes(cfg.boites, d1, d2, sigs); erreurs.push(...e)
    for (const m of mails) actions.push({
      at: m.at, qui: m.signataire || 'Agents', cat: 'mail', titre: m.sujet, detail: `${m.boite.split('@')[0]}@ → ${m.a}`,
      points: m.signataire ? (cfg.poids.mail ?? 2) : 0, cleUnique: `mail:${m.boite}:${m.at}:${m.sujet}`,
    })
  } catch (e: any) { erreurs.push(`Mails : ${String(e?.message || e).slice(0, 120)}`) }
  // Mails partis seuls (signature de service) = automatismes de Mobi, sans points pour le bureau.
  const gardees = actions.filter(a => { const d = debut.get(a.qui); return !d || a.at >= d })
  // Points dédoublonnés : une fiche, une catégorie, un jour = une fois.
  const vu = new Set<string>()
  for (const a of gardees.sort((x, y) => x.at.localeCompare(y.at))) { if (vu.has(a.cleUnique)) a.points = 0; else vu.add(a.cleUnique) }
  return { d1, d2, actions: gardees, erreurs }
}

function groupBy<T>(l: T[], k: (x: T) => string): Record<string, T[]> {
  const o: Record<string, T[]> = {}
  for (const x of l) (o[k(x)] ||= []).push(x)
  return o
}

// ── Chiffres d'une personne ─────────────────────────────────────────────────────────────────────────────────────
const PAUSE_MS = 30 * 60e3

export interface Chiffres { actions: number; points: number; heures: number; indice: number; factureHt: number; premier: string | null; dernier: string | null; parCat: Record<string, { n: number; points: number }> }

export function chiffres(actions: Action[]): Chiffres {
  const util = actions.filter(a => a.cat !== 'sync')
  const t = util.map(a => a.at).sort()
  const premier = t[0] || null, dernier = t[t.length - 1] || null
  // Heures actives : temps entre deux actions consécutives, plafonné à 30 min (une pause plus longue ne compte pas),
  // plus 5 min pour chaque reprise. La présence (première → dernière action) est affichée à part.
  let heures = 0
  const s = util.map(a => +new Date(a.at)).sort((a, b) => a - b)
  for (let i = 0; i < s.length; i++) heures += (i && s[i] - s[i - 1] <= PAUSE_MS ? s[i] - s[i - 1] : 5 * 60e3) / 3600e3
  const points = actions.reduce((s, a) => s + a.points, 0)
  const parCat: Chiffres['parCat'] = {}
  for (const a of actions) { const c = (parCat[a.cat] ||= { n: 0, points: 0 }); c.n++; c.points += a.points }
  return {
    actions: util.length, points, heures: util.length ? heures : 0, indice: util.length ? points / Math.max(heures, 0.25) : 0,
    factureHt: actions.reduce((s, a) => s + (a.montant || 0), 0), premier, dernier, parCat,
  }
}
export const titreCat = (cle: string) => CATS.find(c => c.cle === cle)?.titre || AUTRES[cle] || cle

// ── Ce qui reste de côté (photographie au moment du rapport) ─────────────────────────────────────────────────────
export interface File { cle: string; titre: string; n: number; vieux: number; exemples: string[] }

export async function filesEnAttente(sb: Sb, cfg: Config): Promise<File[]> {
  const out: File[] = []
  const seuil = new Date(Date.now() - (cfg.seuil_jours || 7) * 86400e3).toISOString()
  const essai = async (cle: string, titre: string, f: () => Promise<{ n: number; vieux: number; exemples?: string[] }>) => {
    try { const r = await f(); if (r.n) out.push({ cle, titre, n: r.n, vieux: r.vieux, exemples: r.exemples || [] }) }
    catch (e: any) { out.push({ cle, titre: `${titre} (lecture impossible : ${String(e?.message || e).slice(0, 80)})`, n: 0, vieux: 0, exemples: [] }) }
  }
  const lien = (id: string, txt: string) => `<a href="${cfg.app_url}/dispatch/${id}">${esc(txt)}</a>`
  await essai('a_facturer', 'Fiches à facturer', async () => {
    const { data } = await sb.from('incoming_missions').select('id, mission_number, vehicle_plate, updated_at').eq('status', 'to_invoice').eq('dossier_leg', false).is('archived_at', null).not('external_id', 'like', 'PROCESSING_%').order('updated_at').limit(2000)
    const l = data || [], v = l.filter(x => x.updated_at < seuil)
    return { n: l.length, vieux: v.length, exemples: v.slice(0, 10).map(x => `${lien(x.id, x.vehicle_plate || x.mission_number || '?')} depuis le ${new Date(x.updated_at).toLocaleDateString('fr-BE')}`) }
  })
  await essai('requisitoires', 'Réquisitoires reçus à rattacher ou vérifier', async () => {
    const { data } = await sb.from('requisitoire_intake').select('id, created_at').in('status', ['pending', 'to_verify']).limit(1000)
    const l = data || []; return { n: l.length, vieux: l.filter(x => x.created_at < seuil).length }
  })
  await essai('relance_req', 'Saisies sans réquisitoire (à relancer)', async () => {
    const { loadRelanceItems } = await import('@/lib/requisitoire/relance-items')
    const l: any[] = await loadRelanceItems(sb); return { n: l.length, vieux: l.filter(x => (x.parked_at || x.created_at) < seuil).length }
  })
  await essai('courrier', 'Tâches de courrier non faites', async () => {
    const { data } = await sb.from('courrier_tasks').select('id, created_at').is('done_at', null).limit(1000)
    const l = data || []; return { n: l.length, vieux: l.filter(x => x.created_at < seuil).length }
  })
  await essai('pieces', 'Pièces demandées et pas encore reçues', async () => {
    const { data } = await sb.from('mail_piece_requests').select('id, requested_at').eq('status', 'open').limit(1000)
    const l = data || []; return { n: l.length, vieux: l.filter(x => x.requested_at < seuil).length }
  })
  await essai('mail_agent', 'Mails en attente d’une décision', async () => {
    const { data } = await sb.from('mail_agent_items').select('id, received_at').in('status', ['to_decide', 'ready', 'to_verify']).limit(1000)
    const l = data || []; return { n: l.length, vieux: l.filter(x => (x.received_at || '') < seuil).length }
  })
  await essai('reception', 'Clients en attente à la réception', async () => {
    const { data } = await sb.from('fiche_interactions').select('id, waiting_since').eq('status', 'waiting').limit(1000)
    const l = data || []; return { n: l.length, vieux: l.filter(x => (x.waiting_since || '') < seuil).length }
  })
  const { getAppOnlyToken } = await import('@/lib/graph-mail-search')
  for (const b of cfg.boites_a_traiter || []) {
    await essai(`non_lus:${b}`, `Mails non lus dans ${b.split('@')[0]}@ (plus de 24 h)`, async () => {
      const tok = await getAppOnlyToken()
      const lim = new Date(Date.now() - 86400e3).toISOString()
      const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(b)}/mailFolders/inbox/messages?$filter=isRead eq false and receivedDateTime lt ${lim}&$select=receivedDateTime,subject&$top=200&$orderby=receivedDateTime`, { headers: { Authorization: `Bearer ${tok}` }, cache: 'no-store' })
      if (!r.ok) throw new Error(`boîte illisible (${r.status})`)
      const l: any[] = (await r.json()).value || []
      return { n: l.length, vieux: l.filter(x => x.receivedDateTime < seuil).length, exemples: l.slice(0, 5).map(x => `${new Date(x.receivedDateTime).toLocaleDateString('fr-BE')} · ${esc(String(x.subject || '(sans objet)').slice(0, 90))}`) }
    })
  }
  return out
}

// ── Mise en page ────────────────────────────────────────────────────────────────────────────────────────────────
export const esc = (s: string) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c])
export const eur = (n: number) => n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
export const h = (n: number) => `${Math.floor(n)} h ${String(Math.round((n % 1) * 60)).padStart(2, '0')}`
const TH = 'style="text-align:left;padding:6px 8px;background:#f1f5f9;color:#334155;font-size:12px;border-bottom:1px solid #e2e8f0"'
const TD = 'style="padding:6px 8px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#1e293b;vertical-align:top"'
export const table = (tetes: string[], lignes: string[][]) =>
  `<table style="border-collapse:collapse;width:100%;margin:8px 0 16px">${'<tr>' + tetes.map(t => `<th ${TH}>${t}</th>`).join('') + '</tr>'}${lignes.map(l => '<tr>' + l.map(c => `<td ${TD}>${c}</td>`).join('') + '</tr>').join('')}</table>`
export const page = (titre: string, corps: string) =>
  `<div style="font-family:Arial,Helvetica,sans-serif;max-width:900px;color:#0f172a"><h2 style="margin:0 0 4px">${esc(titre)}</h2>${corps}<p style="color:#64748b;font-size:11px;margin-top:24px">Rapport réservé à Mobi. Points : une fiche par catégorie et par jour ne compte qu’une fois ; synchronisations et mails partis seuls ne comptent pas. Indice = points par heure active (temps entre deux actions, pauses de plus de 30 min non comptées).</p></div>`
export const tuile = (t: string, v: string) => `<td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0"><div style="font-size:11px;color:#475569">${t}</div><div style="font-size:18px;font-weight:bold;color:#0f172a">${v}</div></td>`
export const tuiles = (l: [string, string][]) => `<table style="border-collapse:separate;border-spacing:6px;margin:8px -6px">${'<tr>' + l.map(([a, b]) => tuile(a, b)).join('') + '</tr>'}</table>`

export function ficheTxt(a: Action, appUrl: string) {
  if (!a.fiche) return ''
  return `<a href="${appUrl}/dispatch/${a.fiche.id}">${esc(a.fiche.plaque || a.fiche.numero || 'fiche')}</a>`
}

/** Rapport du soir d'une personne. */
export function rapportJour(cfg: Config, p: Personne, jour: string, c: Collecte, files: File[]): { sujet: string; html: string } {
  const mes = c.actions.filter(a => a.qui === p.nom)
  const k = chiffres(mes)
  const dateTxt = new Date(`${jour}T12:00:00Z`).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' })
  const debutTxt = p.depuis > c.d1 ? ` (suivi à partir de ${heureBxlTxt(p.depuis)})` : ''
  let corps = `<p style="color:#475569;margin:0 0 8px">${esc(dateTxt)}${debutTxt}</p>`
  corps += tuiles([
    ['Actions', String(k.actions)], ['Présence active', k.premier ? `${heureBxlTxt(k.premier)} → ${heureBxlTxt(k.dernier!)}` : '—'],
    ['Points', String(k.points)], ['Indice (points / h)', k.indice.toFixed(1)], ['Facturé HTVA (ERP)', eur(k.factureHt)],
  ])
  const ordre = [...CATS.map(x => x.cle), ...Object.keys(AUTRES)]
  const cats = Object.entries(k.parCat).sort((a, b) => ordre.indexOf(a[0]) - ordre.indexOf(b[0]))
  corps += `<h3 style="margin:16px 0 4px">Par type de travail</h3>` + (cats.length ? table(['Type', 'Nombre', 'Points'], cats.map(([cle, v]) => [esc(titreCat(cle)), String(v.n), String(v.points)])) : '<p>Aucune action enregistrée.</p>')
  const detail = mes.filter(a => a.cat !== 'sync').sort((a, b) => a.at.localeCompare(b.at))
  if (detail.length) corps += `<h3 style="margin:16px 0 4px">Détail (${detail.length})</h3>` + table(['Heure', 'Type', 'Action', 'Fiche', 'Détail'], detail.map(a => [heureBxlTxt(a.at), esc(titreCat(a.cat).split(' (')[0]), esc(a.titre) + (a.montant ? ` <b>${eur(a.montant)}</b>` : ''), ficheTxt(a, cfg.app_url), esc(a.detail || '')]))
  // Rattrapé par les agents de Mobi : ce qu'un humain aurait dû faire dans la journée.
  const agents = c.actions.filter(a => a.qui === 'Agents' && a.cat !== 'mail' && a.cat !== 'sync')
  if (agents.length) {
    const g = groupBy(agents, a => a.cat)
    corps += `<h3 style="margin:16px 0 4px">Resté de côté, rattrapé par Mobi (agents, tout le bureau)</h3>` + table(['Type', 'Nombre', 'Exemples'], Object.entries(g).map(([cle, l]) => [esc(titreCat(cle)), String(l.length), l.slice(0, 4).map(a => `${esc(a.titre)} ${ficheTxt(a, cfg.app_url)}`).join('<br>')]))
  }
  corps += blocFiles(files, p)
  if (c.erreurs.length) corps += `<p style="color:#b45309;font-size:12px">Sources incomplètes : ${c.erreurs.map(esc).join(' · ')}</p>`
  return { sujet: `${p.nom} — ${dateTxt} : ${k.actions} actions, indice ${k.indice.toFixed(1)}`, html: page(`Journée de ${p.nom}`, corps) }
}

export function blocFiles(files: File[], p?: Personne) {
  const l = p?.files?.length ? files.filter(f => p.files!.some(k => f.cle.startsWith(k))) : files
  if (!l.length) return ''
  return `<h3 style="margin:16px 0 4px">Resté de côté ce soir</h3>` + table(['File', 'En attente', 'Depuis plus de 7 jours', 'Les plus anciens'], l.map(f => [esc(f.titre), String(f.n), f.vieux ? `<b style="color:#b91c1c">${f.vieux}</b>` : '0', f.exemples.join('<br>')]))
}

/** Tableau « Qui fait quoi ? » : catégories × personnes, doublons et tâches laissées aux agents. */
export function quiFaitQuoi(cfg: Config, c: Collecte): string {
  const gens = [...cfg.personnes.map(p => p.nom), 'Mobi', 'Agents']
  const ordre = [...CATS.map(x => x.cle), ...Object.keys(AUTRES)].filter(k => k !== 'sync')
  const lignes: string[][] = []
  for (const cle of ordre) {
    const n = gens.map(g => c.actions.filter(a => a.qui === g && a.cat === cle && (a.points > 0 || cle === 'sync_err' || g === 'Agents')).length)
    const tot = n.reduce((a, b) => a + b, 0)
    if (!tot) continue
    lignes.push([esc(titreCat(cle)), ...n.map(x => x ? `${x} <span style="color:#64748b">(${Math.round(100 * x / tot)} %)</span>` : '—')])
  }
  let html = `<h3 style="margin:16px 0 4px">Qui fait quoi ?</h3><p style="font-size:12px;color:#475569;margin:0">« Agents » = ce que les automatismes de Mobi ont fait à la place du bureau (compté chez Mobi).</p>` + table(['Type', ...gens], lignes)
  // Doublons : une même fiche traitée dans la même catégorie par deux personnes différentes.
  const parFiche = groupBy(c.actions.filter(a => a.fiche && a.qui !== 'Agents' && CATS.find(x => x.cle === a.cat)?.compte), a => `${a.fiche!.id}:${a.cat}`)
  const doublons = Object.values(parFiche).filter(l => new Set(l.map(a => a.qui)).size > 1)
  if (doublons.length) html += `<p style="margin:8px 0 4px"><b>${doublons.length} fiches traitées par plusieurs personnes dans le même type de travail</b> (exemples) :</p>` + table(['Fiche', 'Type', 'Qui'], doublons.slice(0, 15).map(l => [ficheTxt(l[0], cfg.app_url), esc(titreCat(l[0].cat).split(' (')[0]), [...new Set(l.map(a => a.qui))].join(', ')]))
  // Tâches orphelines : faites par les agents, par aucun humain.
  const orphelins = ordre.filter(cle => c.actions.some(a => a.qui === 'Agents' && a.cat === cle) && gens.slice(0, -1).every(g => !c.actions.some(a => a.qui === g && a.cat === cle && a.points > 0)))
  if (orphelins.length) html += `<p style="margin:8px 0"><b>Faits uniquement par les agents :</b> ${orphelins.map(k => esc(titreCat(k))).join(' · ')}</p>`
  return html
}

/** Bilan d'une période (semaine ou mois) : un tableau par personne, ligne par jour (ou par semaine). */
export function rapportPeriode(cfg: Config, titre: string, c: Collecte, files: File[], precedent: Collecte | null, decoupe: 'jour' | 'semaine'): { sujet: string; html: string } {
  let corps = ''
  const resume: string[] = []
  for (const p of cfg.personnes) {
    const mes = c.actions.filter(a => a.qui === p.nom)
    const k = chiffres(mes)
    const kp = precedent ? chiffres(precedent.actions.filter(a => a.qui === p.nom)) : null
    const evol = (a: number, b?: number) => b == null || !kp || !b ? '' : ` <span style="color:${a >= b ? '#15803d' : '#b91c1c'}">(${a >= b ? '+' : ''}${Math.round(100 * (a - b) / b)} %)</span>`
    resume.push(`${p.nom} ${k.actions} actions, indice ${k.indice.toFixed(1)}`)
    corps += `<h3 style="margin:20px 0 4px">${esc(p.nom)}</h3>` + tuiles([
      ['Actions', String(k.actions) + evol(k.actions, kp?.actions)], ['Heures actives', h(k.heures)], ['Points', String(k.points) + evol(k.points, kp?.points)],
      ['Indice', k.indice.toFixed(1) + evol(k.indice, kp?.indice)], ['Facturé HTVA', eur(k.factureHt)],
    ])
    const cle = (a: Action) => decoupe === 'jour' ? jourBxl(a.at) : semaineDe(jourBxl(a.at))
    const g = groupBy(mes, cle)
    corps += table([decoupe === 'jour' ? 'Jour' : 'Semaine du', 'Présence', 'Actions', 'Points', 'Indice', 'Facturé HTVA', 'Mails', 'Principal travail'], Object.keys(g).sort().map(d => {
      const x = chiffres(g[d])
      const top = Object.entries(x.parCat).filter(([k2]) => k2 !== 'sync').sort((a, b) => b[1].points - a[1].points)[0]
      return [new Date(`${d}T12:00:00Z`).toLocaleDateString('fr-BE', { weekday: decoupe === 'jour' ? 'short' : undefined, day: 'numeric', month: 'numeric' }),
        decoupe === 'jour' && x.premier ? `${heureBxlTxt(x.premier)} → ${heureBxlTxt(x.dernier!)}` : h(x.heures), String(x.actions), String(x.points), x.indice.toFixed(1), eur(x.factureHt),
        String(x.parCat.mail?.n || 0), top ? esc(titreCat(top[0]).split(' (')[0]) : '—']
    }))
    const cats = Object.entries(k.parCat).filter(([k2]) => k2 !== 'sync').sort((a, b) => b[1].points - a[1].points)
    corps += table(['Type de travail', 'Nombre', 'Points'], cats.map(([k2, v]) => [esc(titreCat(k2)), String(v.n), String(v.points)]))
  }
  corps += quiFaitQuoi(cfg, c)
  corps += blocFiles(files)
  if (c.erreurs.length) corps += `<p style="color:#b45309;font-size:12px">Sources incomplètes : ${[...new Set(c.erreurs)].map(esc).join(' · ')}</p>`
  return { sujet: `${titre} : ${resume.join(' · ')}`, html: page(titre, corps) }
}

/** Lundi de la semaine d'un jour (AAAA-MM-JJ). */
export function semaineDe(jour: string): string {
  const d = new Date(`${jour}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}
