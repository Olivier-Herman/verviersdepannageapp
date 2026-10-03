// src/lib/taches/read-documents.ts
//
// Lecture des documents trouvés dans un véhicule mis en parc (Olivier
// 28/09/2026 : « on scanne tout et tout se range en reconnaissance des
// documents ; ce qui n'est pas dans le scan est un document absent »).
//
// Entrée : les pages scannées ou photographiées (images ou PDF). Sortie : les
// documents reconnus/absents et ce qu'on en tire (propriétaire, assureur,
// contrôle technique, châssis). Modèle centralisé (anthropic-model.ts).

import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_MODELS, createWithModelFallback } from '@/lib/anthropic-model'
import type { Reading } from './accident-steps'
import { aiClient } from '@/lib/ai/usage'

const EXPECTED = ['certificat_immatriculation', 'carte_verte', 'controle_technique', 'carnet_entretien', 'autre'] as const

const SYSTEM = `Tu lis les documents trouvés dans un véhicule accidenté déposé dans un parc de fourrière en Belgique. Les pages peuvent être dans n'importe quel ordre, en français, néerlandais ou allemand, parfois de travers ou floues.

Reconnais chaque document parmi : "certificat_immatriculation" (carte grise belge, DIV : nom et adresse du titulaire, plaque, numéro de châssis, marque, date de première mise en circulation), "carte_verte" (certificat d'assurance RC auto : assureur, numéro de police, période de validité), "controle_technique" (certificat de visite : date de validité), "carnet_entretien", "autre" (précise lequel dans note).

Retourne UNIQUEMENT un JSON strict, sans markdown :
{
  "documents": [ { "type": "<un des types ci-dessus>", "present": true, "note": <string|null> } ],
  "owner": { "name": <string|null>, "address": <string|null>, "phone": <string|null>, "email": <string|null> },
  "insurer": { "name": <string|null>, "policy": <string|null>, "valid_until": <string|null> },
  "assistance": <string|null>,
  "ct_valid_until": <string|null>,
  "vin": <string|null>,
  "plate": <string|null>,
  "notes": <string|null>
}
Règles : "documents" ne liste QUE ce que tu as vu ; ne devine jamais un nom ou une adresse absents ; dates au format JJ/MM/AAAA ; plaque belge au format 1-ABC-123 ; "assistance" = l'assisteur cité sur la carte verte s'il y en a un (Ethias Assistance, Touring, VAB, AXA Assistance, Europ Assistance…), sinon null.`

let client: Anthropic | null = null
function getClient(): Anthropic {
  if (client) return client
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquante')
  client = aiClient('taches/read-documents', { apiKey })
  return client
}

export interface PageInput { base64: string; mimeType: string }

export async function readVehicleDocuments(
  pages: PageInput[],
  hints: { plate?: string | null; vin?: string | null },
): Promise<{ ok: true; reading: Reading } | { ok: false; error: string }> {
  if (!pages.length) return { ok: false, error: 'Aucune page à lire.' }
  const content: any[] = pages.map(p => p.mimeType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.base64 } }
    : { type: 'image', source: { type: 'base64', media_type: p.mimeType, data: p.base64 } })
  content.push({ type: 'text', text: `Véhicule attendu : plaque ${hints.plate || 'inconnue'}, châssis ${hints.vin || 'inconnu'}. Lis toutes les pages et retourne uniquement le JSON.` })
  try {
    const resp = await createWithModelFallback(getClient(), ANTHROPIC_MODELS, {
      max_tokens: 2500, system: SYSTEM, messages: [{ role: 'user', content }],
    })
    const text = (resp.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
    const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()
    const data = JSON.parse(cleaned)
    // Normalise : les types attendus absents du scan sont marqués absents.
    const seen = new Set((data.documents || []).map((d: any) => String(d.type)))
    const documents = [
      ...(data.documents || []).map((d: any) => ({ type: String(d.type), present: true, note: d.note || undefined })),
      ...EXPECTED.filter(t => t !== 'autre' && !seen.has(t)).map(t => ({ type: t, present: false })),
    ]
    const reading: Reading = {
      documents, owner: data.owner || {}, insurer: data.insurer || {}, assistance: data.assistance ?? null,
      ct_valid_until: data.ct_valid_until ?? null, vin: data.vin ?? null, plate: data.plate ?? null, notes: data.notes ?? null,
    }
    return { ok: true, reading }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Lecture impossible' }
  }
}
