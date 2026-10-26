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
