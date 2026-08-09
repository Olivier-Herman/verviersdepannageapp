// src/app/api/mission/punchline/route.ts
//
// Easter egg « Mes missions » : génère une punchline fraîche via Claude (modèle
// cheap) selon le nombre de missions du jour du chauffeur. L'UI affiche d'abord
// une vanne statique (instantané), puis remplace par celle-ci quand elle arrive.
// Best-effort : renvoie { line: null } si pas de clé / erreur → l'UI garde la
// statique. Olivier 2026-08-09.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import Anthropic            from '@anthropic-ai/sdk'
import { ANTHROPIC_CHEAP_MODELS, createWithModelFallback } from '@/lib/anthropic-model'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { count = 0, record = 0, newRecord = false, firstName = '' } = await req.json().catch(() => ({}))
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ line: null })

  const vibe = newRecord
    ? `il vient de BATTRE son record perso (${record}) — félicite-le à fond, hype total`
    : count <= 0 ? `il n'a encore AUCUNE mission — chambre-le gentiment sur le démarrage lent`
    : count <= 2 ? `il n'a que ${count} mission(s), c'est lent — chambre-le sur sa lenteur (escargot, sieste, tour touristique…)`
    : count <= 5 ? `il en a ${count}, rythme correct — encourage-le, record perso à ${record}`
    : count <= 9 ? `il en a ${count}, gros rythme — encense-le (Flash, fusée, moteur d'avion…)`
    : `il en a ${count}, rythme de dingue — encense-le à mort (machine, légende, faut le cloner…)`

  try {
    const client = new Anthropic({ apiKey })
    const msg = await createWithModelFallback(client, ANTHROPIC_CHEAP_MODELS, {
      max_tokens: 60,
      system: `Tu génères UNE punchline très courte (max 14 mots) en français FAMILIER/belge pour un chauffeur-dépanneur, selon son nombre de missions du jour. Ton : drôle, cash, bon esprit, taquin — jamais méchant ni vulgaire. Tu tutoies, tu peux utiliser son prénom. 0 ou 1 emoji max. Réponds UNIQUEMENT la phrase, sans guillemets ni préambule.`,
      messages: [{ role: 'user', content: `Prénom : ${firstName || '(inconnu)'}. Missions aujourd'hui : ${count}. Record perso : ${record}. Contexte : ${vibe}.` }],
    })
    const line = (msg.content as any[])
      .filter(b => b.type === 'text').map(b => b.text).join('').trim()
      .replace(/^["'«»\s]+|["'«»\s]+$/g, '')
    return NextResponse.json({ line: line || null })
  } catch {
    return NextResponse.json({ line: null })
  }
}
