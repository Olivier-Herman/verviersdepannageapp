// src/app/api/missions/[id]/garages-agrees/route.ts — garage du réseau agréé Touring choisi par le chauffeur sur sa
// fiche (Olivier 29/10/2026, maquette https://claude.ai/artifact/6ckD6EUH86meDtcGRQavAt validée).
//   GET            → liste Touring complète (COMEX provider/get), triée par distance ; garage indiqué par Touring en tête
//   POST {cidPrx}  → destination = ce garage (même chemin que « Modifier l'adresse »), retenu pour la clôture
// Accès : le chauffeur de la mission, ou le dispatch.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { garagesAgrees } from '@/lib/touring/garages-agrees'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DISPATCH_ROLES = ['admin', 'superadmin', 'dispatcher']

async function acces(id: string) {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return { err: NextResponse.json({ error: 'Non autorisé' }, { status: 401 }) }
  const sb = createAdminClient()
  const [{ data: u }, { data: m }] = await Promise.all([
    sb.from('users').select('id, role, roles, active').eq('email', email).maybeSingle(),
    sb.from('incoming_missions').select('*').eq('id', id).maybeSingle(),
  ])
  if (!u?.active) return { err: NextResponse.json({ error: 'Non autorisé' }, { status: 401 }) }
  if (!m) return { err: NextResponse.json({ error: 'Mission introuvable' }, { status: 404 }) }
  const roles = [u.role, ...(Array.isArray(u.roles) ? u.roles : [])]
  if (m.assigned_to !== u.id && !roles.some(r => DISPATCH_ROLES.includes(String(r)))) return { err: NextResponse.json({ error: 'Non autorisé' }, { status: 403 }) }
  return { sb, u, m }
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const a = await acces(params.id)
  if (a.err) return a.err
  try {
    const garages = await garagesAgrees(a.m, 1000)
    const { data: ch } = await a.sb!.from('mission_logs').select('metadata').eq('mission_id', params.id).eq('action', 'touring_garage_choisi').order('created_at', { ascending: false }).limit(1).maybeSingle()
    return NextResponse.json({ garages, choisi: (ch as any)?.metadata?.cidPrx || null })
  } catch (e: any) {
    console.error('[garages-agrees]', e?.message || e)
    return NextResponse.json({ error: 'La liste Touring ne répond pas. Réessaie dans un instant.' }, { status: 502 })
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const a = await acces(params.id)
  if (a.err) return a.err
  const { cidPrx } = await req.json().catch(() => ({} as any))
  if (!cidPrx) return NextResponse.json({ error: 'Garage manquant' }, { status: 400 })
  try {
    const g = (await garagesAgrees(a.m, 1000)).find(x => x.cidPrx === String(cidPrx))
    if (!g) return NextResponse.json({ error: 'Ce garage n’est plus dans la liste Touring.' }, { status: 409 })
    // Même chemin que « Modifier l'adresse » du chauffeur (règles de statut, recalculs, journal).
    const base = (process.env.NEXTAUTH_URL || 'https://app.verviersdepannage.com').replace(/\/$/, '')
    const r = await fetch(`${base}/api/missions/driver-action`, {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.NEXTAUTH_SECRET || '', 'x-internal-actor': a.u!.id },
      body: JSON.stringify({ mission_id: params.id, action: 'update_address', field: 'destination', value: g.label, lat: g.lat, lng: g.lng }),
    })
    if (!r.ok) { const j = await r.json().catch(() => ({})); return NextResponse.json({ error: j.error || `Refusé (${r.status})` }, { status: r.status }) }
    await a.sb!.from('incoming_missions').update({ destination_name: g.nom }).eq('id', params.id)
    await a.sb!.from('mission_logs').insert({ mission_id: params.id, actor_id: a.u!.id, action: 'touring_garage_choisi', notes: `Garage du réseau agréé Touring choisi sur la fiche : ${g.label}`, metadata: { cidPrx: g.cidPrx, nom: g.nom } })
    // L'alerte de Sam sur ce sujet est réglée.
    await a.sb!.from('sam_alertes').update({ resolved_at: new Date().toISOString() }).eq('mission_id', params.id).eq('kind', 'garage_agree').is('resolved_at', null)
    return NextResponse.json({ ok: true, garage: g })
  } catch (e: any) {
    console.error('[garages-agrees] choix', e?.message || e)
    return NextResponse.json({ error: 'La liste Touring ne répond pas. Réessaie dans un instant.' }, { status: 502 })
  }
}
