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

// Olivier 2026-06-03 : sequence correcte = GET / pour obtenir PHPSESSID,
// puis POST /login.php AVEC ce PHPSESSID (sinon le serveur cree une nouvelle
// session anonyme et l auth n est pas associee au cookie qu on garde).
async function loginTowsoft(): Promise<{
  cookie:           string
  initial_status:   number
  login_status:     number
  login_location:   string | null
  login_response:   string  // premiers 500 chars pour debug
}> {
  if (!TOWSOFT_PASS) throw new Error('TOWSOFT_PASS manquant')

  // Etape 1 : GET / pour obtenir un PHPSESSID anonyme
  const initRes = await fetch(`${TOWSOFT_URL}/`, { redirect: 'manual' })
  const initCookie = initRes.headers.get('set-cookie')
  const cookie = initCookie ? initCookie.split(';')[0] : ''

  // Etape 2 : POST /login.php avec ce cookie
  const loginRes = await fetch(`${TOWSOFT_URL}/login.php`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie':       cookie,
    },
    body:    `nomusager=${encodeURIComponent(TOWSOFT_USER)}&passusager=${encodeURIComponent(TOWSOFT_PASS)}`,
    redirect: 'manual',
  })
  // Si TowSoft retourne un nouveau cookie suite au login, on le prend
  const newCookie = loginRes.headers.get('set-cookie')
  const finalCookie = newCookie ? newCookie.split(';')[0] : cookie

  const body = await loginRes.text()
  return {
    cookie:           finalCookie,
    initial_status:   initRes.status,
    login_status:     loginRes.status,
    login_location:   loginRes.headers.get('location'),
    login_response:   body.slice(0, 500),
  }
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
    const loginInfo = await loginTowsoft()
    const cookie = loginInfo.cookie
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
      towsoft_url:      TOWSOFT_URL,
      towsoft_user:     TOWSOFT_USER,
      pass_set:         !!TOWSOFT_PASS,
      login:            {
        initial_status:   loginInfo.initial_status,
        login_status:     loginInfo.login_status,
        login_location:   loginInfo.login_location,
        cookie_preview:   cookie.slice(0, 50) + '…',
        login_response_preview: loginInfo.login_response,
      },
      fetch: {
        status:    r.status,
        redirect:  r.headers.get('location'),
        html_length: html.length,
        html_starts_with: html.slice(0, 500),
        contains_login:  html.includes('auth/login') || html.includes('nomusager') || html.includes('login.php'),
      },
      data_attrs:      dataAttrs,
      ids:             ids,
      hint:            'Pour voir le HTML brut : ajoute &mode=html',
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message, stack: e.stack }, { status: 500 })
  }
}
