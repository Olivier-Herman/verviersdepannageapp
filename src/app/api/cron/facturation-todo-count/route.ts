// Cron (toutes les 15 min) : recalcule « À facturer, toutes sources hors Touring »
// avec le moteur de la Facturation par dossier et le met en cache pour la
// pastille du menu (lib/dossier/todo-count.ts). Olivier 10/09/2026.
import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { refreshFacturationTodoCount } from '@/lib/dossier/todo-count'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const r = await refreshFacturationTodoCount(createAdminClient())
    return NextResponse.json({ ok: true, ...r })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 })
  }
}
