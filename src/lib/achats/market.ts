// ============================================================
// VERVIERS DÉPANNAGE — Découverte de fournisseurs (base marché, brique 4a)
// ------------------------------------------------------------
// Claude + recherche web : propose des fournisseurs/concurrents pour une
// catégorie d'achat. Résultats marqués « à vérifier » — jamais utilisés sans
// validation humaine (évite l'hallucination de contacts).
// ============================================================

import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_MODEL } from '@/lib/anthropic-model'

let _client: Anthropic | null = null
const getClient = () => (_client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }))

export interface MarketCandidate { name: string; website: string | null; email: string | null; phone: string | null; region: string | null; why: string }

export async function discoverSuppliers(category: string, region = 'Belgique, de préférence région de Verviers / Liège / Wallonie', exclude: string[] = []): Promise<MarketCandidate[]> {
  const prompt = `Tu constitues une base de FOURNISSEURS pour une société de DÉPANNAGE / REMORQUAGE automobile basée à Verviers (Belgique).
Trouve, via la RECHERCHE WEB, des fournisseurs réels pour la catégorie d'achat : « ${category} ».
Zone : ${region}.
${exclude.length ? `Ne propose PAS ces fournisseurs (déjà connus) : ${exclude.join(', ')}.` : ''}

Contraintes :
- Uniquement des entreprises RÉELLES et vérifiables (cite implicitement via la recherche). Si tu n'es pas sûr d'un contact, laisse-le à null plutôt que d'inventer.
- Priorité aux fournisseurs pertinents pour l'activité (pièces, pneus, carburant, matériel, etc. selon la catégorie).

Réponds UNIQUEMENT par un objet JSON (aucun texte autour) :
{ "candidates": [ { "name": "...", "website": "... ou null", "email": "... ou null", "phone": "... ou null", "region": "ville/région ou null", "why": "1 phrase: pourquoi pertinent" } ] }
Max 8 candidats, les plus pertinents.`

  const response = await getClient().messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 4096,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 } as any],
    messages: [{ role: 'user', content: prompt }],
  })

  // Concatène les blocs texte (le web search en insère plusieurs) et isole le JSON.
  const text = response.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
  const s = text.indexOf('{'), e = text.lastIndexOf('}')
  if (s < 0 || e < 0) return []
  let parsed: any
  try { parsed = JSON.parse(text.slice(s, e + 1)) } catch { return [] }
  return (Array.isArray(parsed.candidates) ? parsed.candidates : []).slice(0, 8).map((c: any): MarketCandidate => ({
    name:    String(c.name || '').slice(0, 120),
    website: c.website ? String(c.website).slice(0, 200) : null,
    email:   c.email ? String(c.email).slice(0, 120) : null,
    phone:   c.phone ? String(c.phone).slice(0, 40) : null,
    region:  c.region ? String(c.region).slice(0, 80) : null,
    why:     String(c.why || '').slice(0, 200),
  })).filter((c: MarketCandidate) => c.name)
}
