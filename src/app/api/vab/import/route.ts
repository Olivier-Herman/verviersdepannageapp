// src/app/api/vab/import/route.ts
//
// POST /api/vab/import?mode=preview|send
//
// Preview : liste les missions visibles sur comet.vab.be et flagge celles
//           qui existent deja en BDD (via external_id ou source=vab + plate).
// Send    : pour chaque mission non encore importee, declenche l'envoi email
//           depuis VAB → l'email arrivera dans la boite et sera parse par
//           le flow existant.
//
// Acces : admin / superadmin / dispatcher uniquement.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { loginVab, listVabMissions, sendVabMissionEmail } from '@/lib/vab/scraper'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60   // login + list + N x send = peut prendre 30-40s

const DESTINATION_EMAIL = 'assistance@verviersdepannage.com'

interface PreviewItem {
  missionNumber: string
  detailHref:    string | null
  status:        string | null
  plate:         string | null
  fromLocation:  string | null
  toLocation:    string | null
  alreadyImported: boolean
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role: string = user.role || ''
  const hasAccess = ['admin', 'superadmin', 'dispatcher'].includes(role)
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(req.url)
  const mode = url.searchParams.get('mode') === 'send' ? 'send' : 'preview'

  try {
    const session = await loginVab()
    const missions = await listVabMissions(session)

    // Cross-check avec la BDD : quelles missions VAB sont deja importees ?
    // On compare par external_id (n° VAB) sur les missions source=vab.
    const sb = createAdminClient()
    const missionNumbers = missions.map(m => m.missionNumber)
    const { data: existing } = missionNumbers.length > 0
      ? await sb
          .from('incoming_missions')
          .select('external_id')
          .ilike('source', 'vab')
          .in('external_id', missionNumbers)
      : { data: [] as { external_id: string }[] }

    const existingSet = new Set((existing || []).map(e => e.external_id))
    const items: PreviewItem[] = missions.map(m => ({
      missionNumber: m.missionNumber,
      detailHref:    m.detailHref,
      status:        m.status,
      plate:         m.plate,
      fromLocation:  m.fromLocation,
      toLocation:    m.toLocation,
      alreadyImported: existingSet.has(m.missionNumber),
    }))

    // Mode preview : on retourne juste la liste avec flags
    if (mode === 'preview') {
      return NextResponse.json({
        ok: true,
        mode: 'preview',
        total: items.length,
        new:   items.filter(i => !i.alreadyImported).length,
        items,
      })
    }

    // Mode send : declenche les emails pour les missions non encore importees
    const toSend = items.filter(i => !i.alreadyImported && i.detailHref)
    const results: Array<{ missionNumber: string; ok: boolean; error?: string }> = []

    for (const item of toSend) {
      if (!item.detailHref) {
        results.push({ missionNumber: item.missionNumber, ok: false, error: 'detailHref manquant' })
        continue
      }
      try {
        const r = await sendVabMissionEmail(session, item.detailHref, DESTINATION_EMAIL)
        results.push({ missionNumber: item.missionNumber, ok: r.ok, error: r.ok ? undefined : r.error })
      } catch (e: any) {
        results.push({ missionNumber: item.missionNumber, ok: false, error: e.message || 'Erreur' })
      }
    }

    const success = results.filter(r => r.ok).length
    const failed  = results.filter(r => !r.ok).length

    return NextResponse.json({
      ok: true,
      mode: 'send',
      total:   items.length,
      already: items.filter(i => i.alreadyImported).length,
      attempted: toSend.length,
      success,
      failed,
      results,
    })
  } catch (e: any) {
    console.error('[api/vab/import]', e.message)
    return NextResponse.json({ error: e.message || 'Erreur import VAB' }, { status: 500 })
  }
}
