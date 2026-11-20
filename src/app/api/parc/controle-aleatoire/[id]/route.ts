// src/app/api/parc/controle-aleatoire/[id]/route.ts — contrôle aléatoire du parc (Olivier 17/11/2026).
// GET : le contrôle, ses 15 véhicules et, pour les « pas trouvé », les pistes de recherche.
// POST { action: 'start' } | { action: 'scan', item_id, qr } | { action: 'absent', item_id } | { action: 'autre_zone', item_id, zone }
//    | { action: 'resoudre', item_id, choix: 'retrouve'|'restitue'|'domaine'|'epave'|'recherche', zone?, date?, note? }
//    | { action: 'repousser' } | { action: 'demander_prolongation', motif } | { action: 'decider_prolongation', accepte } (Olivier 20/11/2026)
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sessionAccess } from '@/lib/access'
import { lireControle, demarrer, repondre, pistes, resoudre, repousser, demanderProlongation, deciderProlongation, reportsMax, nomsValidateurs } from '@/lib/parc/controle-aleatoire'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function acces() {
  const session = await getServerSession(authOptions)
  const acc = sessionAccess(session, { roles: ['admin', 'superadmin', 'dispatcher'], modules: ['fourriere'] })
  return acc.ok ? { id: acc.id as string, name: (session?.user as any)?.name || null } : null
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const u = await acces(); if (!u) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const sb = createAdminClient()
  const r = await lireControle(sb, params.id)
  if (!r) return NextResponse.json({ error: 'Contrôle introuvable' }, { status: 404 })
  if (new URL(req.url).searchParams.get('pistes') === '1') {
    for (const it of r.items) if (it.resultat === 'absent' && !it.resolu_at) (it as any).pistes = await pistes(sb, it.id).catch(() => [])
  }
  return NextResponse.json({ ...r, moi: u.id, reports_max: await reportsMax(), validateur: await nomsValidateurs(sb).catch(() => '') })
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const u = await acces(); if (!u) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const sb = createAdminClient()
  const b = await req.json().catch(() => ({})) as any
  let r: any
  if (b.action === 'start') r = await demarrer(sb, params.id, u)
  else if (b.action === 'scan') r = await repondre(sb, params.id, String(b.item_id), u, { action: 'scan', qr: String(b.qr || '') })
  else if (b.action === 'absent') r = await repondre(sb, params.id, String(b.item_id), u, { action: 'absent' })
  else if (b.action === 'autre_zone') r = await repondre(sb, params.id, String(b.item_id), u, { action: 'autre_zone', zone: String(b.zone || '') })
  else if (b.action === 'resoudre') r = await resoudre(sb, String(b.item_id), u, b.choix === 'retrouve' ? { choix: 'retrouve', zone: String(b.zone || '') } : (b.choix === 'restitue' || b.choix === 'domaine') ? { choix: b.choix, date: String(b.date || '') } : { choix: b.choix === 'epave' ? 'epave' : 'recherche' }, b.note)
  else if (b.action === 'repousser') r = await repousser(sb, params.id, u)
  else if (b.action === 'demander_prolongation') r = await demanderProlongation(sb, params.id, u, String(b.motif || ''))
  else if (b.action === 'decider_prolongation') r = await deciderProlongation(sb, params.id, u, b.accepte === true)
  else return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
  return NextResponse.json(r, { status: r.ok ? 200 : 409 })
}
