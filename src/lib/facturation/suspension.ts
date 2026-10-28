// src/lib/facturation/suspension.ts
//
// INTERRUPTEUR GÉNÉRAL de la facturation automatique (Olivier 26/10/2026 : « Je veux pouvoir mettre en off et en on
// quand je veux. Pas spécialement mettre de date de début et de date de fin. »).
//
// Off : rien ne part tout seul — auto-invoice (factures et commissions), circuit-auto-invoice, circuit-race-invoice,
// auto-close-allianz, auto-accept-comex ; checkAutoInvoiceEligible répond « suspendue ». Les règles par source ne
// bougent pas : l'interrupteur passe au-dessus.
// On : tout reprend. Rattrapage sans oubli ni doublon : chaque automatisation reprend son arriéré (« pas encore
// facturé / clôturé / validé ») et rien n'est marqué pendant la suspension ; une mission qui a déjà sa facture est
// toujours écartée.
// Chaque bascule est inscrite au journal (facturation_auto_journal : qui, quand, motif).

import { getAutomationEnabled, setAutomationEnabled, AUTOMATION_FLAGS } from '@/lib/facturation/automation-flags'

export interface EtatFacturationAuto {
  enMarche: boolean
  /** Dernière bascule connue (journal). */
  depuis: string | null
  par: string | null
  motif: string | null
}

export interface LigneJournal { id: number; action: 'suspension' | 'reprise' | 'refus'; par_nom: string | null; motif: string | null; at: string }

/** true = la facturation automatique est suspendue : interrupteur « Mes assistants » ou son bloc à lui. */
export async function facturationAutoSuspendue(sb: any): Promise<boolean> {
  return assistantEnPause(sb, 'facturation')
}

// « MES ASSISTANTS » (Olivier 28/10/2026 : « tu restes mon assistant à moi et non pas à Verviers Dépannage, donc tout
// ce qu'on fait doit être désactivable quand je ne travaille pas ou quand je le décide » ; « ça doit être le même
// interrupteur, la facturation auto fait partie de mes assistants »). Le même bouton met en pause tout ce qui travaille
// TOUT SEUL pour lui : facturation automatique, agents (Victor, Aurélie, Justine…), Mobia, Agent Mail, Circuit (fiches,
// agendas), comptes d'achat, et ses notifications Telegram (gardées, envoyées à la reprise). Ce qu'une personne fait à
// la main (dans VD Soft ou en session avec Claude) n'est jamais bloqué. Restent en marche, outils de l'équipe : Sam et
// Sonic, Max, l'arrivée des missions des assistances, le contrôle du parc.
// Option « pause automatique en dehors de mes heures » (réglage assistants_pause_hors_heures, oui / non) : hors des
// heures VD de Mobi (mobiEnHeuresVD), comme une pause.

export async function pauseManuelle(sb: any): Promise<boolean> {
  return !(await getAutomationEnabled(sb, AUTOMATION_FLAGS.facturationAuto, true))
}

export async function pauseHorsHeuresActive(sb: any): Promise<boolean> {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'assistants_pause_hors_heures').maybeSingle()
  return /oui|true/i.test(String(data?.value || ''))
}

export async function definirPauseHorsHeures(sb: any, active: boolean, par: { id?: string | null; nom?: string | null }): Promise<void> {
  if (!(await peutBasculer(par.id))) { await noterRefus(sb, par, active); throw new Error('NON_AUTORISE') }
  await sb.from('app_settings').upsert({ key: 'assistants_pause_hors_heures', value: JSON.stringify(active ? 'oui' : 'non') }, { onConflict: 'key' })
  await sb.from('facturation_auto_journal').insert({ action: active ? 'suspension' : 'reprise', par_id: par.id || null, par_nom: par.nom || null, motif: active ? 'Option activée : pause automatique en dehors des heures' : 'Option désactivée : plus de pause automatique en dehors des heures' })
}

/** true = les assistants de Mobi ne travaillent pas tout seuls en ce moment (pause manuelle, ou hors heures avec l'option). */
export async function assistantsEnPause(sb: any): Promise<boolean> {
  if (await pauseManuelle(sb)) return true
  if (!(await pauseHorsHeuresActive(sb))) return false
  const { mobiEnHeuresVD } = await import('@/lib/notif/heures-mobi')
  return !(await mobiEnHeuresVD())
}

