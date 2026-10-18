// GET /api/missions/transfers/incoming — transferts en attente pour le chauffeur connecté.
import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { incomingTransfers } from '@/lib/missions/pause-transfer'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u?.id) return NextResponse.json({ transfers: [] })
  return NextResponse.json({ transfers: await incomingTransfers(createAdminClient(), u.id) })
}
