// src/app/api/admin/tarifs/rules/extract/route.ts
//
// POST /api/admin/tarifs/rules/extract { text: string }
// Appelle Claude pour interpreter un texte libre en regles structurees.
// Ne sauvegarde rien : l UI presente les regles extraites pour validation.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { extractTariffRulesFromText } from '@/lib/anthropic-pdf'

export const dynamic    = 'force-dynamic'
export const maxDuration = 30

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

  const body = await req.json()
  const text = String(body.text || '').trim()
  if (!text) return NextResponse.json({ error: 'text requis' }, { status: 400 })
  if (text.length > 5000) return NextResponse.json({ error: 'text trop long (max 5000 chars)' }, { status: 400 })

  try {
    const extracted = await extractTariffRulesFromText(text)
    return NextResponse.json({ ok: true, extracted, count: extracted.length })
  } catch (e: any) {
    console.error('[tarifs/rules/extract] error:', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
