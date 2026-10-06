// src/lib/agents/pause.ts
//
// Pause des agents décidée par Olivier dans le village (06/10/2026) : congé,
// client impayé… Chaque passage planifié d'un agent la consulte avant d'agir.
// Le village injoignable ne bloque jamais VD : on continue normalement.

import { journal } from './core'

export interface AgentPause { pause: boolean; motif?: string | null; retour?: string | null }

export async function agentPause(slug: string): Promise<AgentPause> {
  const url = process.env.MOBIOUEB_ADRESSE, secret = process.env.MOBIOUEB_EXTERNE_SECRET
  if (!url || !secret) return { pause: false }
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/api/externe/pause?agent=${encodeURIComponent(slug)}`, {
      headers: { Authorization: `Bearer ${secret}` }, cache: 'no-store', signal: AbortSignal.timeout(8000),
    })
    if (!r.ok) return { pause: false }
    const j = await r.json()
    return { pause: j?.pause === true, motif: j?.motif ?? null, retour: j?.retour ?? null }
  } catch { return { pause: false } }
}

/** true = en pause : une ligne neutre au journal, et le passage ne fait rien. */
export async function pausedAndLogged(slug: string, agent: string, what: string): Promise<boolean> {
  const p = await agentPause(slug)
  if (!p.pause) return false
  await journal({ agent, company: 1, action: 'en pause', detail: `${what} : rien n’est fait${p.motif ? ` (${p.motif})` : ''}${p.retour ? `, retour prévu ${p.retour}` : ''}.` })
  return true
}
