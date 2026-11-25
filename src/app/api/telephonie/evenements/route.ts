// src/app/api/telephonie/evenements/route.ts — suite d'un appel que VD Soft a décroché (Olivier 24/11/2026) :
// « appel connecté » → transfert vers la file Teams, avec le numéro de l'appelant présenté et la fiche affichée dans
// la fenêtre d'appel de l'agent ; transfert refusé → nouvel essai plus simple, puis alerte. Événements du service d'appels (format CloudEvents). Adresse protégée par ?k=.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { lireConfigTel, alerterEchec } from '@/lib/telephonie/entrant'
import { transferer, type NiveauTransfert } from '@/lib/telephonie/acs'
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
    const cx = d.callConnectionId || a.connexion_id
    const base = { sujet: a.contexte?.sujet, nom: a.contexte?.nom, numero: a.numero, operationContext: a.id }
    const echec = async (err: string) => {
      await sb.from('appels_entrants').update({ statut: 'echec', erreur: err }).eq('id', a.id)
      await alerterEchec(await lireConfigTel(sb), { numero: a.numero, file: a.file }, err)
    }
    if (type === 'CallConnected' && a.statut === 'recu') {
      try {
        const t = await transferer(cx, a.contexte?.cible, base)
        // On note ce que Microsoft a accepté : numéro de l'appelant présenté (0), fiche seule (1) ou rien de plus (2).
        await sb.from('appels_entrants').update({ statut: 'renvoye', delai_ms: Date.now() - +new Date(a.debut), contexte: { ...(a.contexte || {}), transfert: t } }).eq('id', a.id)
      } catch (x: any) { await echec(String(x?.message || x)) }
    } else if (type === 'CallTransferFailed') {
      const motif = `${d.resultInformation?.message || d.resultInformation?.code || 'sans détail'}`
      // Trace pas encore écrite (refus arrivé très vite) : le premier essai était le plus complet dès qu'il y a un numéro.
      const fait = (a.contexte?.transfert || (a.numero ? { niveau: 1, refus: [] } : undefined)) as { niveau: NiveauTransfert; refus: string[] } | undefined
      // Refus après coup : l'appelant est toujours en ligne avec VD Soft. On retente aussitôt un cran plus simple
      // (sans le numéro présenté, puis sans la fiche) avant d'alerter.
      if (fait && fait.niveau < 2 && a.statut !== 'echec') {
        const refus = [...(fait.refus || []), `niveau ${fait.niveau} (après coup) : ${motif}`.slice(0, 200)]
        try {
          const t = await transferer(cx, a.contexte?.cible, { ...base, niveau: (fait.niveau + 1) as NiveauTransfert })
          await sb.from('appels_entrants').update({ contexte: { ...(a.contexte || {}), transfert: { niveau: t.niveau, refus: [...refus, ...t.refus] } } }).eq('id', a.id)
        } catch (x: any) { await echec(`Transfert refusé par Microsoft : ${motif} / ${String(x?.message || x)}`) }
      } else {
        await echec(`Transfert refusé par Microsoft : ${motif}`)
      }
    }
  }
  return NextResponse.json({ ok: true })
}
