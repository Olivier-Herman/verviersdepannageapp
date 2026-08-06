// src/app/api/cron/touring-comex-poll/route.ts
//
// Cron toutes les 2 min : poll de la plateforme Touring COMEX.
// Contrainte métier : on a ~7 min pour ACCEPTER une mission Touring → un poll
// 2 min laisse au dispatcher ~5 min pour valider.
//
// MODE (env TOURING_COMEX_MODE) :
//   - 'observe' (DÉFAUT) : ne crée AUCUNE fiche. Log la répartition des statuts
//     et NOTIFIE le superadmin dès qu'un statut inconnu apparaît (= capture le
//     code "à valider" jaune, encore inconnu) ou qu'une mission active récente
//     arrive. Sert à valider le poll sans impacter les autres users.
//   - 'import' : (à activer plus tard) crée les fiches VD Soft actives.
//
// Kill-switch : DISABLE_TOURING_POLL=true.

import { NextResponse }  from 'next/server'
import { loginComex, listComexMissions } from '@/lib/touring/comex'
import { createAdminClient } from '@/lib/supabase'
import { sendPushToRole } from '@/lib/push'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

// Statuts COMEX (confirmés Olivier 2026-07-06) : 03 = À VALIDER (carte noire +
// décompte 7 min), 04 acceptée, 05 en route, 06 sur place, 07 terminée.
const STATUT_A_VALIDER = '03'
const KNOWN_STATUTS = new Set(['03', '04', '05', '06', '07'])

// SLA : si le chauffeur n'a pas pointé « sur place » 50 min après l'acceptation,
// on force le onSpot dans COMEX (operDate = accept + rand(20..45min), backdaté).
const SLA_ONSPOT_AFTER_MIN = 50
// SLA « démarré ≤10 min » : si accepté depuis ≥10 min SANS en route ni sur place,
// on force un onRoad proactif (backdaté ≤ accept+10min) → COMEX voit le « démarré »
// quasi en temps réel, sans attendre l'arrivée. Olivier 2026-07-08.
const SLA_ONROAD_AFTER_MIN = 10
// Statuts « morts » : on ne force PAS le sur place/en route dessus (annulée, doublon…).
const DEAD_STATUSES = ['cancelled', 'rejected', 'deleted', 'ignored', 'duplicate', 'error', 'parse_error', 'not_requisitoire', 'not_created']

// Auto-EN ROUTE proactif : missions Touring acceptées ≥10 min sans en route ni sur
// place → on pousse onRoad (backdaté) pour tenir le SLA « démarré ». Mode import.
async function runTouringOnRoadSweep(): Promise<{ scanned: number; pushed: number }> {
  const sb = createAdminClient()
  const now = Date.now()
  const cutoff = new Date(now - SLA_ONROAD_AFTER_MIN * 60_000).toISOString()
  const floor  = new Date(now - 6 * 60 * 60_000).toISOString()
  const { data, error } = await sb.from('incoming_missions')
    .select('id')
    .eq('source_format', 'comex')
    .not('touring_accepted_at', 'is', null)
    .is('touring_onroad_at', null)
    .is('touring_onspot_at', null)
    .lte('touring_accepted_at', cutoff)
    .gte('touring_accepted_at', floor)
    .not('status', 'in', `(${DEAD_STATUSES.join(',')})`)
  if (error || !Array.isArray(data) || data.length === 0) return { scanned: 0, pushed: 0 }
  const { syncTouringOnRoad } = await import('@/lib/touring/sync')
  let pushed = 0
  for (const m of data) {
    try { if (await syncTouringOnRoad(sb, (m as any).id)) pushed++ }
    catch (e: any) { console.warn('[cron touring-onroad] onRoad', (m as any).id, e?.message) }
  }
  return { scanned: data.length, pushed }
}

// Auto-onSpot des missions Touring dont le SLA arrive à échéance (mode import).
async function runTouringSlaSweep(): Promise<{ scanned: number; pushed: number }> {
  const sb = createAdminClient()
  const now = Date.now()
  const cutoff = new Date(now - SLA_ONSPOT_AFTER_MIN * 60_000).toISOString()
  const floor  = new Date(now - 6 * 60 * 60_000).toISOString()   // pas les rows anciennes (>6h)
  const { data, error } = await sb.from('incoming_missions')
    .select('id, status')
    .eq('source_format', 'comex')
    .not('touring_accepted_at', 'is', null)
    .is('touring_onspot_at', null)
    .lte('touring_accepted_at', cutoff)
    .gte('touring_accepted_at', floor)
    .not('status', 'in', `(${DEAD_STATUSES.join(',')})`)
  if (error || !Array.isArray(data) || data.length === 0) return { scanned: 0, pushed: 0 }

  const { syncTouringOnSpot } = await import('@/lib/touring/sync')
  let pushed = 0
  for (const m of data) {
    try { if (await syncTouringOnSpot(sb, (m as any).id)) pushed++ }
    catch (e: any) { console.warn('[cron touring-sla] onSpot', (m as any).id, e?.message) }
  }
  return { scanned: data.length, pushed }
}

