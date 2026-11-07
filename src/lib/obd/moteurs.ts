// src/lib/obd/moteurs.ts — quels moteurs pour ce modèle ? (Olivier 07/11/2026, maquette validée)
// Le boîtier ne donne pas le moteur. Sam cherche la liste une fois, elle est gardée ; les choix des chauffeurs la confirment
// et remontent en tête. Le carburant lu par le boîtier retire les moteurs impossibles. L'étape reste facultative.
import Anthropic from '@anthropic-ai/sdk'
import { randomUUID } from 'node:crypto'
import { aiClient } from '@/lib/ai/usage'
import { ANTHROPIC_MODEL } from '@/lib/anthropic-model'

export type FamilleMoteur = 'essence' | 'diesel' | 'hybride' | 'electrique' | 'gpl'
export interface OptionMoteur { id: string; label: string; carburant: FamilleMoteur | null; votes: string[] }

const FAMILLES: FamilleMoteur[] = ['essence', 'diesel', 'hybride', 'electrique', 'gpl']

/** Sam cherche les moteurs vendus en Europe pour ce modèle et cette année. Liste vide si rien de sûr. */
export async function samFindEngines(marque: string, modele: string, annee: number | null): Promise<{ options: OptionMoteur[]; source_url: string | null }> {
  const client = aiClient('obd/moteurs', { apiKey: process.env.ANTHROPIC_API_KEY! }) as Anthropic
  const res: any = await client.messages.create({
    model: ANTHROPIC_MODEL, max_tokens: 1200,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 } as any],
    messages: [{ role: 'user', content: `Un dépanneur veut identifier le moteur de ce véhicule vendu en Europe : ${String(marque).slice(0, 40)} ${String(modele).slice(0, 60)}${annee ? `, année ${annee}` : ''}.
Cherche dans une fiche technique en ligne les moteurs proposés sur ce modèle cette année-là. Réponds en JSON STRICT, sans texte autour :
{"trouve":true,"moteurs":[{"label":"1.5 diesel, 100 ch","carburant":"essence|diesel|hybride|electrique|gpl"}],"source_url":"adresse de la page utilisée"}
Libellé court : cylindrée, carburant, puissance en ch. 12 moteurs au maximum. Si tu ne trouves rien de sûr sur ce modèle précis, réponds {"trouve":false}. Ne devine pas.` }],
  })
  const blocks: any[] = res.content || []
  const urls = new Set<string>()
  for (const b of blocks) if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const r of b.content) if (r?.url) urls.add(String(r.url))
  const m = blocks.filter(b => b.type === 'text').map(b => b.text).join('').match(/\{[\s\S]*\}/)
  if (!m) return { options: [], source_url: null }
  let j: any; try { j = JSON.parse(m[0]) } catch { return { options: [], source_url: null } }
  if (!j.trouve || !Array.isArray(j.moteurs)) return { options: [], source_url: null }
  const vus = new Set<string>()
  const options = j.moteurs.slice(0, 12).map((x: any) => ({ id: randomUUID(), label: String(x?.label || '').trim().slice(0, 60), carburant: FAMILLES.includes(x?.carburant) ? x.carburant : null, votes: [] as string[] }))
    .filter((o: OptionMoteur) => o.label && !vus.has(o.label) && vus.add(o.label))
  return { options, source_url: urls.has(String(j.source_url)) ? String(j.source_url) : null }
}

/** Retire les moteurs impossibles, choix des chauffeurs en tête. Déduit de l'allumage, « essence » n'exclut ni l'hybride ni le GPL. */
export function filtrerMoteurs(options: OptionMoteur[], famille: FamilleMoteur | null, source: string | null): OptionMoteur[] {
  const permis = !famille ? null : source === 'allumage' ? (famille === 'essence' ? ['essence', 'hybride', 'gpl'] : ['diesel', 'hybride']) : [famille]
  const gardes = permis ? options.filter(o => !o.carburant || permis.includes(o.carburant)) : options
  return [...(gardes.length ? gardes : options)].sort((a, b) => (b.votes?.length || 0) - (a.votes?.length || 0))
}

/** Carburant lu par le boîtier → famille de la liste. */
export function familleDepuisLecture(c: string | null | undefined): FamilleMoteur | null {
  const t = String(c || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (!t) return null
  if (/hybride|electrique et thermique/.test(t)) return 'hybride'
  if (/gpl/.test(t)) return 'gpl'
  if (/electrique/.test(t)) return 'electrique'
  if (/diesel/.test(t)) return 'diesel'
  if (/essence/.test(t)) return 'essence'
  return null
}
