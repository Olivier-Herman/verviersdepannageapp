// GET /api/courrier/missions?q=… — fiches pour corriger le rattachement (plaque, n° de fiche ou de dossier).
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { courrierAccess } from '@/lib/courrier/access'
import { missionLabel, searchMissions } from '@/lib/courrier/match'
export const dynamic = 'force-dynamic'
export async function GET(req: Request) {
  const a = await courrierAccess(); if (!a.ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const q = new URL(req.url).searchParams.get('q') || ''
  const rows = await searchMissions(createAdminClient(), q)
  return NextResponse.json({ missions: await Promise.all(rows.map(async m => ({ id: m.id, label: await missionLabel(m) }))) })
}