// Réconciliation accept ↔ COMEX (source de vérité = statut COMEX). Pour chaque
// mission VD Soft liée COMEX pas encore marquée validée (fenêtre 20 min) :
//   • statut COMEX 04+ (accepté par NOUS ou À LA MAIN) → auto-valide chez nous.
//   • statut COMEX 03 (toujours à accepter) ET dispatch a confirmé (status ≠ 'new')
//     → on rejoue l'accept (absorbe le blip 500 transitoire). noRetry : le poll
//     (2 min) EST la cadence « jusqu'à 04 » ; zéro retry à vide car on s'arrête dès
//     que COMEX est en 04. Olivier 2026-08-06.
async function runTouringAcceptReconcile(
  missions: Awaited<ReturnType<typeof listComexMissions>>,
): Promise<{ scanned: number; validated: number; retried: number }> {
  const sb = createAdminClient()
  const floor = new Date(Date.now() - 20 * 60_000).toISOString()
  const { data } = await sb.from('incoming_missions')
    .select('id, raw_content, status')
    .eq('source_format', 'comex')
    .is('touring_accepted_at', null)
    .gte('received_at', floor)
    .not('status', 'in', `(${DEAD_STATUSES.join(',')})`)
  if (!Array.isArray(data) || data.length === 0) return { scanned: 0, validated: 0, retried: 0 }

  const statusByKey = new Map<string, string>()
  for (const m of missions) {
    statusByKey.set(`${String(m.CID_DOS).toUpperCase()}|${m.CID_SEQ_ACTION}`, m.COD_STATUT_MTR)
  }

  let validated = 0, retried = 0
  const markValidated = (id: string, note: string) => Promise.all([
    sb.from('incoming_missions').update({ touring_accepted_at: new Date().toISOString() }).eq('id', id),
    sb.from('mission_logs').insert({ mission_id: id, action: 'touring_synced', notes: note }).then(() => {}, () => {}),
  ])

  for (const row of data) {
    let cid: any; try { cid = JSON.parse((row as any).raw_content) } catch { continue }
    const CID_DOS = String(cid?.CID_DOS || '').trim()
    const CID_SEQ_ACTION = String(cid?.CID_SEQ_ACTION || '').trim()
    if (!CID_DOS || !CID_SEQ_ACTION) continue
    const st = statusByKey.get(`${CID_DOS.toUpperCase()}|${CID_SEQ_ACTION}`)
    if (!st) continue   // plus dans la liste active (07/sortie) → on ne touche pas

    if (st !== '03') {
      await markValidated((row as any).id, `Touring COMEX ↗ auto-validé — statut COMEX ${st} détecté par le poll (accepté par nous ou à la main).`)
      validated++
    } else if ((row as any).status !== 'new') {
      retried++
      try {
        const { acceptTouringMission } = await import('@/lib/touring/comex')
        const r = await acceptTouringMission({ CID_DOS, CID_SEQ_ACTION }, { noRetry: true })
        if (r.ok) { await markValidated((row as any).id, `Touring COMEX ↗ accepté au retry (poll) — COMEX ${r.statusBefore ?? '?'}→${r.statusAfter ?? '?'}.`); validated++ }
      } catch (e: any) { console.warn('[cron touring-reconcile] accept', CID_DOS, e?.message) }
    }
  }
  return { scanned: data.length, validated, retried }
}

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (process.env.DISABLE_TOURING_POLL === 'true') {
    return NextResponse.json({ ok: true, disabled: true })
  }

  const mode = process.env.TOURING_COMEX_MODE === 'import' ? 'import' : 'observe'

  // Balayages SLA (import uniquement) — INDÉPENDANTS du login/import COMEX pour ne
  // JAMAIS être bloqués si l'import/login échoue. Ils partent en PREMIER. Chacun
  // gère son propre login COMEX (session user). Bug corrigé 2026-07-08 : avant, ils
  // étaient dans le try de l'import → un login KO sautait tout l'auto-SLA.
  let slaRoad = { scanned: 0, pushed: 0 }
  let sla     = { scanned: 0, pushed: 0 }
  if (mode === 'import') {
    slaRoad = await runTouringOnRoadSweep().catch((e) => { console.warn('[cron touring-onroad]', e?.message); return { scanned: 0, pushed: 0 } })
    if (slaRoad.pushed > 0) console.log(`[cron touring-onroad] auto-onRoad=${slaRoad.pushed}/${slaRoad.scanned}`)
    sla = await runTouringSlaSweep().catch((e) => { console.warn('[cron touring-sla]', e?.message); return { scanned: 0, pushed: 0 } })
    if (sla.pushed > 0) console.log(`[cron touring-sla] auto-onSpot=${sla.pushed}/${sla.scanned}`)
  }

  try {
    const session  = await loginComex('dispatch')
    const missions = await listComexMissions(session)

    const statuts: Record<string, number> = {}
    for (const m of missions) statuts[m.COD_STATUT_MTR] = (statuts[m.COD_STATUT_MTR] || 0) + 1

    // Missions à VALIDER (statut 03 = 7 min pour accepter) + tout statut vraiment
    // inconnu (nouveau code éventuel).
    const aValider = missions.filter(m => m.COD_STATUT_MTR === STATUT_A_VALIDER)
    const unknown  = missions.filter(m => !KNOWN_STATUTS.has(m.COD_STATUT_MTR))

    console.log(`[cron touring-comex] mode=${mode} total=${missions.length} statuts=${JSON.stringify(statuts)} aValider=${aValider.length} unknown=${unknown.length}`)

    if (mode === 'observe') {
      // Alerte superadmin : mission(s) à valider (urgence 7 min) ou statut inconnu.
      if (aValider.length > 0) {
        const first = aValider[0]
        await sendPushToRole(['superadmin'], {
          title: `🟡 ${aValider.length} mission(s) Touring À VALIDER (7 min)`,
          body:  `ex ${first.NUM_PLAQUE} ${first.LIB_GAR} ${first.LOC || ''} (dossier ${first.CID_DOS}).`,
          url:   '/dispatch',
        }).catch(() => {})
      }
      if (unknown.length > 0) {
        const codes = Array.from(new Set(unknown.map(m => m.COD_STATUT_MTR))).join(', ')
        await sendPushToRole(['superadmin'], {
          title: `❓ Touring COMEX : statut inconnu ${codes}`,
          body:  `${unknown.length} mission(s) avec un code statut non répertorié.`,
          url:   '/api/touring/comex-debug',
        }).catch(() => {})
      }
      return NextResponse.json({
        ok: true, mode, total: missions.length, statuts,
        aValider: aValider.length,
        unknownStatuts: Array.from(new Set(unknown.map(m => m.COD_STATUT_MTR))),
      })
    }

    // mode === 'import' : crée les fiches VD Soft pour les missions À VALIDER (03),
    // dédup NUM_COMMANDE vs email. (04/05/06 déjà gérées côté COMEX ; 07 exclue.)
    const { runTouringImport } = await import('@/lib/touring/import')
    const result = await runTouringImport({ mode: 'send' })
    console.log(`[cron touring-comex] IMPORT total=${result.total} aValider=${result.aValider} created=${result.created} linked=${result.linked} skipped=${result.skipped} failed=${result.failed}`)
    // Notifie le dispatch quand de nouvelles fiches à valider sont créées.
    if (result.created > 0) {
      await sendPushToRole(['superadmin', 'admin', 'dispatcher'], {
        title: `🟡 ${result.created} mission(s) Touring à valider`,
        body:  `Importée(s) depuis COMEX (7 min pour valider). Onglet « En attente ».`,
        url:   '/dispatch',
      }).catch(() => {})
    }

    // Garde-fou anti-doublon : neutralise les fiches `new` dont le n° de dossier
    // a déjà une fiche avancée (ré-affectation Touring). Risque nul.
    try {
      const { neutralizeTouringDuplicates } = await import('@/lib/touring/neutralize-duplicates')
      const dedup = await neutralizeTouringDuplicates(createAdminClient())
      if (dedup.ignored > 0) console.log(`[cron touring-comex] doublons neutralisés: ${dedup.ignored} (${dedup.refs.join(',')})`)
      ;(result as any).duplicatesIgnored = dedup.ignored
    } catch (e: any) { console.warn('[cron touring-comex] neutralize KO:', e?.message) }

    // Réconciliation accept : auto-valide les 04+ (dont validations manuelles) et
    // rejoue les 03 confirmées (blip 500). Source de vérité = statut COMEX.
    let reconcile = { scanned: 0, validated: 0, retried: 0 }
    try {
      reconcile = await runTouringAcceptReconcile(missions)
      if (reconcile.validated || reconcile.retried) {
        console.log(`[cron touring-reconcile] validated=${reconcile.validated} retried=${reconcile.retried} scanned=${reconcile.scanned}`)
      }
    } catch (e: any) { console.warn('[cron touring-reconcile]', e?.message) }

    return NextResponse.json({ ...result, slaRoad, sla, reconcile })
  } catch (e: any) {
    console.error('[cron touring-comex]', e.message)
    // Les balayages SLA ont déjà tourné (en amont, indépendants) → on les renvoie.
    return NextResponse.json({ ok: false, error: e.message, slaRoad, sla }, { status: 500 })
  }
}
