// src/lib/bureau/jour.ts — « Bureau du jour » (Olivier 17/10/2026).
//
// Vue d'ensemble, en direct, des 10 étapes de la réunion bureau (agents, décisions, mails, Domaine, états de frais,
// rapprochements, paiements, facturation, fourrière, clôture). Réservée à Mobi. Chaque bloc est calculé à part :
// une source en panne n'empêche pas les autres de s'afficher (le bloc dit « indisponible » et pourquoi).
import { createAdminClient } from '@/lib/supabase'
import { odooRpcCompany, ODOO_COMPANIES } from '@/lib/odoo'
import { getAppOnlyToken } from '@/lib/graph-mail-search'

export type Niveau = 'ok' | 'info' | 'attention' | 'urgent'
export interface Ligne { texte: string; detail?: string; montant?: number | null; niveau?: Niveau; lien?: string; id?: string; kind?: string; choix?: { key: string; label: string }[] }
export interface Bloc { cle: string; titre: string; resume: string; niveau: Niveau; lignes: Ligne[]; lien?: string; erreur?: string }

const LECTURE = /^lecture$/i

async function agentsNuit(sb: any): Promise<Bloc> {
  const since = new Date(Date.now() - 24 * 3600e3).toISOString()
  const { data: j } = await sb.from('agent_journal').select('created_at, agent_name, action, detail, ok').gte('created_at', since).order('created_at', { ascending: false }).limit(300)
  const actions = (j || []).filter((x: any) => !LECTURE.test(x.action) && !/^import Scrada$/i.test(x.action))
  const ko = actions.filter((x: any) => x.ok === false)
  const lignes: Ligne[] = actions.slice(0, 25).map((x: any) => ({
    texte: `${x.agent_name} · ${x.action}`, detail: `${new Date(x.created_at).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })} — ${String(x.detail || '').slice(0, 160)}`,
    niveau: x.ok === false ? 'urgent' : 'info',
  }))
  return { cle: 'agents', titre: 'Agents (24 h)', resume: `${actions.length} action(s)${ko.length ? `, ${ko.length} en échec` : ''}`, niveau: ko.length ? 'urgent' : actions.length ? 'info' : 'ok', lignes, lien: '/admin/agents' }
}

async function decisions(sb: any): Promise<Bloc> {
  const { data } = await sb.from('agent_proposals').select('id, agent_name, kind, title, amount, status, payload, created_at').in('status', ['to_validate', 'failed']).order('created_at', { ascending: true }).limit(50)
  const lignes: Ligne[] = (data || []).map((p: any) => ({
    id: p.id, kind: p.kind, texte: p.title, montant: p.amount != null ? Number(p.amount) : null,
    detail: `${p.agent_name}${p.status === 'failed' ? ' · ÉCHEC à l’exécution' : ''} · depuis le ${String(p.created_at).slice(0, 10).split('-').reverse().join('/')}`,
    niveau: p.status === 'failed' ? 'urgent' : 'attention',
    choix: p.kind === 'question_olivier' ? (p.payload?.choix || []) : undefined,
  }))
  return { cle: 'decisions', titre: 'Décisions des agents', resume: lignes.length ? `${lignes.length} en attente de toi` : 'Rien en attente', niveau: lignes.some(l => l.niveau === 'urgent') ? 'urgent' : lignes.length ? 'attention' : 'ok', lignes, lien: '/admin/agents' }
}

