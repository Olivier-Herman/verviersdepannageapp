// src/app/api/police-portal/[token]/route.ts
//
// PUBLIC (le jeton signé EST l'autorisation — un jeton par policier, cf
// lib/requisitoire/officer-portal). Olivier 16/09/2026.
//   GET  → { officer, pending, received, unassigned }
//   POST { action: 'claim', mission_id } → le policier s'attribue une saisie
//        sans policier ; renvoie le jeton de dépôt de la fiche.
// Le dépôt du réquisitoire passe par le dépôt par fiche existant :
// POST /api/requisitoire/depot/[token de la fiche].

import { NextResponse } from 'next/server'
import { verifyOfficerToken, loadOfficerPortal, claimMission } from '@/lib/requisitoire/officer-portal'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const pid = verifyOfficerToken(params.token)
  if (!pid) return NextResponse.json({ error: 'Lien invalide ou expiré' }, { status: 404 })
  const data = await loadOfficerPortal(pid)
  if (!data) return NextResponse.json({ error: 'Lien invalide ou expiré' }, { status: 404 })
  return NextResponse.json(data)
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const pid = verifyOfficerToken(params.token)
  if (!pid) return NextResponse.json({ error: 'Lien invalide ou expiré' }, { status: 404 })
  const body = await req.json().catch(() => ({} as any))
  if (body?.action !== 'claim' || !body?.mission_id) return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
  const r = await claimMission(pid, String(body.mission_id))
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, token: r.token })
}
