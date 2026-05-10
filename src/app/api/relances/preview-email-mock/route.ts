// ============================================================
// GET /api/relances/preview-email-mock?level=1|2|3
// ============================================================
// Apercu du HTML mail de relance pour validation visuelle Olivier.
// Donnees mock (Touring Belgium SA, total 4.661,20 €). Retourne du
// HTML pur (Content-Type: text/html) pour rendu direct dans le
// navigateur — pas un JSON ni un fichier a telecharger.

export const dynamic     = 'force-dynamic'
export const maxDuration = 10

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'
import { buildReminderHtml }         from '@/lib/relances/email'
import type { ReminderLevel }        from '@/lib/relances/odoo'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const userId   = (session.user as any).id as string
  const supabase = createAdminClient()
  const { data: moduleRow } = await supabase
    .from('user_modules')
    .select('granted')
    .eq('user_id',   userId)
    .eq('module_id', 'relances')
    .eq('granted',   true)
    .maybeSingle()
  if (!moduleRow) return NextResponse.json({ error: 'Module relances non activé' }, { status: 403 })

  const url    = new URL(req.url)
  const lvlRaw = url.searchParams.get('level') || '1'
  const lvl    = parseInt(lvlRaw, 10)
  if (lvl !== 1 && lvl !== 2 && lvl !== 3) {
    return NextResponse.json({ error: 'level doit etre 1, 2 ou 3' }, { status: 400 })
  }
  const level = lvl as ReminderLevel
  const sentDate = new Date().toISOString().slice(0, 10)

  const html = buildReminderHtml({
    level,
    partnerName:  'Touring Belgium SA',
    reference:    `REL-MOCK-${level}-${sentDate.replace(/-/g, '')}`,
    totalDue:     4661.20,
    invoiceCount: 3,
    sentDate,
  })

  return new NextResponse(html, {
    status:  200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
