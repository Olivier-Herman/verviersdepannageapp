// POST /api/mail-agent/scan — relance l'analyse du dossier surveillé.
// LECTURE SEULE côté Odoo (sauf si le mode 'auto' est activé).

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { sessionAccess }    from '@/lib/access'
import { scanFolder }       from '@/lib/mail-agent'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!sessionAccess(session, { modules: ['mail_agent', 'facturation'] }).ok) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  try {
    return NextResponse.json({ ok: true, ...(await scanFolder()) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Erreur' }, { status: 500 })
  }
}