// Chaque bloc se met aussi en pause seul (Olivier 28/10/2026 : « chaque bloc est cliquable pour activer ou désactiver
// indépendamment ») : réglage assistants_pauses = { <clé>: true } pour les blocs en pause.
export const ASSISTANTS = [
  { cle: 'facturation',    nom: 'Facturation automatique', role: 'Factures des fiches clôturées, factures SEL (Aurélie), relances, clôtures Allianz, validations Touring' },
  { cle: 'relances',       nom: 'Relances clients',        role: 'Rappels de paiement J+15 / J+30 depuis administration@ (jamais au Parquet)' },
  { cle: 'rapprochement',  nom: 'Rapprochement des paiements', role: 'Lettrage des avis de paiement des assistances quand tout concorde avec la banque' },
  { cle: 'parc',           nom: 'Alertes du parc',         role: 'Véhicules oubliés en Transit, réquisitoires sans véhicule (chaque matin)' },
  { cle: 'victor',         nom: 'Victor',                  role: 'Comptabilité, échanges avec Maureen' },
  { cle: 'agents',         nom: 'Florent, Rémi et les autres agents', role: 'Banque, factures d’achat, propositions à valider' },
  { cle: 'agent_mail',     nom: 'Justine (Agent Mail)',    role: 'Tri des mails d’info@ et d’administration@' },
  { cle: 'mobia',          nom: 'Mobia',                   role: 'Dossier Claudy' },
  { cle: 'circuit',        nom: 'Circuit de Spa',          role: 'Fiches de réservation, agendas d’info@ et de Mobi' },
  { cle: 'comptes_achats', nom: 'Comptes d’achat',         role: 'Bon compte sur chaque facture d’achat, reclassement du mois' },
  { cle: 'telegram',       nom: 'Notifications Telegram',  role: 'Tes alertes et demandes de validation, gardées pendant la pause' },
] as const
export type CleAssistant = typeof ASSISTANTS[number]['cle']

export async function pausesIndividuelles(sb: any): Promise<Partial<Record<CleAssistant, boolean>>> {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'assistants_pauses').maybeSingle()
  try { const v = typeof data?.value === 'string' ? JSON.parse(data.value) : data?.value; return v && typeof v === 'object' ? v : {} } catch { return {} }
}

/** true = ce bloc ne travaille pas tout seul en ce moment (pause générale, ou ce bloc en pause). */
export async function assistantEnPause(sb: any, cle: CleAssistant): Promise<boolean> {
  if (await assistantsEnPause(sb)) return true
  return !!(await pausesIndividuelles(sb))[cle]
}

export async function basculerAssistant(sb: any, cle: CleAssistant, enMarche: boolean, par: { id?: string | null; nom?: string | null }, motif?: string | null): Promise<{ change: boolean }> {
  const a = ASSISTANTS.find(x => x.cle === cle); if (!a) throw new Error('Assistant inconnu')
  if (!(await peutBasculer(par.id))) { await noterRefus(sb, par, enMarche); throw new Error('NON_AUTORISE') }
  const p = await pausesIndividuelles(sb)
  if (!p[cle] === enMarche) return { change: false }
  if (enMarche) delete p[cle]; else p[cle] = true
  await sb.from('app_settings').upsert({ key: 'assistants_pauses', value: JSON.stringify(p) }, { onConflict: 'key' })
  await sb.from('facturation_auto_journal').insert({ action: enMarche ? 'reprise' : 'suspension', par_id: par.id || null, par_nom: par.nom || null, motif: `${a.nom} ${enMarche ? 'relancé' : 'mis en pause'}${motif ? ` — ${String(motif).slice(0, 250)}` : ''}` })
  return { change: true }
}

/** Bloc d'un agent du village, d'après son nom ou son identifiant (« aurelie », « Victor »…). */
export function blocDeLAgent(nom?: string | null): CleAssistant {
  const n = String(nom || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/victor/.test(n)) return 'victor'
  if (/justine/.test(n)) return 'agent_mail'
  if (/aurelie/.test(n)) return 'facturation'
  if (/mobia/.test(n)) return 'mobia'
  return 'agents'
}

