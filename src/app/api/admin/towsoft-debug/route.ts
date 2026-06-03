// src/app/api/admin/towsoft-debug/route.ts
//
// GET /api/admin/towsoft-debug?num=55569
// Retourne le HTML brut d une fiche TowSoft pour debug du scraper.
// Admin/superadmin uniquement.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'

const TOWSOFT_URL  = process.env.TOWSOFT_URL || 'https://verviers.towsoft.ca'
const TOWSOFT_USER = process.env.TOWSOFT_USER || 'VDBot'
const TOWSOFT_PASS = process.env.TOWSOFT_PASS

export const dynamic = 'force-dynamic'
export const maxDuration = 30

async function loginTowsoft(): Promise<string> {
  if (!TOWSOFT_PASS) throw new Error('TOWSOFT_PASS manquant')
  const res = await fetch(`${TOWSOFT_URL}/auth/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    `nomusager=${encodeURIComponent(TOWSOFT_USER)}&passusager=${encodeURIComponent(TOWSOFT_PASS)}`,
    redirect: 'manual',
  })
  const cookie = res.headers.get('set-cookie')
  if (!cookie) throw new Error('Login Towsoft echoue')
  return cookie.split(';')[0]
}

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

  const mode = url.searchParams.get('mode') || 'json'  // 'json' (debug) ou 'html' (raw)

  try {
    const cookie = await loginTowsoft()
    const r = await fetch(`${TOWSOFT_URL}/appel.php?num=${encodeURIComponent(num)}`, {
      headers: { Cookie: cookie },
      redirect: 'manual',
    })
    const html = await r.text()

    if (mode === 'html') {
      return new NextResponse(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

    // Mode JSON debug : montre status, length, premier morceau, et tous les data-* uniques
    const dataAttrs = Array.from(new Set(
      (html.match(/data-[a-z0-9-]+="[^"]*"/gi) || []).map(m => m.replace(/="[^"]*"/, ''))
    ))
    const ids = Array.from(new Set(
      (html.match(/id="[a-z0-9-_]+"/gi) || []).map(m => m.replace(/^id="|"$/g, ''))
    ))

    return NextResponse.json({
      ok: true,
      towsoft_url:     TOWSOFT_URL,
      fetch_status:    r.status,
      fetch_redirect:  r.headers.get('location'),
      html_length:     html.length,
      html_starts_with: html.slice(0, 500),
      contains_login:  html.includes('auth/login') || html.includes('nomusager'),
      data_attrs:      dataAttrs,
      ids:             ids,
      hint:            'Pour voir le HTML brut : ajoute &mode=html',
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message, stack: e.stack }, { status: 500 })
  }
}
