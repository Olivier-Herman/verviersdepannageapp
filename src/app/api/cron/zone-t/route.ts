// src/app/api/cron/zone-t/route.ts — zone T « chez le garagiste » (Olivier 22/10/2026).
// Chaque matin : un véhicule parti chez le garagiste (levée de saisie temporaire) depuis plus de 2 mois sans
// revenir sort du parc, motif « pas revenu de chez le garagiste » (le garagiste le garde, ou le contrôle technique
// est passé et la levée définitive a été donnée). Aucune facture : le gardiennage a été payé au départ.
// Un échec doit se voir.

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { exitPaidVehicle } from '@/lib/parc/verification'

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const sb = createAdminClient()
    const limite = new Date(Date.now() - 61 * 86_400_000).toISOString()   // 2 mois
    const { data } = await sb.from('incoming_missions').select('id, mission_number, vehicle_plate, zone_t_at, zone_t_garage')
      .eq('parc_zone_key', 'T').eq('status', 'parked').eq('dossier_leg', false).lt('zone_t_at', limite)
    const out: string[] = []
    for (const m of data || []) {
      const depuis = String(m.zone_t_at).slice(0, 10).split('-').reverse().join('/')
      const res = await exitPaidVehicle(sb, m.id, new Date().toISOString(), `pas revenu de chez le garagiste (zone T depuis le ${depuis}${m.zone_t_garage ? `, ${m.zone_t_garage}` : ''}) — sortie automatique après 2 mois`)
      await sb.from('incoming_missions').update({ parc_exit_reason: 'garagiste_non_revenu' }).eq('id', m.id)
      out.push(`${m.vehicle_plate || m.mission_number} : ${res}`)
    }
    return NextResponse.json({ ok: true, sortis: out.length, detail: out })
  } catch (e: any) {
    console.error('[cron zone-t]', e?.message || e)
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