/** Agent du village qui veut ÉCRIRE dans VD Soft pendant la pause : refusé (423), il peut toujours lire. */
export async function refusAgentEnPause(agent: { name?: string | null }): Promise<Response | null> {
  const { createAdminClient } = await import('@/lib/supabase')
  const cle = blocDeLAgent(agent?.name)
  if (!(await assistantEnPause(createAdminClient(), cle))) return null
  return new Response(JSON.stringify({ error: 'En pause : Mobi a mis ses assistants en pause. Rien n’est fait ; réessaie plus tard.', pause: true }), { status: 423, headers: { 'Content-Type': 'application/json' } })
}

/** Reprise d'un bloc : son passage tourne tout de suite (mêmes routes que les crons, mêmes garde-fous anti-doublon). */
const PASSAGES: Partial<Record<CleAssistant, string[]>> = {
  circuit: ['/api/cron/circuit-fiches', '/api/cron/circuit-agenda'],
  comptes_achats: ['/api/cron/comptes-achats'],
  agent_mail: ['/api/cron/mail-agent'],
  mobia: ['/api/cron/mobia'],
}
export async function relancerBlocs(sb: any, cles: CleAssistant[]): Promise<void> {
  const base = (process.env.NEXTAUTH_URL || '').replace(/\/$/, '')
  if (!base || !process.env.CRON_SECRET) return
  if (cles.includes('facturation')) await rattraperApresReprise(sb).catch(() => null)
  for (const c of cles) for (const path of PASSAGES[c] || [])
    await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }, cache: 'no-store' }).catch(() => null)
}

/** Ce qui attend pendant la pause, par bloc (affiché sous chaque bloc). */
export async function enAttente(sb: any): Promise<Partial<Record<CleAssistant, string>>> {
  const out: Partial<Record<CleAssistant, string>> = {}
  const [m, t] = await Promise.all([
    sb.from('incoming_missions').select('id', { count: 'exact', head: true }).eq('status', 'to_invoice'),
    sb.from('telegram_differes').select('id', { count: 'exact', head: true }),
  ])
  if (m.count) out.facturation = `${m.count} fiche${m.count > 1 ? 's' : ''} clôturée${m.count > 1 ? 's' : ''} à facturer`
  if (t.count) out.telegram = `${t.count} message${t.count > 1 ? 's' : ''} gardé${t.count > 1 ? 's' : ''}`
  return out
}

/** Réponse type d'un cron d'assistant sauté pendant la pause. */
export const SKIP_PAUSE = { ok: true, skipped: 'assistants de Mobi en pause (interrupteur « Mes assistants »)' }

export async function etatFacturationAuto(sb: any): Promise<EtatFacturationAuto> {
  const enMarche = await getAutomationEnabled(sb, AUTOMATION_FLAGS.facturationAuto, true)
  const { data } = await sb.from('facturation_auto_journal').select('action, par_nom, motif, at').neq('action', 'refus').order('at', { ascending: false }).limit(1)
  const last = data?.[0]
  return { enMarche, depuis: last?.at || null, par: last?.par_nom || null, motif: last?.motif || null }
}

export async function journalFacturationAuto(sb: any, limit = 20): Promise<LigneJournal[]> {
  const { data } = await sb.from('facturation_auto_journal').select('id, action, par_nom, motif, at').order('at', { ascending: false }).limit(limit)
  return (data || []) as LigneJournal[]
}

/** Seul Olivier bascule l'interrupteur (« Il n'y a que moi qui dois avoir accès à ce bouton », 26/10/2026). */
export async function peutBasculer(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false
  const { getBusinessList } = await import('@/lib/settings/business')
  const ids = await getBusinessList('facturation_auto_interrupteur_user_ids').catch(() => [] as string[])
  return ids.includes(String(userId))
}

/** Tentative refusée : notée au journal (qui, quand, ce qu'il voulait faire). */
export async function noterRefus(sb: any, par: { id?: string | null; nom?: string | null }, voulu: boolean): Promise<void> {
  await sb.from('facturation_auto_journal').insert({ action: 'refus', par_id: par.id || null, par_nom: par.nom || null, motif: `Tentative refusée : ${voulu ? 'relancer' : 'suspendre'} la facturation automatique (compte non autorisé)` })
}

