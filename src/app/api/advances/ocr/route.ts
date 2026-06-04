// src/app/api/advances/ocr/route.ts
//
// POST /api/advances/ocr
// Body: { base64: string, mimeType: 'image/jpeg' | 'image/png' | 'application/pdf' }
//
// Olivier 2026-06-04 : extraction automatique HTVA + TVAC via Claude Vision
// depuis la photo / PDF de la facture du fournisseur. Utilise par
// AvanceFondsClient apres upload pour pre-remplir les 2 champs.
//
// Modele : claude-sonnet-4-6 (support image + PDF natif). Best-effort :
// retourne null pour les champs non identifies, l user peut toujours
// corriger manuellement.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import Anthropic            from '@anthropic-ai/sdk'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

interface Body {
  base64:   string
  mimeType: string
}

let cachedClient: Anthropic | null = null
function getClient(): Anthropic {
  if (cachedClient) return cachedClient
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquant en env vars')
  cachedClient = new Anthropic({ apiKey })
  return cachedClient
}

const SYSTEM_PROMPT = `Tu es un agent d extraction de factures de fournisseur (essence, peages, parking, etc.). Tu reçois une photo ou un PDF d une facture et tu dois extraire :
- le montant HORS TVA (HTVA), aussi appele "sous-total", "net", "HT"
- le montant TVA INCLUSE (TVAC), aussi appele "TTC", "total a payer", "total general"

Si l un des deux est absent ou ambigu, retourne null pour ce champ.
Si la facture mentionne explicitement plusieurs taux de TVA, prends bien le total final.
Si tu ne vois qu un seul montant et que la TVA n est pas mentionnee, mets-le dans amount_tvac et laisse amount_htva null.

Retourne UNIQUEMENT un JSON strict, sans markdown, sans commentaire :
{ "amount_htva": <number|null>, "amount_tvac": <number|null>, "fournisseur": <string|null>, "confidence": "high"|"medium"|"low" }

Exemples :
- Facture essence Total : amount_htva=50.41, amount_tvac=61.00, fournisseur="Total"
- Ticket parking : amount_htva=null, amount_tvac=3.50, fournisseur="Q-Park"
- Photo floue : confidence="low"`

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as Body
  if (!body.base64 || !body.mimeType) {
    return NextResponse.json({ error: 'base64 et mimeType requis' }, { status: 400 })
  }

  try {
    const client = getClient()
    const isPdf  = body.mimeType === 'application/pdf'

    const contentItem: any = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: body.base64 } }
      : { type: 'image',    source: { type: 'base64', media_type: body.mimeType,    data: body.base64 } }

    const resp = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 512,
      system:     SYSTEM_PROMPT,
      messages: [{
        role:    'user',
        content: [
          contentItem,
          { type: 'text', text: 'Extrais HTVA et TVAC. Retourne uniquement le JSON.' },
        ],
      }],
    })

    // Parse JSON dans la reponse
    const textContent = resp.content
      .filter(c => c.type === 'text')
      .map(c => (c as any).text)
      .join('')

    // Nettoyer le JSON (au cas ou markdown)
    const cleaned = textContent
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()

    let parsed: { amount_htva: number | null; amount_tvac: number | null; fournisseur: string | null; confidence: string }
    try {
      parsed = JSON.parse(cleaned)
    } catch (parseErr) {
      console.error('[advances/ocr] JSON parse fail:', textContent)
      return NextResponse.json({
        error:  'OCR a retourne une reponse non-JSON',
        raw:    textContent.slice(0, 500),
      }, { status: 502 })
    }

    return NextResponse.json({
      ok: true,
      amount_htva: parsed.amount_htva,
      amount_tvac: parsed.amount_tvac,
      fournisseur: parsed.fournisseur,
      confidence:  parsed.confidence || 'medium',
    })
  } catch (e: any) {
    console.error('[advances/ocr] Claude API echec:', e?.message)
    return NextResponse.json({ error: `OCR Claude echec : ${e?.message || e}` }, { status: 500 })
  }
}
