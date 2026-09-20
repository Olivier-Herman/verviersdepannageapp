// POST /api/voice/interpret { step, transcript, context } → champs structurés (assistant vocal chauffeur).
import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { interpretUtterance, type VoiceStep } from '@/lib/voice/interpret'

export const dynamic = 'force-dynamic'
const STEPS: VoiceStep[] = ['intent', 'plate', 'vehicle', 'address', 'zone_agent', 'destination', 'yesno', 'pointage_pick']

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { step?: string; transcript?: string; context?: any }
  const step = String(body.step || '') as VoiceStep
  if (!STEPS.includes(step)) return NextResponse.json({ error: 'Étape inconnue' }, { status: 400 })
  const transcript = String(body.transcript || '').slice(0, 600)
  if (!transcript.trim()) return NextResponse.json({ ok: true, data: { understood: false, ask: 'Je n\'ai rien entendu, tu peux répéter ?' } })
  try {
    const data = await interpretUtterance(step, transcript, body.context || {})
    return NextResponse.json({ ok: true, data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Interprétation impossible' }, { status: 500 })
  }
}
