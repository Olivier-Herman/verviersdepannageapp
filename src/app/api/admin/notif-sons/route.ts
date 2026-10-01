// GET/POST /api/admin/notif-sons — son retenu par famille de notification (iPhone).
// Olivier 02/10/2026. Cf lib/notifications/sound-families.ts.
import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { sessionAccess }    from '@/lib/access'
import { loadSoundChoices, saveSoundChoices } from '@/lib/notifications/sound-families'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!sessionAccess(session).ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  return NextResponse.json({ choices: await loadSoundChoices(true) })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!sessionAccess(session).ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  return NextResponse.json({ choices: await saveSoundChoices(b?.choices || {}) })
}
