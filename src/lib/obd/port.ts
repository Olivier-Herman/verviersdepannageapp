// src/lib/obd/port.ts — où est la prise OBD sur ce modèle ? (Olivier 06/11/2026, maquette validée)
// Ce qu'un chauffeur a confirmé passe toujours avant. Sinon Sam cherche dans la documentation en ligne, cite sa source
// et l'indication reste « à confirmer » : elle peut être fausse. Rien de trouvé : l'app montre les endroits courants.
import Anthropic from '@anthropic-ai/sdk'
import { aiClient } from '@/lib/ai/usage'
import { ANTHROPIC_MODEL } from '@/lib/anthropic-model'

export const modelKey = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()

export interface SamPort { marque: string; modele: string; fr: string; sq: string; source_url: string | null }

/** Sam cherche l'emplacement. null si rien de sûr. La source n'est gardée que si elle vient vraiment de la recherche. */
export async function samFindPort(text: string): Promise<SamPort | null> {
  const client = aiClient('obd/prise', { apiKey: process.env.ANTHROPIC_API_KEY! }) as Anthropic
  const res: any = await client.messages.create({
    model: ANTHROPIC_MODEL, max_tokens: 1200,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 } as any],
    messages: [{ role: 'user', content: `Un dépanneur cherche la prise de diagnostic OBD de ce véhicule, vendu en Europe : « ${String(text).slice(0, 80)} ».
Cherche dans la documentation en ligne où elle se trouve sur ce modèle. Réponds en JSON STRICT, sans texte autour :
{"trouve":true,"marque":"…","modele":"… avec la génération si tu la connais","fr":"emplacement en une phrase courte et concrète, vu du siège conducteur","sq":"la même phrase en albanais simple","source_url":"adresse de la page utilisée"}
Si tu ne trouves pas d'information sur ce modèle précis, ou si le texte n'est pas un véhicule, réponds {"trouve":false}. Ne devine pas.` }],
  })
  const blocks: any[] = res.content || []
  const urls = new Set<string>()
  for (const b of blocks) if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const r of b.content) if (r?.url) urls.add(String(r.url))
  const txt = blocks.filter(b => b.type === 'text').map(b => b.text).join('')
  const m = txt.match(/\{[\s\S]*\}/)
  if (!m) return null
  let j: any; try { j = JSON.parse(m[0]) } catch { return null }
  if (!j.trouve || !j.fr || !j.sq || !j.modele) return null
  return { marque: String(j.marque || ''), modele: String(j.modele), fr: String(j.fr).slice(0, 200), sq: String(j.sq).slice(0, 200), source_url: urls.has(String(j.source_url)) ? String(j.source_url) : null }
}
