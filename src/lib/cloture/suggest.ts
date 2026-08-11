// src/lib/cloture/suggest.ts
//
// Priorisation des motifs de clôture par l'IA (Olivier 2026-08-11).
//
// QUAND : à la clôture, APRÈS le choix de l'issue — c'est seulement là qu'on
// connaît la branche (mobilité rétablie / remorquage). Un pré-calcul au dispatch
// ne marche pas : le dispatch ignore la décision du chauffeur.
//
// CE QU'ELLE FAIT : elle lit la description de panne fournie par l'assistance et
// remonte 5-6 motifs en tête de liste. Elle NE choisit PAS : le chauffeur valide.
//
// CE QU'ELLE NE PEUT PAS FAIRE : inventer un code. Elle ne renvoie que des CLÉS
// du catalogue de la branche demandée ; tout ce qui n'est pas une clé connue est
// jeté. Impossible d'envoyer un code fantaisiste à l'assistance.
//
// Si l'appel échoue ou traîne (> 4 s), on retombe sur le tri par mots-clés : la
// liste complète reste utilisable, juste un peu moins bien triée.

import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_CHEAP_MODELS, ANTHROPIC_MODELS, createWithModelFallback } from '@/lib/anthropic-model'
import { motifsForBranch, suggestByKeywords } from './motifs'
import type { Branch } from './outcomes'

const TIMEOUT_MS = 4000
const MODELS = [...ANTHROPIC_CHEAP_MODELS, ...ANTHROPIC_MODELS]

let _client: Anthropic | null = null
function client(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  return (_client ??= new Anthropic({ apiKey }))
}

export interface SuggestInput {
  branch: Branch
  /** Description de panne fournie par l'assistance (incident_description). */
  description?: string | null
  brand?: string | null
  model?: string | null
}

export interface SuggestResult {
  keys: string[]
  /** 'ia' = priorisé par Claude · 'mots-cles' = repli local. */
  via: 'ia' | 'mots-cles'
}

export async function suggestMotifs(input: SuggestInput, limit = 6): Promise<SuggestResult> {
  const fallback: SuggestResult = { keys: suggestByKeywords(input.branch, input.description, limit), via: 'mots-cles' }

  const text = String(input.description || '').trim()
  const c = client()
  if (!text || !c) return fallback

  const catalogue = motifsForBranch(input.branch)
    .filter(m => !m.catchAll)
    .map(m => `${m.key} = ${m.label}`)
    .join('\n')

  const prompt = [
    `Un dépanneur clôture une intervention. Voici ce que l'assistance a annoncé comme panne :`,
    `"""${text.slice(0, 1200)}"""`,
    input.brand || input.model ? `Véhicule : ${[input.brand, input.model].filter(Boolean).join(' ')}` : '',
    ``,
    input.branch === 'mobilite'
      ? `Le véhicule REPART (dépannage réussi sur place). Classe les motifs de réparation les plus probables.`
      : `Le véhicule NE REPART PAS et part en remorquage. Classe les causes de panne les plus probables.`,
    ``,
    `Motifs disponibles (clé = libellé) :`,
    catalogue,
    ``,
    `Réponds UNIQUEMENT avec un tableau JSON des ${limit} clés les plus probables, la plus probable en premier.`,
    `Exemple de réponse : ["cle_a","cle_b"]`,
    `N'invente aucune clé : utilise exclusivement celles de la liste.`,
  ].filter(Boolean).join('\n')

  try {
    const res: any = await Promise.race([
      createWithModelFallback(c as any, MODELS, {
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)),
    ])

    const raw = (res?.content || []).map((b: any) => (b?.type === 'text' ? b.text : '')).join('')
    const m = raw.match(/\[[\s\S]*?\]/)
    if (!m) return fallback

    const parsed = JSON.parse(m[0])
    if (!Array.isArray(parsed)) return fallback

    // Garde-fou : on ne retient que des clés RÉELLES de la branche demandée.
    const valid = new Set(motifsForBranch(input.branch).filter(x => !x.catchAll).map(x => x.key))
    const keys: string[] = []
    for (const k of parsed) {
      const key = String(k || '').trim()
      if (valid.has(key) && !keys.includes(key)) keys.push(key)
      if (keys.length >= limit) break
    }
    if (keys.length === 0) return fallback

    // Complète avec le repli si l'IA a été avare.
    for (const k of fallback.keys) { if (keys.length >= limit) break; if (!keys.includes(k)) keys.push(k) }
    return { keys, via: 'ia' }
  } catch {
    return fallback
  }
}
