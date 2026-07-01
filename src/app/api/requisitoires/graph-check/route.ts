// src/app/api/requisitoires/graph-check/route.ts
//
// GET /api/requisitoires/graph-check
//   Diagnostic de l'accès Graph à fourriere@ : token + lecture des dossiers +
//   écriture (création du dossier « Mail auto-géré »). Sert à comprendre pourquoi
//   le déplacement des mails échoue. Accès : admin / superadmin / module fourriere.
//
// Olivier 2026-07-01.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { checkMailboxAccess } from '@/lib/requisitoire/graph'
import { FOURRIERE_MAILBOX } from '@/lib/requisitoire/intake'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  const role = user?.role || ''
  const modules: string[] = Array.isArray(user?.modules) ? user.modules : []
  if (!user || (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // client_id public utilisé (pour vérifier qu'on pointe la bonne app).
  const clientIdTail = (process.env.AZURE_AD_CLIENT_ID || '').slice(-6)
  const result = await checkMailboxAccess(FOURRIERE_MAILBOX)
  return NextResponse.json({ azure_client_id_tail: clientIdTail, ...result })
}
