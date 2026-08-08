// src/app/api/caisse/ecran/unlock/route.ts
//
// Déverrouillage de l'écran comptoir par PIN (comme le mur /tableau-bord).
// L'écran est physique (PC comptoir) : le personnel entre le PIN UNE fois au
// démarrage, puis c'est mémorisé sur le poste. Le client au comptoir ne le voit
// jamais. PIN configurable via env ECRAN_PIN (défaut 071000). Olivier 2026-08-08.

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const ECRAN_PIN = process.env.ECRAN_PIN || '071000'

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const pin = String(body?.pin || '').trim()
  if (!pin) return NextResponse.json({ ok: false, error: 'PIN requis' }, { status: 400 })
  if (pin !== ECRAN_PIN) return NextResponse.json({ ok: false, error: 'PIN incorrect' }, { status: 401 })
  return NextResponse.json({ ok: true })
}
