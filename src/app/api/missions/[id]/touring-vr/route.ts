// src/app/api/missions/[id]/touring-vr/route.ts
//
// DEMANDE DE VÉHICULE DE REMPLACEMENT chez Touring (Olivier 2026-08-14).
//
// Action INDÉPENDANTE de la clôture : `setDemVr` ne touche pas au statut COMEX.
// Le chauffeur peut donc demander le VR sur place, poursuivre son intervention,
// déposer le véhicule en parc, et clôturer ensuite — rien n'entre en concurrence.
// Elle remplace l'intérim qui passait par le code de fin 04.
//
// Une seule demande par dossier : Touring en refuse un second, et c'est le
// garde-fou qu'on avait déjà dû poser sur la re-clôture.

export const dynamic = 'force-dynamic'

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { requestTouringVr }  from '@/lib/touring/comex'
import { comexKeysOf }       from '@/lib/touring/sync'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const actor = session?.user as any
  if (!actor?.id) return NextResponse.json({ error: 'Non connecté' }, { status: 401 })

  const sb = createAdminClient()
  const { data: m } = await sb.from('incoming_missions')
    .select('id, vehicle_plate, source_format, raw_content, assigned_to, touring_vr, touring_vr_requested_at')
    .eq('id', params.id).maybeSingle()
  if (!m) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  const role = String(actor.role || '')
  const roles: string[] = Array.isArray(actor.roles) ? actor.roles : []
  const estBureau = ['superadmin', 'admin', 'dispatcher'].some(r => r === role || roles.includes(r))
  if (!estBureau && (m as any).assigned_to !== actor.id) {
    return NextResponse.json({ error: 'Mission non assignée' }, { status: 403 })
  }

  const keys = comexKeysOf(m as any)
  if (!keys) return NextResponse.json({ error: 'Dossier COMEX introuvable sur cette mission' }, { status: 400 })

  // Déjà demandé → on ne redemande pas. Touring n'accorde qu'un VR par dossier,
  // et une seconde demande partirait sans qu'on sache ce qu'elle devient.
  if ((m as any).touring_vr_requested_at) {
    return NextResponse.json({ ok: true, déjàDemandé: true, at: (m as any).touring_vr_requested_at })
  }

  // Éligibilité : Touring dit 9 = proposable, 0 = non. On ne demande pas un VR
  // là où il n'y a pas de droit — le refus reviendrait sans explication.
  const vr = (m as any).touring_vr || {}
  const éligible = [vr.vr, vr.vr_taxi, vr.shuttle_vr].some(v => Number(v) === 9)
  if (!éligible && !estBureau) {
    return NextResponse.json({ error: 'Pas de véhicule de remplacement prévu sur ce dossier' }, { status: 400 })
  }

  const r = await requestTouringVr(keys)

  await sb.from('mission_logs').insert({
    mission_id: params.id, actor_id: actor.id,
    action: r.ok ? 'touring_vr_requested' : 'touring_vr_failed',
    notes: r.ok
      ? 'Touring : véhicule de remplacement demandé'
      : `Touring : demande de VR refusée — ${r.error || 'raison inconnue'}`,
    metadata: { ...keys, ok: r.ok, error: r.error ?? null },
  }).then(() => {}, () => {})

  if (r.ok) {
    // Le marqueur ouvre la chasse : le cron `touring-vr-scan` relit le détail
    // jusqu'à ce que Touring remplisse les VR_* et prévient le chauffeur du lieu.
    await sb.from('incoming_missions')
      .update({ touring_vr_requested_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', params.id)
  }

  return NextResponse.json(r.ok
    ? { ok: true, message: 'Demande envoyée à Touring — le lieu suivra dès qu\'ils l\'auront réservé' }
    : { ok: false, error: r.error || 'Touring a refusé la demande' },
    { status: r.ok ? 200 : 502 })
}
