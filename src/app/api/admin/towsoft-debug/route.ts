// src/app/api/admin/towsoft-debug/route.ts
//
// GET /api/admin/towsoft-debug?num=55569
// Scrape une fiche TowSoft via Puppeteer (Browserless) et retourne les
// donnees parsees + le HTML brut (mode=html) pour identifier les champs
// supplementaires a extraire.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { scrapeTowsoftMissionPuppeteer } from '@/lib/towsoft-scrape-puppeteer'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['admin', 'superadmin'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const num = (url.searchParams.get('num') || '').trim()
  if (!num) return NextResponse.json({ error: 'num requis (?num=55569)' }, { status: 400 })
  const mode = url.searchParams.get('mode') || 'json'

  const result = await scrapeTowsoftMissionPuppeteer(num, { returnHtml: mode === 'html' })

  if (mode === 'html' && result.ok && result.html) {
    return new NextResponse(result.html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 })
  }

  // Mode JSON debug : retour le parsing + indicateurs sur ce qu on a/manque
  return NextResponse.json({
    ok: true,
    data: result.data,
    hint: 'Pour voir le HTML brut : ajoute &mode=html',
  })
}
