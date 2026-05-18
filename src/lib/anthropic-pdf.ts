// src/lib/anthropic-pdf.ts
//
// Helper pour extraire des tarifs depuis un PDF d assurance via Claude API
// (Anthropic). Utilise par /api/admin/tarifs/extract.
//
// Modele : claude-sonnet-4-6 (support PDF natif, ~5-15s par doc, ~0.10-0.30€).
// Env var requise : ANTHROPIC_API_KEY

import Anthropic from '@anthropic-ai/sdk'

export interface ExtractedTariff {
  source:                string
  mission_type:          string   // canonical : 'remorquage', 'depannage', 'trajet_vide', 'parc'
  unit_price:            number | null
  km_inclus:             number
  km_price:              number | null
  parc_day_price:        number | null
  surcharge_night_pct:   number
  surcharge_we_pct:      number
  surcharge_holiday_pct: number
  conditions:            string
  is_autofac:            boolean
  effective_from:        string   // YYYY-MM-DD
  raw_quote:             string   // citation du PDF qui justifie l extraction
}

const EXTRACTION_PROMPT = `Tu es un assistant qui extrait des tarifs de dépannage automobile depuis un PDF de barème tarifaire d'une compagnie d'assistance ou d'assurance.

Analyse le document fourni et retourne UN ARRAY JSON avec UN OBJET par ligne tarifaire identifiable. Chaque objet doit respecter EXACTEMENT cette structure :

{
  "source": "string — nom de la compagnie en minuscules (vab, touring, ima, mondial, ethias, autre)",
  "mission_type": "string — l'un de : remorquage, depannage, trajet_vide, parc",
  "unit_price": "number — prix forfait HT en euros, ou null",
  "km_inclus": "number — km inclus dans le forfait, 0 si pas spécifié",
  "km_price": "number — prix par km au-delà des km inclus, ou null",
  "parc_day_price": "number — prix par jour de mise en parc, ou null",
  "surcharge_night_pct": "number — % surcharge nuit, 0 si non applicable",
  "surcharge_we_pct": "number — % surcharge week-end, 0 si non applicable",
  "surcharge_holiday_pct": "number — % surcharge jour férié, 0 si non applicable",
  "conditions": "string — autres conditions notables (max 100 chars, concis)",
  "is_autofac": "boolean — true si la compagnie facture elle-même (souvent grandes assurances)",
  "effective_from": "string — date d'effet au format YYYY-MM-DD (date actuelle si absente)",
  "raw_quote": "string — citation très brève du PDF qui justifie cette ligne (max 120 chars)"
}

REGLES :
- "depannage" inclut aussi "réparation sur place", "DSP", "panne", "dépannage" — TOUJOURS retourner "depannage" en canonical.
- "remorquage" inclut "REM", "remorquage", "tractage" — TOUJOURS retourner "remorquage".
- "trajet_vide" = déplacement sans véhicule à dépanner.
- "parc" = mise en parc / gardiennage.
- Si une ligne tarifaire couvre plusieurs types (ex: "REM + DSP : 60€"), génère 2 objets séparés.
- Si une info n'est pas dans le PDF, mets null ou 0 selon le type.

Retourne UNIQUEMENT le JSON valide, pas de markdown, pas de texte autour, pas de commentaire.
Si aucun tarif n'est identifiable, retourne un array vide [].`

let cachedClient: Anthropic | null = null

function getClient(): Anthropic {
  if (cachedClient) return cachedClient
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY manquant en env vars')
  }
  cachedClient = new Anthropic({ apiKey })
  return cachedClient
}

/**
 * Appelle Claude pour extraire les tarifs depuis un PDF (base64).
 * Retourne un array de ExtractedTariff. Throw en cas d echec API ou de JSON invalide.
 */
export async function extractTariffsFromPdf(
  pdfBase64: string,
  hintSource?: string, // 'vab', 'touring', etc. — pour aider Claude si le PDF est ambigu
): Promise<ExtractedTariff[]> {
  const client = getClient()
  const userPrompt = hintSource
    ? `${EXTRACTION_PROMPT}\n\nHint : la compagnie est probablement "${hintSource}".`
    : EXTRACTION_PROMPT

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,  // PDFs tarifaires peuvent contenir 20-50+ lignes
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBase64,
            },
          },
          {
            type: 'text',
            text: userPrompt,
          },
        ],
      },
    ],
  })

  // Reponse Claude : on prend le 1er content block de type 'text'
  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Aucun texte retourne par Claude')
  }

  let parsed: unknown
  try {
    // Trim eventuels markdown fences ou texte parasite
    const cleaned = textBlock.text.trim().replace(/^```json\s*/, '').replace(/```\s*$/, '').trim()
    parsed = JSON.parse(cleaned)
  } catch (e: any) {
    // Tentative de recovery : si le JSON est tronque, essaye de fermer l array
    // en coupant au dernier objet complet avant l erreur.
    const trimmed = textBlock.text.trim().replace(/^```json\s*/, '').replace(/```\s*$/, '').trim()
    const lastClosingBrace = trimmed.lastIndexOf('}')
    if (lastClosingBrace > 0) {
      const recovered = trimmed.slice(0, lastClosingBrace + 1) + ']'
      try {
        parsed = JSON.parse(recovered)
        console.warn('[anthropic-pdf] JSON tronque, recovery applique (' + ((parsed as any[])?.length || 0) + ' lignes recuperees)')
      } catch {
        throw new Error(`JSON Claude invalide : ${e.message}. Stop_reason: ${response.stop_reason}. Reponse brute (debut) : ${textBlock.text.slice(0, 300)}`)
      }
    } else {
      throw new Error(`JSON Claude invalide : ${e.message}. Stop_reason: ${response.stop_reason}. Reponse brute (debut) : ${textBlock.text.slice(0, 300)}`)
    }
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Reponse Claude n est pas un array : ${typeof parsed}`)
  }

  // Validation basique des champs requis + valeurs par defaut
  const tariffs: ExtractedTariff[] = []
  for (const item of parsed as any[]) {
    if (!item || typeof item !== 'object') continue
    tariffs.push({
      source:                String(item.source || hintSource || 'autre').toLowerCase(),
      mission_type:          String(item.mission_type || 'depannage').toLowerCase(),
      unit_price:            item.unit_price != null ? Number(item.unit_price) : null,
      km_inclus:             Number(item.km_inclus || 0),
      km_price:              item.km_price != null ? Number(item.km_price) : null,
      parc_day_price:        item.parc_day_price != null ? Number(item.parc_day_price) : null,
      surcharge_night_pct:   Number(item.surcharge_night_pct || 0),
      surcharge_we_pct:      Number(item.surcharge_we_pct || 0),
      surcharge_holiday_pct: Number(item.surcharge_holiday_pct || 0),
      conditions:            String(item.conditions || ''),
      is_autofac:            Boolean(item.is_autofac),
      effective_from:        String(item.effective_from || new Date().toISOString().slice(0, 10)),
      raw_quote:             String(item.raw_quote || ''),
    })
  }

  return tariffs
}
