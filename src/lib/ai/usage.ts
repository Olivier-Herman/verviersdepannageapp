// src/lib/ai/usage.ts
//
// Compteur unique de la consommation d'IA (Olivier 03/10/2026) : chaque appel
// au service d'IA laisse une ligne dans `conso_ia` (fonction, déclencheur,
// modèle, jetons, coût, réf, succès ou erreur). Mesure du 03/10 : rien n'était
// journalisé, une boucle a pu tourner des jours sans se voir.
//
// Usage :
//   const client = aiClient('mail-agent/triage')       // au lieu de new Anthropic()
//   await withAiContext({ declencheur: 'cron:mail-agent' }, () => run())
//   recordAiUsage({...})                               // appels faits en fetch
//
// Jamais bloquant : un échec du compteur n'empêche pas l'appel.

import Anthropic from '@anthropic-ai/sdk'
import { AsyncLocalStorage } from 'async_hooks'
import { createAdminClient } from '@/lib/supabase'

type Ctx = { declencheur?: string | null; ref?: string | null }
const als = new AsyncLocalStorage<Ctx>()

/** Donne un déclencheur (et une réf) à tous les appels d'IA faits dans fn. */
export function withAiContext<T>(ctx: Ctx, fn: () => Promise<T>): Promise<T> {
  return als.run({ ...(als.getStore() || {}), ...ctx }, fn)
}

// Tarifs du service d'IA, USD par million de jetons : entrée, sortie (réflexion
// comprise), lecture du cache, écriture du cache (5 min).
function price(model: string): { in: number; out: number; cr: number; cw: number } {
  const m = String(model || '').toLowerCase()
  if (m.includes('haiku')) return { in: 1, out: 5, cr: 0.1, cw: 1.25 }
  if (m.includes('sonnet')) return { in: 3, out: 15, cr: 0.3, cw: 3.75 }
  if (m.includes('opus-5-5')) return { in: 4, out: 20, cr: 0.2, cw: 5 }
  return { in: 5, out: 25, cr: 0.5, cw: 6.25 }   // opus 4.8, opus 5 et défaut
}

export function aiCost(model: string, u: { entree?: number; sortie?: number; cache_lu?: number; cache_ecrit?: number }): number {
  const p = price(model)
  const usd = ((u.entree || 0) * p.in + (u.sortie || 0) * p.out + (u.cache_lu || 0) * p.cr + (u.cache_ecrit || 0) * p.cw) / 1e6
  return Math.round(usd * 100000) / 100000
}

export async function recordAiUsage(r: { fonction: string; modele?: string | null; usage?: any; ok?: boolean; erreur?: string | null; ref?: string | null; dureeMs?: number }): Promise<void> {
  try {
    const u = r.usage || {}
    const row = {
      fonction: r.fonction, declencheur: als.getStore()?.declencheur || null, modele: r.modele || null,
      entree: u.input_tokens || 0, sortie: u.output_tokens || 0,
      cache_lu: u.cache_read_input_tokens || 0, cache_ecrit: u.cache_creation_input_tokens || 0,
      ref: r.ref || als.getStore()?.ref || null, ok: r.ok !== false, erreur: r.erreur ? String(r.erreur).slice(0, 300) : null,
      duree_ms: r.dureeMs ?? null,
    }
    await createAdminClient().from('conso_ia').insert({ ...row, cout_usd: aiCost(row.modele || '', row) })
  } catch { /* compteur seulement */ }
}

/** Client du service d'IA qui journalise chaque messages.create dans conso_ia. */
export function aiClient(fonction: string, opts: ConstructorParameters<typeof Anthropic>[0] = {}): Anthropic {
  const client = new Anthropic(opts)
  const create = client.messages.create.bind(client.messages)
  ;(client.messages as any).create = async (params: any, reqOpts?: any) => {
    const t0 = Date.now()
    try {
      const res: any = await (create as any)(params, reqOpts)
      await recordAiUsage({ fonction, modele: res?.model || params?.model, usage: res?.usage, dureeMs: Date.now() - t0 })
      return res
    } catch (e: any) {
      await recordAiUsage({ fonction, modele: params?.model, ok: false, erreur: e?.message || String(e), dureeMs: Date.now() - t0 })
      throw e
    }
  }
  return client
}
