// src/app/api/missions/[id]/relivrer/route.ts
//
// Crée une mission de relivraison (REL) à partir d'une mission parc-ée.
// Déclenché par le dispatcher via le bouton "Relivrer" sur la fiche d'une
// mission en statut 'parked'. Idempotent : si une REL existe déjà pour
// cette mission parente, retourne son id.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { createRelivraisonMission } from '@/lib/missions/create-relivraison'

const ALLOWED_ROLES = ['dispatcher', 'admin', 'superadmin']

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const u = session.user as any
  const userRoles: string[] = Array.isArray(u.roles) ? u.roles : (u.role ? [u.role] : [])
  if (!userRoles.some(r => ALLOWED_ROLES.includes(r))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Body optionnel :
  //   - redelivery_address : adresse de relivraison si pas capturee au parc
  //   - source_override    : source tarifaire de la REL (cas Appel Prive
  //                          repris par assistance : REM reste 'prive',
  //                          REL passe en 'touring'/'ethias'/etc.)
  //   - driver_comments    : instructions chauffeur (une par ligne) à semer sur
  //                          la nouvelle fiche REL → pop-up à l'acceptation.
  let body: { redelivery_address?: string; source_override?: string | null; driver_comments?: string } = {}
  try { body = await req.json() } catch {}

  const sb = createAdminClient()

  // Lire la mission parente — elle doit être en statut 'parked' avec
  // une redelivery_address déjà définie (= ancienne destination).
  const { data: parent } = await sb
    .from('incoming_missions')
    .select('id, status, destination_address, destination_lat, destination_lng, redelivery_address, park_stage_name')
    .eq('id', params.id)
    .single()
  if (!parent) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  if (parent.status !== 'parked') {
    return NextResponse.json({ error: 'La mission n\'est pas en parc' }, { status: 422 })
  }

  // À ce stade, destination_address contient l'adresse du parc (vu depuis park),
  // et redelivery_address contient l'adresse originale que l'on veut atteindre.
  let redelivery = parent.redelivery_address
  if (!redelivery && body.redelivery_address) {
    // Le dispatcher fournit l'adresse manuellement, on la sauve avant de continuer
    const newAddr = body.redelivery_address.trim()
    if (newAddr) {
      const { error: upErr } = await sb
        .from('incoming_missions')
        .update({ redelivery_address: newAddr })
        .eq('id', params.id)
      if (upErr) {
        return NextResponse.json({ error: `Sauvegarde adresse: ${upErr.message}` }, { status: 500 })
      }
      redelivery = newAddr
    }
  }
  if (!redelivery) {
    return NextResponse.json({ error: 'Aucune adresse de relivraison enregistrée' }, { status: 422 })
  }

  const result = await createRelivraisonMission({
    parentMissionId:   params.id,
    parkAddress:       parent.destination_address || '',
    parkLat:           parent.destination_lat ?? null,
    parkLng:           parent.destination_lng ?? null,
    redeliveryAddress: redelivery,
    sourceOverride:    body.source_override || null,
  })

  if (!result.id) {
    return NextResponse.json({ error: result.error || 'Création REL échouée' }, { status: 500 })
  }

  // Instructions chauffeur pour la REL : une par ligne non vide → pop-up à
  // l'acceptation de la mission REL. Olivier 2026-07-10.
  const lines = String(body.driver_comments || '')
    .split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length > 0) {
    const { data: actor } = await sb.from('users').select('id').eq('email', session.user!.email!).maybeSingle()
    await sb.from('mission_driver_instructions').insert(
      lines.map(text => ({ mission_id: result.id, text, created_by: actor?.id ?? null })),
    )
  }

  return NextResponse.json({ ok: true, mission_id: result.id })
}
