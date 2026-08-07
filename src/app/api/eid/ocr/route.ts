// src/app/api/eid/ocr/route.ts
//
// POST /api/eid/ocr
// Body: { base64: string, mimeType: 'image/jpeg' | 'image/png' }
//
// OCR d'une carte d'identité / passeport ÉTRANGER (FR/DE/NL/LU + passeports…)
// via Claude Vision. Lit la MRZ (lignes <<<) + le texte imprimé → renvoie les
// mêmes champs que la lecture eID belge, pour préremplir la même fiche client.
// Sans PIN, tous pays (comme les loueurs). L'ADRESSE n'est dans la MRZ que
// rarement (imprimée au dos de certaines cartes) → sinon null (saisie manuelle).
//
// Olivier 2026-08-07.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import Anthropic            from '@anthropic-ai/sdk'
import { ANTHROPIC_MODELS, createWithModelFallback } from '@/lib/anthropic-model'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

interface Body { base64: string; mimeType: string }

let cachedClient: Anthropic | null = null
function getClient(): Anthropic {
  if (cachedClient) return cachedClient
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquant en env vars')
  cachedClient = new Anthropic({ apiKey })
  return cachedClient
}

const SYSTEM_PROMPT = `Tu lis une pièce d'identité (carte d'identité nationale ou passeport, tous pays) à partir d'une photo. Utilise À LA FOIS la MRZ (les lignes en bas avec des <<<) ET le texte imprimé au recto/verso.

Extrais et retourne UNIQUEMENT un JSON strict, sans markdown ni commentaire :
{
  "firstName": <string|null>,      // prénom(s). Privilégie l'orthographe imprimée (accents, casse normale), pas la version MAJUSCULES de la MRZ.
  "lastName": <string|null>,       // nom de famille.
  "birthDate": <string|null>,      // date de naissance au format JJ/MM/AAAA.
  "nationality": <string|null>,    // nationalité en toutes lettres (ex "Française", "Allemande", "Belge").
  "documentNumber": <string|null>, // numéro du document.
  "sex": <string|null>,            // "M" ou "F".
  "expiry": <string|null>,         // date d'expiration JJ/MM/AAAA si visible.
  "street": <string|null>,         // adresse (rue + n°) UNIQUEMENT si imprimée sur la carte, sinon null.
  "zip": <string|null>,            // code postal si imprimé, sinon null.
  "city": <string|null>,           // localité si imprimée, sinon null.
  "country": <string|null>,        // pays émetteur en toutes lettres.
  "confidence": "high"|"medium"|"low"
}

Règles :
- N'INVENTE JAMAIS une adresse : si elle n'est pas imprimée sur la pièce, mets street/zip/city à null (l'adresse n'est pas dans la MRZ).
- Corrige la casse : "DUPONT" → "Dupont", "JEAN PAUL" → "Jean Paul".
- Si l'image est illisible ou n'est pas une pièce d'identité, mets confidence="low" et les champs à null.`

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as Body
  if (!body.base64 || !body.mimeType || !body.mimeType.startsWith('image/')) {
    return NextResponse.json({ error: 'base64 + mimeType image requis' }, { status: 400 })
  }

  try {
    const client = getClient()
    const resp = await createWithModelFallback(client, ANTHROPIC_MODELS, {
      max_tokens: 700,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: body.mimeType, data: body.base64 } },
          { type: 'text', text: 'Lis cette pièce d\'identité et retourne uniquement le JSON.' },
        ],
      }],
    })

    const text = (resp.content || [])
      .filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
    const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()

    let parsed: any
    try { parsed = JSON.parse(cleaned) }
    catch {
      return NextResponse.json({ error: 'OCR non-JSON', raw: text.slice(0, 400) }, { status: 502 })
    }

    // Renvoie au format EidData (mêmes clés que la lecture eID belge).
    return NextResponse.json({
      ok: true,
      lastName:       parsed.lastName || null,
      firstName:      parsed.firstName || null,
      birthDate:      parsed.birthDate || null,
      nationality:    parsed.nationality || null,
      nationalNumber: parsed.documentNumber || null,
      street:         parsed.street || null,
      zip:            parsed.zip || null,
      city:           parsed.city || null,
      country:        parsed.country || null,
      confidence:     parsed.confidence || 'medium',
    })
  } catch (e: any) {
    console.error('[eid/ocr] Claude échec:', e?.message)
    return NextResponse.json({ error: `OCR échec : ${e?.message || e}` }, { status: 500 })
  }
}
