// src/app/api/translate/route.ts
//
// POST { text: string } → détecte la langue et traduit vers le FRANÇAIS.
// Utilisé par le bouton « Traduire » sur la description d'incident (chauffeur).
// Retour : { ok, already_fr, lang, translation }.
// Modèle éco (Claude Haiku). Olivier 2026-07-10.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import Anthropic            from '@anthropic-ai/sdk'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

const TRANSLATE_MODEL = process.env.ANTHROPIC_TRANSLATE_MODEL || 'claude-haiku-4-5'

let cachedClient: Anthropic | null = null
function getClient(): Anthropic {
  if (cachedClient) return cachedClient
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquant en env vars')
  cachedClient = new Anthropic({ apiKey })
  return cachedClient
}

const SYSTEM_PROMPT = `Tu es un traducteur. On te donne un texte (souvent une description d'incident de dépannage, en néerlandais, anglais, allemand ou autre). Tu détectes la langue et tu traduis vers le FRANÇAIS.

Retourne UNIQUEMENT un JSON strict, sans markdown :
{ "lang": "<langue détectée en français, ex 'Néerlandais'>", "already_fr": <true|false>, "translation": "<texte en français>" }

Règles :
- Si le texte est DÉJÀ en français, mets already_fr=true et translation = le texte original inchangé.
- Traduis fidèlement, garde le sens technique (panne, batterie, roue, etc.). Ne commente pas, ne rajoute rien.`

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const text = String(body?.text || '').trim()
  if (!text) return NextResponse.json({ error: 'Texte requis' }, { status: 400 })
  if (text.length > 4000) return NextResponse.json({ error: 'Texte trop long' }, { status: 400 })

  try {
    const client = getClient()
    const resp = await client.messages.create({
      model:      TRANSLATE_MODEL,
      max_tokens: 1024,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: text }],
    })
    const out = resp.content.filter(c => c.type === 'text').map(c => (c as any).text).join('')
    const cleaned = out.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()

    let parsed: { lang?: string; already_fr?: boolean; translation?: string }
    try { parsed = JSON.parse(cleaned) } catch {
      // Repli : si le modèle a répondu en texte brut, on prend tel quel.
      return NextResponse.json({ ok: true, already_fr: false, lang: null, translation: out.trim() })
    }
    return NextResponse.json({
      ok: true,
      already_fr:  !!parsed.already_fr,
      lang:        parsed.lang || null,
      translation: parsed.translation || text,
    })
  } catch (e: any) {
    console.error('[translate] Claude échec:', e?.message)
    return NextResponse.json({ error: `Traduction échec : ${e?.message || e}` }, { status: 500 })
  }
}