/** Bascule l'interrupteur et l'inscrit au journal. Sans effet (ni ligne de journal) si l'état est déjà le bon. */
export async function basculerFacturationAuto(sb: any, enMarche: boolean, par: { id?: string | null; nom?: string | null }, motif?: string | null): Promise<{ change: boolean }> {
  // Contrôle dans l'action elle-même, pas seulement dans la route : aucun chemin ne contourne la règle.
  if (!(await peutBasculer(par.id))) { await noterRefus(sb, par, enMarche); throw new Error('NON_AUTORISE') }
  const actuel = !(await pauseManuelle(sb))
  if (actuel === enMarche) return { change: false }
  await setAutomationEnabled(sb, AUTOMATION_FLAGS.facturationAuto, enMarche)
  const { error } = await sb.from('facturation_auto_journal').insert({
    action: enMarche ? 'reprise' : 'suspension', par_id: par.id || null, par_nom: par.nom || null,
    motif: String(motif || '').trim().slice(0, 300) || null,
  })
  if (error) throw new Error(`Journal : ${error.message}`)
  return { change: true }
}

/** Réponse type d'un cron sauté pendant la suspension. */
export const SKIP_SUSPENDUE = { ok: true, skipped: 'facturation automatique suspendue (interrupteur général)' }

export interface ResumeRattrapage { at: string; factures: number; sel: number; relances: number; allianz: number; comex: number; erreurs: string[] }

/**
 * Remise sur on (« Quand je réactive, il faut que tout se résorbe », Olivier 26/10/2026) : un passage IMMÉDIAT de
 * chaque automatisme (mêmes routes que les crons, mêmes garde-fous anti-doublon), puis le résumé à Olivier sur
 * Telegram et gardé pour son écran. Ce qu'un passage ne finit pas (plafonds par passage) part aux passages suivants ;
 * le circuit (facturé chaque matin à 9 h depuis le 28/10/2026, pour rester dans les heures de Mobi) rattrape au passage de 9 h.
 */
export async function rattraperApresReprise(sb: any): Promise<ResumeRattrapage> {
  const base = (process.env.NEXTAUTH_URL || '').replace(/\/$/, '')
  const out: ResumeRattrapage = { at: new Date().toISOString(), factures: 0, sel: 0, relances: 0, allianz: 0, comex: 0, erreurs: [] }
  const appel = async (path: string) => {
    try {
      const r = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }, cache: 'no-store' })
      return await r.json().catch(() => ({}))
    } catch (e: any) { out.erreurs.push(`${path} : ${e?.message || e}`); return {} }
  }
  if (!base || !process.env.CRON_SECRET) { out.erreurs.push('adresse de l’app ou secret des tâches absent'); return out }
  const inv = await appel('/api/cron/auto-invoice');           out.factures = Number(inv?.invoiced) || 0
  const sel = await appel('/api/cron/aurelie-sel');            out.sel = Array.isArray(sel?.validees) ? sel.validees.length : 0
  const pay = await appel('/api/cron/facturation-paiements');  out.relances = Number(pay?.reminders?.sent) || 0
  const alz = await appel('/api/cron/auto-close-allianz');     out.allianz = Number(alz?.closed) || 0
  const cmx = await appel('/api/cron/auto-accept-comex');      out.comex = Number(cmx?.accepted) || 0
  await sb.from('app_settings').upsert({ key: 'facturation_auto_dernier_rattrapage', value: JSON.stringify(out) }, { onConflict: 'key' }).then(() => {}, () => {})
  try {
    const { getBusinessNumber } = await import('@/lib/settings/business')
    const { notifierTelegram } = await import('@/lib/notif/heures-mobi')
    const chat = await getBusinessNumber('telegram_chat_mobi')
    await notifierTelegram(chat, texteRattrapage(out), [], undefined, { urgent: true })   // sa propre action : tout de suite
  } catch (e: any) { out.erreurs.push(`Telegram : ${e?.message || e}`) }
  return out
}

export function texteRattrapage(r: ResumeRattrapage): string {
  const n = (x: number, un: string, plus: string) => `${x} ${x > 1 ? plus : un}`
  return `▶️ Facturation automatique relancée. Rattrapage du premier passage : ${n(r.factures, 'facture', 'factures')}, ${n(r.sel, 'facture SEL', 'factures SEL')}, ${n(r.relances, 'relance', 'relances')}, ${n(r.allianz, 'clôture Allianz', 'clôtures Allianz')}, ${n(r.comex, 'validation Touring', 'validations Touring')}. `
    + `Le reste éventuel part aux passages suivants (toutes les 15 min) ; le circuit au passage de 9 h.${r.erreurs.length ? ` ⚠ ${r.erreurs.join(' · ')}` : ''}`
}
