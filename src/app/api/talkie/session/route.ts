// GET /api/talkie/session → canaux du talkie accessibles (Garde de nuit ; direct
// vers Mobi / IT). Cf lib/talkie/session.ts.
import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { talkieAccess }     from '@/lib/talkie/session'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Bouton du talkie caché sur ordinateur pour certaines personnes (réglage
  // talkie_masque_pc, Olivier 14/10/2026 : il cachait Max) ; l'iPhone garde tout.
  const email = String((session.user as any)?.email || '').toLowerCase()
  let hideOnWeb = false
  try { const { getBusinessList } = await import('@/lib/settings/business'); hideOnWeb = (await getBusinessList('talkie_masque_pc')).map(x => String(x).toLowerCase()).includes(email) } catch {}
  return NextResponse.json({ ...(await talkieAccess(session.user as any)), hideOnWeb })
}
