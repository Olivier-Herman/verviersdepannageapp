// Cron : analyse périodique du dossier mail surveillé.
// En mode 'draft' (défaut) le cron ne fait que préparer le diagnostic ;
// il n'écrit dans Odoo que si le mode 'auto' a été activé explicitement.

import { NextResponse } from 'next/server'
import { scanFolder }   from '@/lib/mail-agent'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return NextResponse.json({ ok: true, ...(await scanFolder()) })
  } catch (err: any) {
    console.error('[cron mail-agent] KO:', err?.message)
    return NextResponse.json({ error: err?.message || 'Erreur' }, { status: 500 })
  }
}
