// src/app/api/cron/vab-open-alert/route.ts
//
// LA VIGIE (Olivier 2026-08-24).
//
// Le filet `vab-close-retry` reprend les clôtures ratées tous les quarts d'heure.
// Ce qui manquait, c'est que quelqu'un SACHE quand il n'y arrive pas : le 24/08,
// dix dossiers attendaient depuis quatre jours pendant que le filet rejouait dans
// le vide — personne ne l'a vu avant qu'Olivier ne pose la question.
//
// Un passage par jour à 5 h UTC, avant l'ouverture. On compare la liste des
// dossiers encore ouverts chez VAB à nos missions terminées, et on prévient s'il
// en reste. Rien à signaler = silence : une alerte qui parle tous les jours
// n'est plus lue au bout d'une semaine.
//
// Cette route ne clôture RIEN. Elle regarde et elle alerte — le filet, lui, agit.
// Deux Chromium sur un compte VAB partagé, c'est la session cassée des deux côtés.

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

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
    const ouverts = [...new Set((missions as any[])
      .map(m => String(m.detailHref || '').replace(/.*AssignmentId=/, '').trim())
      .filter(Boolean))]

    const sb = createAdminClient()

    // Deux familles, qui n'appellent pas le même geste :
    //   • à clôturer  → l'intervention est finie chez nous, le filet doit y arriver.
    //                   S'il en reste, c'est qu'il n'y arrive pas.
    //   • à regarder  → aucune fiche terminée en face : mission jamais traitée,
    //                   annulée, ou doublon envoyé par VAB. Là, c'est une décision
    //                   humaine — accepter, refuser — pas une clôture.
    const { data: fiches } = ouverts.length
      ? await sb.from('incoming_missions')
          .select('vehicle_plate, external_id, status, vab_assignment_ids, updated_at')
          .overlaps('vab_assignment_ids', ouverts)
      : { data: [] as any[] }

    const aClôturer = ((fiches || []) as any[]).filter(f => TERMINÉES.includes(f.status))
    const couverts  = new Set(((fiches || []) as any[]).flatMap(f => f.vab_assignment_ids || []))
    const àRegarder = ouverts.filter(aid => !aClôturer.some(f => (f.vab_assignment_ids || []).includes(aid)))

    if (!aClôturer.length && !àRegarder.length) {
      return NextResponse.json({ ok: true, ouverts: ouverts.length, rien: true })
    }

    const plaques = aClôturer.map(f => f.vehicle_plate).filter(Boolean).join(', ')
    const corps = [
      aClôturer.length ? `${aClôturer.length} clôture(s) que le filet n'arrive pas à passer : ${plaques}` : '',
      àRegarder.length ? `${àRegarder.length} dossier(s) sans fiche terminée en face (à accepter, refuser ou vérifier) : ${àRegarder.join(', ')}` : '',
    ].filter(Boolean).join(' · ')

    const { sendNotificationToRoles } = await import('@/lib/notifications/send')
    const envoi = await sendNotificationToRoles(['superadmin'], 'vab_dossiers_ouverts', {
      title:      `🚨 VAB : ${ouverts.length} dossier(s) encore ouvert(s)`,
      body:       corps.length > 180 ? corps.slice(0, 177) + '…' : corps,
      action_url: '/dispatch',
    })

    console.log(`[cron vab-open-alert] ouverts=${ouverts.length} àClôturer=${aClôturer.length} àRegarder=${àRegarder.length}`)
    return NextResponse.json({
      ok: true, ouverts: ouverts.length,
      aClôturer: aClôturer.map(f => ({ plaque: f.vehicle_plate, statut: f.status })),
      àRegarder, notifiés: envoi.sent, couverts: couverts.size,
    })
  } catch (e: any) {
    console.error('[cron vab-open-alert]', e?.message)
    return NextResponse.json({ error: e?.message || 'erreur' }, { status: 500 })
  }
}