async function mails(): Promise<Bloc> {
  const tok = await getAppOnlyToken()
  if (!tok) throw new Error('jeton de messagerie indisponible')
  const h = { Authorization: `Bearer ${tok}` }
  const g = async (u: string) => (await fetch('https://graph.microsoft.com/v1.0' + u, { headers: h, cache: 'no-store' })).json()
  const findFolder = async (box: string, name: string): Promise<any> => {
    const go = async (url: string): Promise<any> => {
      const j = await g(url)
      for (const f of j.value || []) {
        if (f.displayName === name) return f
        if (f.childFolderCount) { const r = await go(`/users/${box}/mailFolders/${f.id}/childFolders?$top=100`); if (r) return r }
      }
      return null
    }
    return go(`/users/${box}/mailFolders?$top=100`)
  }
  const lignes: Ligne[] = []
  let total = 0
  for (const box of ['fourriere@verviersdepannage.be', 'administration@verviersdepannage.com', 'mobi@verviersdepannage.be']) {
    const m = await g(`/users/${box}/mailFolders/inbox/messages?$top=50&$select=subject,from,receivedDateTime,isRead&$orderby=receivedDateTime desc`)
    const v = m.value || []
    total += v.length
    lignes.push({ texte: `${box.split('@')[0]}@ : ${v.length} mail(s) dans la boîte de réception`, detail: v.slice(0, 4).map((x: any) => `• ${x.from?.emailAddress?.address || '?'} — ${String(x.subject || '').slice(0, 70)}`).join('\n'), niveau: v.length ? 'attention' : 'ok' })
  }
  for (const [box, name] of [['fourriere@verviersdepannage.be', 'A traiter par Mobi'], ['info@verviersdepannage.com', '0 - Scan Facturation'], ['info@verviersdepannage.com', '0 - Jona et Mobi'], ['mobi@verviersdepannage.be', 'Comptable THG']] as const) {
    const f = await findFolder(box, name).catch(() => null)
    const n = f?.totalItemCount || 0
    total += n
    if (n) lignes.push({ texte: `« ${name} » (${box.split('@')[0]}@) : ${n} mail(s)`, niveau: 'attention' })
  }
  return { cle: 'mails', titre: 'Mails', resume: total ? `${total} mail(s) à voir` : 'Boîtes vides', niveau: total ? 'attention' : 'ok', lignes }
}

async function domaine(sb: any): Promise<Bloc> {
  const { data: s } = await sb.from('app_settings').select('key, value').in('key', ['domaine_dates_in_last_run', 'vente_epaves_last_run'])
  const get = (k: string) => { try { return JSON.parse(String(s?.find((x: any) => x.key === k)?.value || '{}')) } catch { return {} } }
  const di = get('domaine_dates_in_last_run'), ve = get('vente_epaves_last_run')
  // Un même véhicule revient sur plusieurs passages, et une fiche peut avoir reçu sa date de remise à la main depuis :
  // on ne compte que les VIN distincts dont aucune fiche n'a de date de remise au Domaine (17/10/2026 : 29 → 8).
  const { data: nm } = await sb.from('domaine_dates_in').select('vin, vin_tail').eq('outcome', 'no_match').gte('created_at', new Date(Date.now() - 30 * 864e5).toISOString())
  const { data: posees } = await sb.from('incoming_missions').select('vehicle_vin').not('domaine_remise_date', 'is', null).not('vehicle_vin', 'is', null).gte('domaine_remise_date', new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10))
  const vinsPoses = (posees || []).map((x: any) => String(x.vehicle_vin).toUpperCase())
  const restants = new Set((nm || []).filter((d: any) => !vinsPoses.some((v: string) => d.vin_tail && v.includes(String(d.vin_tail).toUpperCase()))).map((d: any) => d.vin))
  const sansFiche = restants.size
  const lignes: Ligne[] = [
    { texte: `Dates IN : dernier passage ${di.at ? new Date(di.at).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', dateStyle: 'short', timeStyle: 'short' }) : '—'}`, detail: `${di.applied ?? 0} encodée(s), ${di.noMatch ?? 0} sans fiche sur ce passage`, niveau: 'info', lien: '/fourriere/domaine/dates-in' },
    { texte: `Ventes d’épaves : dernier passage ${ve.at ? new Date(ve.at).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', dateStyle: 'short', timeStyle: 'short' }) : '—'}`, detail: `${ve.applied ?? 0} posée(s), ${ve.noMatch ?? 0} sans fiche`, niveau: 'info', lien: '/fourriere/domaine' },
  ]
  if (sansFiche) lignes.push({ texte: `${sansFiche} véhicule(s) des dates IN sans fiche ni date de remise (30 jours)`, niveau: 'attention', lien: '/fourriere/domaine/dates-in' })
  return { cle: 'domaine', titre: 'Domaine', resume: sansFiche ? `${sansFiche} remise(s) sans fiche` : 'À jour', niveau: sansFiche ? 'attention' : 'ok', lignes, lien: '/fourriere/domaine' }
}

