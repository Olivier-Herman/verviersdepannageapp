// src/lib/ocr/vision-json.ts
//
// Lecture d'un document photographié → JSON strict, via Claude Vision.
// Helper commun aux pièces d'identité étrangères, CMR et bons Informex :
// un prompt système par type de document, un seul point d'appel (modèle
// centralisé + repli, cf. anthropic-model.ts).

import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_MODELS, createWithModelFallback } from '@/lib/anthropic-model'

let cachedClient: Anthropic | null = null
function getClient(): Anthropic {
  if (cachedClient) return cachedClient
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquante')
  cachedClient = new Anthropic({ apiKey })
  return cachedClient
}

export async function extractJsonFromImages(
  images: { base64: string; mimeType: string }[],
  systemPrompt: string,
  userText: string,
  maxTokens = 900,
): Promise<{ ok: true; data: any } | { ok: false; error: string; raw?: string }> {
  const client = getClient()
  const content: any[] = images.map(img => ({
    type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.base64 },
  }))
  content.push({ type: 'text', text: userText })
  const resp = await createWithModelFallback(client, ANTHROPIC_MODELS, {
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content }],
  })
  const text = (resp.content || [])
    .filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
  const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()
  try { return { ok: true, data: JSON.parse(cleaned) } }
  catch { return { ok: false, error: 'Lecture non-JSON', raw: text.slice(0, 400) } }
}

// ── Prompts par type de document ─────────────────────────────────────────────

export const ID_DOCUMENT_PROMPT = `Tu lis une pièce d'identité (carte d'identité nationale ou passeport, tous pays) à partir d'une photo. Utilise À LA FOIS la MRZ (les lignes en bas avec des <<<) ET le texte imprimé au recto/verso.

Extrais et retourne UNIQUEMENT un JSON strict, sans markdown ni commentaire :
{
  "firstName": <string|null>,      // prénom(s). Privilégie l'orthographe imprimée (accents, casse normale).
  "lastName": <string|null>,
  "birthDate": <string|null>,      // JJ/MM/AAAA
  "nationality": <string|null>,    // en toutes lettres
  "documentNumber": <string|null>,
  "documentType": <string|null>,   // "id_card" | "passport" | "residence_permit" | "driving_licence" | "other"
  "sex": <string|null>,
  "expiry": <string|null>,         // JJ/MM/AAAA
  "street": <string|null>,         // UNIQUEMENT si imprimée sur la pièce
  "zip": <string|null>,
  "city": <string|null>,
  "country": <string|null>,        // pays émetteur en toutes lettres
  "confidence": "high"|"medium"|"low"
}

Règles : n'invente jamais une adresse ; corrige la casse ("DUPONT" → "Dupont") ; si l'image est illisible ou n'est pas une pièce d'identité, confidence="low" et champs à null.`

export const CMR_PROMPT = `Tu lis une lettre de voiture CMR (transport routier international) à partir d'une ou plusieurs photos. Les cases sont numérotées : 1 expéditeur, 2 destinataire, 3 lieu de livraison, 4 lieu et date de prise en charge, 16 transporteur, 21 établi à / le, 22 signature expéditeur, 23 signature transporteur.

Retourne UNIQUEMENT un JSON strict, sans markdown ni commentaire :
{
  "cmrNumber": <string|null>,          // numéro imprimé du CMR
  "sender": <string|null>,             // case 1, nom + adresse sur une ligne
  "consignee": <string|null>,          // case 2
  "deliveryPlace": <string|null>,      // case 3
  "loadingPlace": <string|null>,       // case 4 (lieu)
  "loadingDate": <string|null>,        // case 4 (date) JJ/MM/AAAA
  "carrier": <string|null>,            // case 16, nom + adresse
  "carrierVat": <string|null>,         // numéro de TVA du transporteur si visible
  "truckPlate": <string|null>,         // immatriculation du camion / remorque si visible
  "goods": <string|null>,              // description de la marchandise (case 6-9), ex. "1 véhicule accidenté"
  "vehiclePlate": <string|null>,       // plaque du véhicule transporté si mentionnée
  "vehicleVin": <string|null>,         // numéro de châssis si mentionné
  "issuedAt": <string|null>,           // case 21, lieu + date
  "confidence": "high"|"medium"|"low"
}

Si le document n'est pas un CMR, confidence="low" et champs à null. N'invente rien.`

export const INFORMEX_PROMPT = `Tu lis un document de mise à disposition / bon d'enlèvement d'un véhicule vendu via la plateforme Informex (assureurs belges), à partir d'une photo. Il reprend les données du véhicule, l'acheteur et une référence, avec un QR code.

Retourne UNIQUEMENT un JSON strict, sans markdown ni commentaire :
{
  "reference": <string|null>,        // numéro / référence du document ou du dossier
  "buyerName": <string|null>,        // acheteur (personne ou société)
  "buyerVat": <string|null>,
  "buyerAddress": <string|null>,
  "buyerCountry": <string|null>,
  "seller": <string|null>,           // assureur / vendeur
  "expertOffice": <string|null>,     // bureau d'expertise si mentionné
  "plate": <string|null>,            // immatriculation, sans espaces ni tirets
  "vin": <string|null>,              // numéro de châssis (17 caractères)
  "brand": <string|null>,
  "model": <string|null>,
  "pickupDeadline": <string|null>,   // date limite d'enlèvement JJ/MM/AAAA si visible
  "documentDate": <string|null>,     // JJ/MM/AAAA
  "confidence": "high"|"medium"|"low"
}

Si le document ne ressemble pas à un bon Informex, confidence="low" et champs à null. N'invente rien.`
