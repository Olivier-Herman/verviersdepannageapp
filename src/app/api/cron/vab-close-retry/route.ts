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
// ⚠️ Les dossiers sont traités UN PAR UN, jamais en parallèle : le compte VAB est
// partagé et la séquence pilote un Chromium. Mais plusieurs peuvent passer dans
// le MÊME appel, à la file, tant qu'il reste du temps — un seul par quart d'heure
// mettait deux heures à rattraper huit dossiers (Olivier 2026-08-26).
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


/**
 * Trace de passage, écrite qu'il réussisse ou qu'il échoue.
 *
 * Le 31/08 ce cron échouait depuis deux jours sans que rien ne le dise : 37 des
 * 40 derniers essais en échec, 112 dossiers en attente, et aucun moyen de
 * distinguer « ne se déclenche pas » de « se déclenche et échoue » sans aller
 * lire les mission_logs un par un. Même leçon que payment-advices.
 */
async function trace(payload: Record<string, unknown>) {
  try {
    const sb = createAdminClient()
    await sb.from('app_settings').upsert(
      { key: 'vab_close_retry_last_run', value: JSON.stringify({ at: new Date().toISOString(), ...payload }) },
      { onConflict: 'key' },
    )
  } catch { /* la trace ne doit jamais faire échouer le cron */ }
}

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (process.env.DISABLE_VAB_POLL === 'true') {
    await trace({ ok: true, disabled: true })
    return NextResponse.json({ ok: true, disabled: true })
  }

  try {
    const { loginVab, listVabMissions, vabTaskTypes, estVehiculeRemplacementVab } = await import('@/lib/vab/scraper')
    const session = await loginVab()
    const { missions } = await listVabMissions(session)
    const tous = (missions as any[])
      .map(m => String(m.detailHref || '').replace(/.*AssignmentId=/, '').trim())
      .filter(Boolean)

    // Les livraisons de véhicule de remplacement demandent les informations du
    // conducteur : elles se clôturent à la main (Olivier 2026-08-26). Les laisser
    // dans la file leur ferait consommer un créneau sur deux pour rien, et la
    // rotation les ramènerait indéfiniment.
    const types = await vabTaskTypes(session).catch(() => ({} as Record<string, string>))
    const vr = tous.filter(a => estVehiculeRemplacementVab(types[a]))
    const ouverts = tous.filter(a => !vr.includes(a))
    if (ouverts.length === 0) {
      await trace({ ok: true, ouverts: 0, vrIgnorés: vr.length })
      return NextResponse.json({ ok: true, ouverts: 0, vrIgnorés: vr.length })
    }

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
      await trace({ ok: true, ouverts: ouverts.length, vrIgnorés: vr.length, aTraiter: 0 })
      return NextResponse.json({ ok: true, ouverts: ouverts.length, vrIgnorés: vr.length, aTraiter: 0 })
    }

    // ── ROTATION : UN DOSSIER BLOQUÉ NE DOIT PAS AFFAMER LES AUTRES ──────────
    // Le filet ne traite qu'un dossier par passage et prenait toujours le plus
    // ancien. Un dossier qui ne peut pas aboutir — destination illisible, écran
    // qui refuse — se represente donc tous les quarts d'heure et les suivants
    // n'ont jamais leur tour. Vu le 24/08 : dix dossiers en attente pendant que
    // le filet rejouait le même. On passe donc au moins tenté récemment, et le
    // jamais tenté d'abord.
    const { data: essais } = await sb.from('mission_logs')
      .select('mission_id, created_at')
      .in('mission_id', candidats.map(c => c.id))
      .in('action', ['vab_close_failed', 'vab_close_skipped'])
      .order('created_at', { ascending: false })
    const dernierEssai = new Map<string, string>()
    for (const l of (essais || []) as any[]) if (!dernierEssai.has(l.mission_id)) dernierEssai.set(l.mission_id, l.created_at)
    candidats.sort((a, b) => (dernierEssai.get(a.id) || '').localeCompare(dernierEssai.get(b.id) || ''))

    // ── PLUSIEURS DOSSIERS PAR PASSAGE, À LA FILE ────────────────────────────
    // Une clôture prend 80 à 110 s. À un dossier par quart d'heure, huit dossiers
    // en retard demandaient deux heures. On enchaîne donc tant qu'il reste de
    // quoi en faire une de plus dans le budget de la fonction — jamais deux en
    // même temps, le compte VAB est partagé.
    const { runVabTowClose } = await import('@/lib/cloture/transform/vab')
    const DÉBUT = Date.now()
    const BUDGET_MS = (maxDuration - 45) * 1000   // marge pour la réponse HTTP
    const DURÉE_TYPE_MS = 110_000                 // une clôture observée, majorée
    const résultats: { plaque: string; abouti: boolean }[] = []

    for (const cible of candidats) {
      if (Date.now() - DÉBUT + DURÉE_TYPE_MS > BUDGET_MS) break
      await runVabTowClose({ missionId: cible.id, externalId: cible.external_id, actorId: null })
      const { data: après } = await sb.from('incoming_missions')
        .select('vab_closed_at').eq('id', cible.id).maybeSingle()
      const abouti = !!(après as any)?.vab_closed_at
      résultats.push({ plaque: cible.vehicle_plate, abouti })
      console.log(`[cron vab-close-retry] ${cible.vehicle_plate} → ${abouti ? 'soldé' : 'échec'}`)
    }

    const soldés = résultats.filter(r => r.abouti).length
    console.log(`[cron vab-close-retry] ${résultats.length} traité(s), ${soldés} soldé(s) · reste ${candidats.length - résultats.length}`)
    const bilan = {
      ok: true, ouverts: ouverts.length, vrIgnorés: vr.length, aTraiter: candidats.length,
      traités: résultats, soldés, reste: candidats.length - résultats.length,
    }
    await trace(bilan)
    return NextResponse.json(bilan)
  } catch (e: any) {
    console.error('[cron vab-close-retry]', e?.message)
    await trace({ ok: false, error: e?.message || 'erreur' })
    return NextResponse.json({ error: e?.message || 'erreur' }, { status: 500 })
  }
}
