// src/app/api/missions/[id]/ocr-vehicle/route.ts
//
// POST { images: string[] }  (base64 SANS le préfixe data:)
//
// Extrait la PLAQUE et le VIN depuis les photos du chauffeur via Claude Haiku
// (vision, multi-images en un seul appel). Utilisé à la clôture quand un des
// deux champs est vide → le chauffeur confirme/corrige. On NE renvoie que des
// valeurs VALIDÉES (format plaque / VIN 17 car.) ; sinon null (jamais inventé).
// Olivier 2026-07-10.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import Anthropic            from '@anthropic-ai/sdk'
import { ANTHROPIC_CHEAP_MODELS, createWithModelFallback } from '@/lib/anthropic-model'
import { looksLikePlate, looksLikeVin, normalizeOcr } from '@/lib/ocr/vehicle'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

// Modèles éco (Haiko d'abord, repli sur le modèle actif de l'app si retiré).
const OCR_MODELS = [process.env.ANTHROPIC_OCR_MODEL, ...ANTHROPIC_CHEAP_MODELS].filter(Boolean) as string[]
const MAX_IMAGES = 6

let cachedClient: Anthropic | null = null
function getClient(): Anthropic {
  if (cachedClient) return cachedClient
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquant en env vars')
  cachedClient = new Anthropic({ apiKey })
  return cachedClient
}

const SYSTEM_PROMPT = `Tu extrais la PLAQUE D'IMMATRICULATION et le VIN (numéro de châssis) d'un véhicule à partir de photos prises par un dépanneur. Tu reçois plusieurs images numérotées (1, 2, 3...).

Retourne UNIQUEMENT un JSON strict, sans markdown, sans commentaire :
{ "plate": { "value": "<plaque>", "image": <numéro 1..N> } | null,
  "vin":   { "value": "<VIN 17 caractères>", "image": <numéro 1..N> } | null }

Règles STRICTES :
- VIN = EXACTEMENT 17 caractères (lettres + chiffres, JAMAIS de I, O ni Q). Si tu ne lis pas un VIN complet et net de 17 caractères, mets null. Ne DEVINE JAMAIS.
- Plaque = plaque d'immatriculation du véhicule (format belge, lettres + chiffres). Si non lisible clairement, null.
- "image" = le numéro de la photo (1..N) où tu as lu la valeur.
- Dans le doute, préfère null plutôt qu'une valeur approximative.`

interface Body { images?: string[] }

export async function POST(req: Request, _ctx: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as Body
  const raw = (body.images || []).map(s => String(s || '').trim()).filter(Boolean).slice(0, MAX_IMAGES)
  if (raw.length === 0) return NextResponse.json({ ok: true, plate: null, vin: null })

  // Chaque item = data URL/base64 (capture locale) OU URL http (photo déjà
  // uploadée) → on récupère du base64 pour Claude dans les deux cas.
  const images: string[] = []
  for (const item of raw) {
    if (/^https?:\/\//i.test(item)) {
      try {
        const r = await fetch(item)
        if (!r.ok) continue
        images.push(Buffer.from(await r.arrayBuffer()).toString('base64'))
      } catch { /* photo injoignable → ignorée */ }
    } else {
      images.push(item.replace(/^data:[^,]+,/, ''))
    }
  }
  if (images.length === 0) return NextResponse.json({ ok: true, plate: null, vin: null })

  try {
    const client = getClient()
    const content: any[] = images.map(data => ({
      type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data },
    }))
    content.push({ type: 'text', text: `Voici ${images.length} photo(s). Extrais plaque + VIN. JSON strict uniquement.` })

    const resp = await createWithModelFallback(client, OCR_MODELS, {
      max_tokens: 300,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content }],
    })

    const text = resp.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
    const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()

    let parsed: any
    try { parsed = JSON.parse(cleaned) } catch {
      console.error('[ocr-vehicle] JSON parse fail:', text.slice(0, 300))
      return NextResponse.json({ ok: true, plate: null, vin: null })
    }

    // Validation stricte côté serveur (jamais inventé) + normalisation.
    const validate = (obj: any, kind: 'plate' | 'vin') => {
      if (!obj || typeof obj.value !== 'string') return null
      const v = normalizeOcr(obj.value, kind)
      const ok = kind === 'plate' ? looksLikePlate(v) : looksLikeVin(v)
      if (!ok) return null
      const img = Number(obj.image)
      const image = Number.isFinite(img) && img >= 1 && img <= images.length ? img : 1
      return { value: v, image }
    }

    return NextResponse.json({
      ok: true,
      plate: validate(parsed.plate, 'plate'),
      vin:   validate(parsed.vin,   'vin'),
    })
  } catch (e: any) {
    console.error('[ocr-vehicle] Claude échec:', e?.message)
    return NextResponse.json({ error: `OCR échec : ${e?.message || e}` }, { status: 500 })
  }
}