async function etatsFrais(sb: any): Promise<Bloc> {
  const { data: efs } = await sb.from('saisie_etats_frais').select('numero, status, total_tvac, status_note, created_at').in('status', ['refuse', 'accepte']).order('created_at', { ascending: false }).limit(50)
  const { data: ds } = await sb.from('saisie_dossiers').select('id, mission_id, recipient, state').in('state', ['en_parc', 'gardiennage_recurrent', 'ef_envoye']).is('paused_at', null).limit(2000)
  const ids = (ds || []).map((d: any) => d.mission_id).filter(Boolean)
  const { data: ms } = ids.length ? await sb.from('incoming_missions').select('id, requisitoire_doc_path, officer_partner_id, vehicle_plate, officer_name').in('id', ids) : { data: [] }
  const { isRequisitoireDoc } = await import('@/lib/requisitoire/doc')
  const req = new Map((ms || []).map((m: any) => [m.id, m.requisitoire_doc_path]))
  const sansReq = (ds || []).filter((d: any) => d.recipient !== 'client' && !isRequisitoireDoc(String(req.get(d.mission_id) || ''))).length
  const lignes: Ligne[] = (efs || []).map((e: any) => ({
    texte: `${e.numero} — ${e.status === 'accepte' ? 'accepté, à déposer sur JustInvoice' : 'refusé'}`, montant: Number(e.total_tvac || 0),
    detail: String(e.status_note || '').slice(0, 180), niveau: e.status === 'accepte' ? 'attention' : 'info', lien: '/fourriere/saisies',
  }))
  // Suivi (Olivier 17/10/2026) : sans contact agent relié, la relance automatique ne part jamais → à relier ici.
  const sansAgent = (ds || []).filter((d: any) => d.recipient !== 'client' && !isRequisitoireDoc(String(req.get(d.mission_id) || '')))
    .map((d: any) => (ms || []).find((m: any) => m.id === d.mission_id)).filter((m: any) => m && !m.officer_partner_id)
  if (sansAgent.length) lignes.unshift({ texte: `${sansAgent.length} saisie(s) sans agent relié : aucune relance ne part`, detail: sansAgent.map((m: any) => `${m.vehicle_plate || '?'} (${m.officer_name || 'agent inconnu'})`).join(', ').slice(0, 300), niveau: 'urgent', lien: '/fourriere/relance-requisitoire' })
  if (sansReq) lignes.unshift({ texte: `${sansReq} dossier(s) Parquet sans réquisitoire`, detail: 'Aucun état de frais ne peut partir sans lui.', niveau: 'urgent', lien: '/fourriere/relance-requisitoire' })
  const acc = (efs || []).filter((e: any) => e.status === 'accepte').length
  return { cle: 'ef', titre: 'États de frais', resume: `${acc} accepté(s) à déposer · ${sansReq} sans réquisitoire`, niveau: sansReq ? 'urgent' : acc ? 'attention' : 'ok', lignes, lien: '/fourriere/saisies' }
}

async function rapprochements(): Promise<Bloc> {
  const lignes: Ligne[] = []
  let total = 0
  for (const [label, c] of [['VD', ODOO_COMPANIES.vd], ['Riga', ODOO_COMPANIES.riga]] as const) {
    const l: any[] = await odooRpcCompany(c, 'account.bank.statement.line', 'search_read', [[['is_reconciled', '=', false]]], { fields: ['amount', 'payment_ref'], limit: 1000 })
    total += l.length
    const sumup = l.filter(x => /sumup/i.test(x.payment_ref || '')), payno = l.filter(x => /paynovate/i.test(x.payment_ref || ''))
    lignes.push({ texte: `${label} : ${l.length} ligne(s) de banque non rapprochée(s)`, detail: [sumup.length && `SumUp ${sumup.length} (${sumup.reduce((t, x) => t + x.amount, 0).toFixed(2)} €)`, payno.length && `Paynovate ${payno.length}`].filter(Boolean).join(' · ') || undefined, niveau: sumup.length || payno.length ? 'attention' : 'info', lien: '/finance/reconciliation' })
  }
  return { cle: 'rappro', titre: 'Rapprochements', resume: `${total} ligne(s) ouvertes`, niveau: total ? 'attention' : 'ok', lignes, lien: '/finance/reconciliation' }
}

async function paiements(sb: any): Promise<Bloc> {
  const { SOCIETES, aTrier } = await import('@/lib/paiements/fournisseurs')
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
  const lignes: Ligne[] = []
  let nb = 0
  for (const s of SOCIETES) {
    const t = await aTrier(s.id)
    const { count } = await sb.from('paiements_attente').select('id', { count: 'exact', head: true }).eq('company_id', s.id).eq('statut', 'attente')
    const retard = t.filter(f => f.due_date && f.due_date < today).length
    nb += t.length
    lignes.push({ texte: `${s.label} : ${t.length} à trier${retard ? ` (${retard} en retard)` : ''} · ${count || 0} dans la liste d’attente`, niveau: retard ? 'attention' : 'info', lien: '/paiements' })
  }
  return { cle: 'paiements', titre: 'Paiements fournisseurs', resume: `${nb} facture(s) à trier`, niveau: nb ? 'attention' : 'ok', lignes, lien: '/paiements' }
}

