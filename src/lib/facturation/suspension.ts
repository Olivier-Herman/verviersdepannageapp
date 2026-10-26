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

/** true = la facturation automatique est suspendue (interrupteur général sur off). */
export async function facturationAutoSuspendue(sb: any): Promise<boolean> {
  return !(await getAutomationEnabled(sb, AUTOMATION_FLAGS.facturationAuto, true))
}

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
  const actuel = await getAutomationEnabled(sb, AUTOMATION_FLAGS.facturationAuto, true)
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
 * le circuit (facturé chaque matin à 7 h) rattrape au passage de 7 h.
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
    + `Le reste éventuel part aux passages suivants (toutes les 15 min) ; le circuit au passage de 7 h.${r.erreurs.length ? ` ⚠ ${r.erreurs.join(' · ')}` : ''}`
}
