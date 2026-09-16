// src/app/api/fourriere/relance-requisitoire/officer/route.ts
//
// Relance GROUPÉE par policier (portail) — personnel fourrière / admin.
//   POST { partner_id } → un seul mail listant tous ses réquisitoires manquants
//                          + bouton vers son espace (/police/[jeton signé]).
//   GET  ?partner_id=   → le lien du portail (copie / envoi manuel).
// Olivier 16/09/2026.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { sessionAccess }    from '@/lib/access'
import { sendOfficerPortalMail, portalLink } from '@/lib/requisitoire/officer-portal'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!sessionAccess(session, { modules: ['fourriere'] }).ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const pid = Number(new URL(req.url).searchParams.get('partner_id') || 0)
  if (!pid) return NextResponse.json({ error: 'partner_id requis' }, { status: 400 })
  return NextResponse.json({ ok: true, link: portalLink(pid) })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!sessionAccess(session, { modules: ['fourriere'] }).ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const body = await req.json().catch(() => ({} as any))
  const pid = Number(body?.partner_id || 0)
  if (!pid) return NextResponse.json({ error: 'partner_id requis' }, { status: 400 })
  const r = await sendOfficerPortalMail(pid)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, email: r.email, count: r.count })
}
