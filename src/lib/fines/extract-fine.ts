// src/lib/fines/extract-fine.ts
//
// OCR d'un PV / amende scanné via Claude (PDF ou image). Lit un maximum d'infos
// et les renvoie pour autocompléter les champs : plaque, date, montant, lieu,
// type, n° de PV. Le montant est souvent absent (excès de vitesse) → null.
//
// Olivier 2026-07-01. Cf module amendes.

import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_MODEL } from '@/lib/anthropic-model'

export interface FineExtract {
  plate:            string | null   // plaque du véhicule verbalisé
  infraction_date:  string | null   // ISO 8601 (avec heure si possible)
  amount:           number | null   // montant € si présent, sinon null
  infraction_place: string | null
  infraction_type:  string | null   // speeding|parking|red_light|priority|phone|belt|other
  infraction_ref:   string | null   // n° de PV
  identification_code: string | null // code d'identification figurant sur le PV
  raw_quote:        string | null
}

const TYPES = ['speeding', 'parking', 'red_light', 'priority', 'phone', 'belt', 'other']

const PROMPT = `Tu lis un procès-verbal / une amende de circulation (Belgique), scanné (image ou PDF). Extrais un MAXIMUM d'informations pour préremplir un formulaire.

Retourne UNIQUEMENT un objet JSON (pas de markdown) avec EXACTEMENT :

{
  "plate": "string|null — plaque d'immatriculation du véhicule verbalisé (format d'origine)",
  "infraction_date": "string|null — date (et heure si présente) de l'infraction, en ISO 8601 (ex: 2026-06-15T14:30:00). null si illisible",
  "amount": "number|null — montant de l'amende en euros si INDIQUÉ sur le document, sinon null (souvent absent pour les excès de vitesse)",
  "infraction_place": "string|null — lieu de l'infraction (rue + localité)",
  "infraction_type": "string|null — l'un de : speeding (excès de vitesse), parking (stationnement), red_light (feu rouge), priority (priorité), phone (téléphone au volant), belt (ceinture), other. Choisis le plus proche.",
  "infraction_ref": "string|null — numéro du PV / de la notice / du dossier",
  "identification_code": "string|null — code d'identification figurant sur le PV (ex. code de perception immédiate, communication structurée de paiement, code d'identification du document). Distinct du numéro de PV. null si absent.",
  "raw_quote": "string|null — très courte citation qui justifie (max 120 caractères)"
}

RÈGLES :
- Si une info n'est pas lisible/présente, mets null (ne devine pas).
- amount : uniquement si un montant € figure explicitement. Pour un excès de vitesse sans montant, mets null.
- infraction_type doit être exactement une des valeurs listées.
Retourne UNIQUEMENT le JSON.`

let cachedClient: Anthropic | null = null
function getClient(): Anthropic {
  if (cachedClient) return cachedClient
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquant en env vars')
  cachedClient = new Anthropic({ apiKey })
  return cachedClient
}

function parseJson(text: string): any {
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
  try { return JSON.parse(cleaned) } catch {
    const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}')
    if (s >= 0 && e > s) return JSON.parse(cleaned.slice(s, e + 1))
    throw new Error(`JSON Claude invalide : ${text.slice(0, 200)}`)
  }
}

function coerce(item: any): FineExtract {
  const s = (v: any) => (v == null || v === '' ? null : String(v).trim())
  const amt = item?.amount != null && item.amount !== '' && Number.isFinite(Number(item.amount)) ? Number(item.amount) : null
  const t = TYPES.includes(item?.infraction_type) ? item.infraction_type : null
  return {
    plate:            s(item?.plate),
    infraction_date:  s(item?.infraction_date),
    amount:           amt && amt > 0 ? amt : null,
    infraction_place: s(item?.infraction_place),
    infraction_type:  t,
    infraction_ref:   s(item?.infraction_ref),
    identification_code: s(item?.identification_code),
    raw_quote:        s(item?.raw_quote)?.slice(0, 120) ?? null,
  }
}

/** OCR d'un scan (base64) : PDF → bloc document, image → bloc image. */
export async function extractFineFromScan(base64: string, mimeType: string): Promise<FineExtract> {
  const client = getClient()
  const clean = base64.replace(/^data:.*;base64,/, '')
  const isPdf = mimeType.toLowerCase().includes('pdf')
  const media = isPdf
    ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: clean } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: (mimeType || 'image/jpeg') as any, data: clean } }

  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: [media as any, { type: 'text', text: PROMPT }] }],
  })
  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') throw new Error('Aucun texte retourné par Claude')
  return coerce(parseJson(textBlock.text))
}
