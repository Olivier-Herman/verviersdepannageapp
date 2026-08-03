// src/lib/ct/extract-convocation.ts
//
// OCR d'une convocation au contrôle technique (Belgique : Autosécurité, GOCA…),
// scannée (PDF ou image), via Claude. Extrait le RDV + le véhicule + le centre.

import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_MODEL } from '@/lib/anthropic-model'

export interface ConvocationExtract {
  plate:          string | null   // immatriculation
  brand:          string | null
  model:          string | null
  vin:            string | null   // n° de châssis
  rdv_date:       string | null   // YYYY-MM-DD
  rdv_time:       string | null   // HH:MM (24h) si indiqué
  center_name:    string | null   // ex. "Autosécurité Verviers"
  center_address: string | null
}

const PROMPT = `Tu lis une CONVOCATION AU CONTRÔLE TECHNIQUE automobile (Belgique : Autosécurité, GOCA, Autocontrole…), scannée (image ou PDF). Extrais les infos pour préremplir un rendez-vous.

Retourne UNIQUEMENT un objet JSON (pas de markdown, pas de texte autour) avec EXACTEMENT ces clés :
{
  "plate": "string|null — plaque d'immatriculation (majuscules, sans espaces), ex. 1ABC234",
  "brand": "string|null — marque du véhicule",
  "model": "string|null — modèle",
  "vin": "string|null — numéro de châssis (VIN, 17 caractères) si présent",
  "rdv_date": "string|null — date du rendez-vous au format YYYY-MM-DD",
  "rdv_time": "string|null — heure du rendez-vous au format HH:MM (24h) si indiquée, sinon null",
  "center_name": "string|null — nom du centre de contrôle technique / station",
  "center_address": "string|null — adresse du centre (rue, n°, CP, ville)"
}

Règles : dates belges en JJ/MM/AAAA → convertis en YYYY-MM-DD. Si une info est absente, mets null. Ne devine pas la plaque si illisible.`

let cached: Anthropic | null = null
function getClient(): Anthropic {
  if (cached) return cached
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquante')
  cached = new Anthropic({ apiKey })
  return cached
}

const s = (v: any) => (v == null || v === '' ? null : String(v).trim())

export async function extractConvocation(base64: string, mimeType: string): Promise<ConvocationExtract> {
  const client = getClient()
  const clean = base64.replace(/^data:.*;base64,/, '')
  const isPdf = (mimeType || '').toLowerCase().includes('pdf')
  const media = isPdf
    ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: clean } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: (mimeType || 'image/jpeg') as any, data: clean } }

  const resp = await client.messages.create({
    model: ANTHROPIC_MODEL, max_tokens: 800,
    messages: [{ role: 'user', content: [media as any, { type: 'text', text: PROMPT }] }],
  })
  const block = resp.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('Aucun texte retourné par Claude')
  let raw = block.text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) raw = raw.slice(start, end + 1)
  let j: any
  try { j = JSON.parse(raw) } catch { throw new Error(`JSON Claude invalide : ${raw.slice(0, 160)}`) }

  const plate = s(j?.plate)
  return {
    plate:          plate ? plate.toUpperCase().replace(/[^A-Z0-9]/g, '') : null,
    brand:          s(j?.brand),
    model:          s(j?.model),
    vin:            s(j?.vin),
    rdv_date:       s(j?.rdv_date),
    rdv_time:       s(j?.rdv_time),
    center_name:    s(j?.center_name),
    center_address: s(j?.center_address),
  }
}
