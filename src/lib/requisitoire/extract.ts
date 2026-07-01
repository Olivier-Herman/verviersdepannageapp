// src/lib/requisitoire/extract.ts
//
// Extraction d'un réquisitoire (document police/parquet) via Claude.
// Les réquisitoires arrivent dans fourriere@ depuis PLUSIEURS expéditeurs
// (zones de police, parquets) → pas d'émetteur fixe : c'est Claude qui lit la
// pièce jointe (PDF, souvent scanné → vision) pour (a) confirmer que c'est un
// réquisitoire et (b) extraire les signaux de rapprochement + le n° de PV.
//
// Réutilise le pattern de [anthropic-pdf.ts] (SDK Anthropic, bloc `document`
// base64) + le modèle centralisé [anthropic-model.ts].
//
// Olivier 2026-07-01. Cf [[project_assistant_mail_module]].

import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_MODEL } from '@/lib/anthropic-model'

export interface RequisitoireExtract {
  is_requisitoire: boolean          // false = ce PDF n'est pas un réquisitoire
  pv_number:       string | null    // n° de PV / procès-verbal / dossier police
  plaque:          string | null    // plaque d'immatriculation
  vin:             string | null    // n° de châssis / VIN
  marque:          string | null    // marque véhicule
  modele:          string | null    // modèle véhicule
  adresse:         string | null    // lieu de l'enlèvement / saisie
  date_requisition: string | null   // date du réquisitoire (YYYY-MM-DD si possible)
  autorite:        string | null    // zone de police / parquet émetteur
  raw_quote:       string | null    // courte citation qui justifie (max 120 char)
}

const PROMPT = `Tu es un assistant d'une société de dépannage/fourrière en Belgique. On te fournit un document reçu par email (souvent un PDF scanné). Ce document PEUT être un "réquisitoire" : un ordre officiel d'une zone de police ou d'un parquet demandant l'enlèvement, la saisie ou le gardiennage d'un véhicule.

Analyse le document et retourne UNIQUEMENT un objet JSON (pas de markdown, pas de texte autour) avec EXACTEMENT cette structure :

{
  "is_requisitoire": "boolean — true seulement si c'est bien un réquisitoire/ordre de saisie/enlèvement police ou parquet. false pour tout autre document (facture, courrier, etc.)",
  "pv_number": "string|null — numéro de PV / procès-verbal / numéro de notice / dossier police tel qu'écrit. null si absent.",
  "plaque": "string|null — plaque d'immatriculation du véhicule (garde le format d'origine).",
  "vin": "string|null — numéro de châssis / VIN complet.",
  "marque": "string|null — marque du véhicule (ex: Volkswagen).",
  "modele": "string|null — modèle du véhicule (ex: Golf).",
  "adresse": "string|null — lieu de l'enlèvement / de la saisie (rue + localité).",
  "date_requisition": "string|null — date du réquisitoire au format YYYY-MM-DD si identifiable, sinon null.",
  "autorite": "string|null — zone de police / parquet / autorité émettrice.",
  "raw_quote": "string|null — très courte citation du document qui justifie (max 120 caractères)."
}

RÈGLES :
- Si une info n'est pas présente, mets null (ne devine pas).
- La plaque belge ressemble à "1-ABC-234" ou "1ABC234". Le VIN fait 17 caractères alphanumériques.
- Ne confonds pas le numéro de PV avec la plaque ou le VIN.
- Sois prudent sur is_requisitoire : en cas de doute réel, mets false.
Retourne UNIQUEMENT le JSON.`

let cachedClient: Anthropic | null = null
function getClient(): Anthropic {
  if (cachedClient) return cachedClient
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquant en env vars')
  cachedClient = new Anthropic({ apiKey })
  return cachedClient
}

function coerce(item: any): RequisitoireExtract {
  const s = (v: any) => (v == null || v === '' ? null : String(v).trim())
  return {
    is_requisitoire:  Boolean(item?.is_requisitoire),
    pv_number:        s(item?.pv_number),
    plaque:           s(item?.plaque),
    vin:              s(item?.vin),
    marque:           s(item?.marque),
    modele:           s(item?.modele),
    adresse:          s(item?.adresse),
    date_requisition: s(item?.date_requisition),
    autorite:         s(item?.autorite),
    raw_quote:        s(item?.raw_quote)?.slice(0, 120) ?? null,
  }
}

function parseJson(text: string): any {
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
  try { return JSON.parse(cleaned) } catch {
    // tolère un objet unique éventuellement suivi de texte
    const start = cleaned.indexOf('{')
    const end   = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1))
    throw new Error(`JSON Claude invalide : ${text.slice(0, 200)}`)
  }
}

/** Extrait les données d'un réquisitoire depuis un PDF (base64). */
export async function extractRequisitoireFromPdf(pdfBase64: string): Promise<RequisitoireExtract> {
  const client = getClient()
  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
        { type: 'text', text: PROMPT },
      ],
    }],
  })
  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') throw new Error('Aucun texte retourné par Claude')
  return coerce(parseJson(textBlock.text))
}

/** Variante texte (corps du mail) si pas de PDF exploitable. */
export async function extractRequisitoireFromText(text: string): Promise<RequisitoireExtract> {
  const client = getClient()
  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: `${PROMPT}\n\n--- DOCUMENT (texte) ---\n\n${text.slice(0, 12000)}` }],
  })
  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') throw new Error('Aucun texte retourné par Claude')
  return coerce(parseJson(textBlock.text))
}
