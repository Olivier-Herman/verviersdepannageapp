// src/app/api/admin/tarifs/extract-text/route.ts
//
// POST /api/admin/tarifs/extract-text
// Body : { text: string, hint_source?: string }
//
// Equivalent texte de /api/admin/tarifs/extract (qui prend un PDF).
// L admin decrit un bareme en texte libre, Claude extrait les memes
// ExtractedTariff[] que pour un PDF. Pas d upload Storage : on retourne
// directement les tarifs extraits pour validation cote UI.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { extractTariffsFromText } from '@/lib/anthropic-pdf'

export const dynamic    = 'force-dynamic'
export const maxDuration = 60

async function requireSuperadmin() {
  const session = await getServerSession(authOptions)
  if (!session) return null
  const role  = (session.user as any).role  || ''
  const roles = (session.user as any).roles || [role]
  const allRoles: string[] = Array.isArray(roles) ? roles : [roles]
  if (!allRoles.includes('superadmin')) return null
  return session
}

export async function POST(req: Request) {
  const session = await requireSuperadmin()
  if (!session) return NextResponse.json({ error: 'Acces superadmin requis' }, { status: 403 })

  const body = await req.json() as { text?: string; hint_source?: string }
  const text = (body.text || '').trim()
  if (!text) return NextResponse.json({ error: 'Texte requis' }, { status: 400 })
  if (text.length > 30000) return NextResponse.json({ error: 'Texte trop long (max 30 000 caracteres)' }, { status: 400 })

  let extracted
  try {
    extracted = await extractTariffsFromText(text, body.hint_source || undefined)
  } catch (e: any) {
    console.error('[tarifs/extract-text] Claude error:', e.message)
    return NextResponse.json({ error: `Extraction Claude: ${e.message}` }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    extracted,
    count: extracted.length,
  })
}