async function facturation(sb: any): Promise<Bloc> {
  const { readTodoCount } = await import('@/lib/dossier/todo-count')
  const t = await readTodoCount(sb)
  const n = t?.count ?? 0
  return { cle: 'facturation', titre: 'Facturation', resume: `${n} dossier(s) à facturer`, niveau: n ? 'attention' : 'ok', lignes: [{ texte: `${n} dossier(s) « à facturer »`, detail: t?.at ? `compté le ${new Date(t.at).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', dateStyle: 'short', timeStyle: 'short' })}` : undefined, niveau: n ? 'attention' : 'ok', lien: '/facturation' }], lien: '/facturation' }
}

async function fourriere(sb: any): Promise<Bloc> {
  const [{ count: parc }, { count: levees }] = await Promise.all([
    sb.from('incoming_missions').select('id', { count: 'exact', head: true }).eq('status', 'parked'),
    sb.from('requisitoire_intake').select('id', { count: 'exact', head: true }).in('status', ['pending', 'to_verify']),
  ])
  const lignes: Ligne[] = [
    { texte: `${parc || 0} véhicule(s) au parc`, niveau: 'info', lien: '/fourriere/parc' },
    { texte: `${levees || 0} réquisitoire(s) ou levée(s) à rattacher`, niveau: levees ? 'attention' : 'ok', lien: '/fourriere/requisitoires' },
  ]
  return { cle: 'fourriere', titre: 'Fourrière', resume: `${levees || 0} document(s) à rattacher`, niveau: levees ? 'attention' : 'ok', lignes, lien: '/fourriere' }
}

async function cloture(sb: any): Promise<Bloc> {
  const since = new Date(Date.now() - 30 * 864e5).toISOString()
  const { data } = await sb.from('agent_proposals').select('kind, status, direct').gte('created_at', since).limit(5000)
  const g: Record<string, { ok: number; seul: number; corr: number; ref: number }> = {}
  for (const p of data || []) {
    const k = p.kind; g[k] ||= { ok: 0, seul: 0, corr: 0, ref: 0 }
    if (p.status === 'executed') p.direct ? g[k].seul++ : g[k].ok++
    else if (p.status === 'returned') g[k].corr++
    else if (p.status === 'refused') g[k].ref++
  }
  const { KIND_LABEL } = await import('@/lib/agents/core').catch(() => ({ KIND_LABEL: {} as Record<string, string> })) as any
  const lignes: Ligne[] = Object.entries(g).sort((a, b) => (b[1].ok + b[1].seul) - (a[1].ok + a[1].seul)).map(([k, v]) => ({
    texte: (KIND_LABEL && KIND_LABEL[k]) || k,
    detail: `validées ${v.ok} · faites seules ${v.seul} · corrigées ${v.corr} · refusées ${v.ref}`,
    niveau: v.ok >= 10 && !v.corr && !v.ref ? 'attention' : 'info',
  }))
  const cand = lignes.filter(l => l.niveau === 'attention').length
  return { cle: 'cloture', titre: 'Autonomie des agents (30 j)', resume: cand ? `${cand} type(s) candidat(s) à l’autonomie` : 'Suivi des validations', niveau: 'info', lignes }
}

export async function bureauDuJour(): Promise<Bloc[]> {
  const sb = createAdminClient()
  const defs: [string, string, () => Promise<Bloc>][] = [
    ['agents', 'Agents (24 h)', () => agentsNuit(sb)],
    ['decisions', 'Décisions des agents', () => decisions(sb)],
    ['mails', 'Mails', () => mails()],
    ['domaine', 'Domaine', () => domaine(sb)],
    ['ef', 'États de frais', () => etatsFrais(sb)],
    ['rappro', 'Rapprochements', () => rapprochements()],
    ['paiements', 'Paiements fournisseurs', () => paiements(sb)],
    ['facturation', 'Facturation', () => facturation(sb)],
    ['fourriere', 'Fourrière', () => fourriere(sb)],
    ['cloture', 'Autonomie des agents (30 j)', () => cloture(sb)],
  ]
  const res = await Promise.allSettled(defs.map(([, , f]) => f()))
  return res.map((r, i) => r.status === 'fulfilled' ? r.value
    : { cle: defs[i][0], titre: defs[i][1], resume: 'Indisponible', niveau: 'urgent' as Niveau, lignes: [], erreur: String((r.reason as any)?.message || r.reason).slice(0, 200) })
}
