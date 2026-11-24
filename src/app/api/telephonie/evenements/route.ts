// src/app/api/telephonie/evenements/route.ts — suite d'un appel que VD Soft a décroché (Olivier 24/11/2026) :
// « appel connecté » → transfert vers la file Teams, avec la fiche affichée dans la fenêtre d'appel de l'agent ;
// transfert refusé → alerte. Événements du service d'appels (format CloudEvents). Adresse protégée par ?k=.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { lireConfigTel, alerterEchec } from '@/lib/telephonie/entrant'
import { transferer } from '@/lib/telephonie/acs'
import { cleValide } from '@/lib/telephonie/cle'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  if (!cleValide(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const evts = await req.json().catch(() => [])
  const sb = createAdminClient()
  for (const e of (Array.isArray(evts) ? evts : [evts])) {
    const type = String(e?.type || e?.eventType || '').replace('Microsoft.Communication.', '')
    const d = e?.data || {}
    const id = d.operationContext || d.correlationId
    const { data: row } = id ? await sb.from('appels_entrants').select('*').eq('id', id).maybeSingle() : { data: null }
    if (!row) continue
    const a = row as any
    if (type === 'CallConnected' && a.statut === 'recu') {
      try {
        await transferer(d.callConnectionId || a.connexion_id, a.contexte?.cible, { sujet: a.contexte?.sujet, nom: a.contexte?.nom, numero: a.numero, operationContext: a.id })
        await sb.from('appels_entrants').update({ statut: 'renvoye', delai_ms: Date.now() - +new Date(a.debut) }).eq('id', a.id)
      } catch (x: any) {
        const err = String(x?.message || x)
        await sb.from('appels_entrants').update({ statut: 'echec', erreur: err }).eq('id', a.id)
        await alerterEchec(await lireConfigTel(sb), { numero: a.numero, file: a.file }, err)
      }
    } else if (type === 'CallTransferFailed') {
      const err = `Transfert refusé par Microsoft : ${d.resultInformation?.message || d.resultInformation?.code || 'sans détail'}`
      await sb.from('appels_entrants').update({ statut: 'echec', erreur: err }).eq('id', a.id)
      await alerterEchec(await lireConfigTel(sb), { numero: a.numero, file: a.file }, err)
    }
  }
  return NextResponse.json({ ok: true })
}
