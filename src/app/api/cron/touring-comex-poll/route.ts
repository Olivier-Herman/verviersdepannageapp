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

// Statuts déjà identifiés (Olivier 2026-07-06) : 04 acceptée, 06 sur place,
// 07 terminée. Un code HORS de cette liste = candidat "à valider" (jaune).
const KNOWN_STATUTS = new Set(['04', '06', '07'])

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

    // Statuts inconnus (≠ 04/06/07) → très probablement le "à valider" jaune.
    const unknown = missions.filter(m => !KNOWN_STATUTS.has(m.COD_STATUT_MTR))

    console.log(`[cron touring-comex] mode=${mode} total=${missions.length} statuts=${JSON.stringify(statuts)} unknown=${unknown.length}`)

    if (mode === 'observe') {
      // On alerte le superadmin dès qu'un statut inconnu (à valider) apparaît,
      // pour capturer le code ET réagir manuellement dans les 7 min.
      if (unknown.length > 0) {
        const codes = Array.from(new Set(unknown.map(m => m.COD_STATUT_MTR))).join(', ')
        const first = unknown[0]
        await sendPushToRole(['superadmin'], {
          title: `🟡 Touring COMEX : statut inconnu ${codes}`,
          body:  `${unknown.length} mission(s) — ex ${first.NUM_PLAQUE} ${first.LOC || ''} (dossier ${first.CID_DOS}). Code à confirmer = "à valider".`,
          url:   '/api/touring/comex-debug',
        }).catch(() => {})
      }
      return NextResponse.json({
        ok: true, mode, total: missions.length, statuts,
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
