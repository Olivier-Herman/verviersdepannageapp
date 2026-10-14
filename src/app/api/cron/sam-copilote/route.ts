// src/app/api/cron/sam-copilote/route.ts — Sam copilote du chauffeur (Olivier 14/10/2026), toutes les 2 min.
// Détecte ce qui va bloquer le chauffeur et lui écrit le premier (lib/sam/copilote). Un échec doit se voir.
export const dynamic     = 'force-dynamic'
export const maxDuration = 120

import { NextResponse } from 'next/server'
import { withAiContext } from '@/lib/ai/usage'

async function handleGET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { tickCopilote } = await import('@/lib/sam/copilote')
    const r = await tickCopilote()
    if (r.envoyees || r.dispatch) console.log('[sam-copilote]', JSON.stringify(r))
    return NextResponse.json({ ok: true, ...r })
  } catch (e: any) {
    console.error('[sam-copilote]', e?.message || e)
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}

export async function GET(...args: Parameters<typeof handleGET>) {
  return withAiContext({ declencheur: 'cron:sam-copilote' }, () => handleGET(...args))
}
