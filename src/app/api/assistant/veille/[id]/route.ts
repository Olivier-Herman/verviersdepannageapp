// POST /api/assistant/veille/[id] { reponse } — réponse à une question de Max.
import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { veilleUser }        from '@/lib/assistant/access'
import { answerVeille }      from '@/lib/assistant/veille'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await veilleUser()
  if (!user) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  try {
    const message = await answerVeille(createAdminClient(), params.id, String(body.reponse || ''), { id: user.id, name: user.name || user.email })
    return NextResponse.json({ ok: true, message })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 })
  }
}
