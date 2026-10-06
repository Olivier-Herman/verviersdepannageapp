// Cron : analyse périodique du dossier mail surveillé.
// En mode 'draft' (défaut) le cron ne fait que préparer le diagnostic ;
// il n'écrit dans Odoo que si le mode 'auto' a été activé explicitement.

import { NextResponse } from 'next/server'
import { scanMailboxes } from '@/lib/mail-agent'
import { refreshAwpSenders } from '@/lib/mail-agent/handlers/awp-rejet'
import { refreshImaSenders } from '@/lib/mail-agent/handlers/ima-rejet'
import { withAiContext } from '@/lib/ai/usage'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300   // scan incrémental de toute la boîte (185 dossiers)

async function handleGET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    // Expéditeurs des rejets = réglages métier, relus à chaque passage (plus de liste codée).
    await Promise.all([refreshAwpSenders(), refreshImaSenders()])
    // Olivier 23/09/2026 : toutes les 15 min. Deux jours (06/10/2026) : une facture mise en attente
    // de sa version Peppol est revérifiée 24 h plus tard, il faut donc encore la voir.
    return NextResponse.json({ ok: true, ...(await scanMailboxes({ sinceDays: 2, limit: 50 })) })
  } catch (err: any) {
    console.error('[cron mail-agent] KO:', err?.message)
    return NextResponse.json({ error: err?.message || 'Erreur' }, { status: 500 })
  }
}


// Les appels d'IA de ce passage sont comptés sous « cron:mail-agent » (conso_ia).
export async function GET(...args: Parameters<typeof handleGET>) {
  return withAiContext({ declencheur: 'cron:mail-agent' }, () => handleGET(...args))
}
