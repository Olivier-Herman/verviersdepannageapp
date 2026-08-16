// src/app/api/cron/vab-close-retry/route.ts
//
// LE FILET (Olivier 2026-08-14).
//
// Une clôture VAB peut échouer en silence : le compte est partagé, la session
// casse, un écran met dix secondes de trop. Personne ne le voit — c'est ainsi
// que treize dossiers sont restés ouverts chez eux pendant dix jours.
//
// Ce cron part de la SEULE source qui ne ment pas : la liste des dossiers encore
// ouverts chez VAB. Tout ce qui y traîne alors que la mission est terminée chez
// nous est repris. Nos propres compteurs ne servent qu'à ne pas rejouer.
//
// ⚠️ Un seul dossier par passage : le compte VAB est partagé et la séquence
// pilote un Chromium. Le verrou de `runVabTowClose` refuse de toute façon un
// second run — autant ne pas le provoquer.
//
// ⚠️ TOUS les dossiers, quel que soit le parcours du chauffeur (Olivier
// 2026-08-16 : « tout ce que tu peux clôturer doit l'être »). Un dossier ouvert
// chez VAB alors que la mission est finie chez nous doit être soldé, que le
// chauffeur soit en flux 2 ou non.

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'

/** Statuts qui signifient « l'intervention est finie chez nous ». */
const TERMINÉES = ['to_invoice', 'completed', 'parked']

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (process.env.DISABLE_VAB_POLL === 'true') {
    return NextResponse.json({ ok: true, disabled: true })
  }

  try {
    const { loginVab, listVabMissions } = await import('@/lib/vab/scraper')
    const { missions } = await listVabMissions(await loginVab())
    const ouverts = (missions as any[])
      .map(m => String(m.detailHref || '').replace(/.*AssignmentId=/, '').trim())
      .filter(Boolean)
    if (ouverts.length === 0) return NextResponse.json({ ok: true, ouverts: 0 })

    const sb = createAdminClient()
    const { data: fiches } = await sb.from('incoming_missions')
      .select('id, vehicle_plate, external_id, status, assigned_to, mission_type, vab_assignment_ids, vab_closed_at')
      .overlaps('vab_assignment_ids', ouverts)
      .in('status', TERMINÉES)
      .is('vab_closed_at', null)
      .order('id', { ascending: true })

    // ⚠️ PLUS de filtre flux 2 (Olivier 2026-08-16 : « tout ce que tu peux
    // clôturer doit l'être »). La clôture ne dépend pas du parcours du chauffeur :
    // elle lit le type et la destination sur la fiche, qui sont là dans les deux
    // cas. Le 16/08, 2HDJ908 est resté ouvert chez VAB parce que son chauffeur
    // venait d'être sorti du flux 2 — le filet l'ignorait alors qu'il savait le
    // traiter. Garde-fou inchangé : une destination illisible laisse le dossier
    // OUVERT plutôt que de partir de travers.
    const candidats: any[] = (fiches || []) as any[]
    if (candidats.length === 0) {
      return NextResponse.json({ ok: true, ouverts: ouverts.length, aTraiter: 0 })
    }

    // Le plus ancien d'abord : c'est celui qui risque le plus de passer à la trappe.
    const cible = candidats[0]
    const { runVabTowClose } = await import('@/lib/cloture/transform/vab')
    await runVabTowClose({
      missionId:  cible.id,
      externalId: cible.external_id,
      actorId:    null,
    })

    const { data: après } = await sb.from('incoming_missions')
      .select('vab_closed_at').eq('id', cible.id).maybeSingle()
    const abouti = !!(après as any)?.vab_closed_at
    console.log(`[cron vab-close-retry] ${cible.vehicle_plate} → ${abouti ? 'soldé' : 'échec'} · reste ${candidats.length - 1}`)
    return NextResponse.json({
      ok: true, ouverts: ouverts.length, aTraiter: candidats.length,
      traité: cible.vehicle_plate, abouti, reste: candidats.length - 1,
    })
  } catch (e: any) {
    console.error('[cron vab-close-retry]', e?.message)
    return NextResponse.json({ error: e?.message || 'erreur' }, { status: 500 })
  }
}
