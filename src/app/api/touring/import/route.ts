// src/app/api/touring/import/route.ts
//
// POST /api/touring/import?mode=preview|send
//
// Endpoint MANUEL déclenché par le bouton « Import Touring » dans /dispatch
// (comme « Import VAB »). Utilise le même helper runTouringImport que le cron →
// mapping unique garanti (cf lib/touring/import.ts).
//
// L'import LIT COMEX et CRÉE les fiches VD Soft (statut 03 à valider) : il ne
// MUTE RIEN côté Touring (l'acceptation ne part qu'au « Valider », et seulement
// si TOURING_COMEX_MODE=import). Donc sûr même en mode observe.
//
// Accès : SUPERADMIN uniquement pendant la phase de validation COMEX (garde-fou
// « être certain du parsing avant de basculer l'équipe »). À élargir ensuite.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { runTouringImport } from '@/lib/touring/import'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const roles: string[] = Array.isArray(user.roles) ? user.roles : (user.role ? [user.role] : [])
  if (!roles.includes('superadmin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const mode = new URL(req.url).searchParams.get('mode') === 'send' ? 'send' : 'preview'

  try {
    const result = await runTouringImport({ mode })
    return NextResponse.json(result)
  } catch (e: any) {
    console.error('[api/touring/import]', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
