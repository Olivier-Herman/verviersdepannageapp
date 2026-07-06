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
import { sendPushToRole } from '@/lib/push'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

// Statuts COMEX (confirmés Olivier 2026-07-06) : 03 = À VALIDER (carte noire +
// décompte 7 min), 04 acceptée, 06 sur place, 07 terminée.
const STATUT_A_VALIDER = '03'
const KNOWN_STATUTS = new Set(['03', '04', '06', '07'])

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (process.env.DISABLE_TOURING_POLL === 'true') {
    return NextResponse.json({ ok: true, disabled: true })
  }

  const mode = process.env.TOURING_COMEX_MODE === 'import' ? 'import' : 'observe'

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

    // mode === 'import' : sera implémenté après confirmation du statut "à valider"
    // (création des fiches actives, dédup sur NUM_COMMANDE vs email). Pas encore actif.
    return NextResponse.json({ ok: true, mode, total: missions.length, statuts, note: 'import mode non implémenté' })
  } catch (e: any) {
    console.error('[cron touring-comex]', e.message)
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
