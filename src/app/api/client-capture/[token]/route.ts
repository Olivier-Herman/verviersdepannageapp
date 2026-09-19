// src/app/api/client-capture/[token]/route.ts
//
// PUBLIC (le jeton uuid = l'autorisation, 30 min, usage unique).
//   GET  → { status, plate, lang, data } — la page client (et le chauffeur en repli du realtime)
//   POST { lang, first_name, last_name, street, zip, city, country_code, address, email, phone }
//        → enregistre, status = done. Olivier 19/09/2026.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
const ok = (id: string) => /^[0-9a-f-]{36}$/i.test(id)

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  if (!ok(params.token)) return NextResponse.json({ error: 'Lien invalide' }, { status: 404 })
  const sb = createAdminClient()
  const { data: c } = await sb.from('client_capture').select('id, plate, lang, status, data, expires_at, done_at').eq('id', params.token).maybeSingle()
  if (!c) return NextResponse.json({ error: 'Lien invalide' }, { status: 404 })
  const expired = c.status === 'open' && new Date(c.expires_at).getTime() < Date.now()
  return NextResponse.json({ status: expired ? 'expired' : c.status, plate: c.plate, lang: c.lang, data: c.status === 'done' ? c.data : null, done_at: c.done_at })
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  if (!ok(params.token)) return NextResponse.json({ error: 'Lien invalide' }, { status: 404 })
  const sb = createAdminClient()
  const { data: c } = await sb.from('client_capture').select('id, status, expires_at').eq('id', params.token).maybeSingle()
  if (!c) return NextResponse.json({ error: 'Lien invalide' }, { status: 404 })
  if (c.status !== 'open' || new Date(c.expires_at).getTime() < Date.now()) return NextResponse.json({ error: 'Lien expiré ou déjà utilisé' }, { status: 410 })

  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  const s = (k: string, max = 200) => String(b[k] ?? '').trim().slice(0, max)
  const kind = s('kind', 10) === 'pro' ? 'pro' : 'private'
  const company = s('company', 120), vat = s('vat', 20).replace(/[\s.-]/g, '').toUpperCase()
  const first = s('first_name', 80), last = s('last_name', 80)
  const email = s('email', 120).toLowerCase()
  if (kind === 'pro' ? !company : (!first || !last)) return NextResponse.json({ error: 'name_required' }, { status: 400 })
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'email_invalid' }, { status: 400 })
  const data = {
    kind, company: kind === 'pro' ? company : '', vat: kind === 'pro' ? vat : '', vies_valid: kind === 'pro' && b.vies_valid === true,
    first_name: first, last_name: last,
    street: s('street'), zip: s('zip', 20), city: s('city', 100), country_code: (s('country_code', 2) || 'BE').toUpperCase(),
    address: s('address', 300), email, phone: s('phone', 40),
  }
  const { error } = await sb.from('client_capture')
    .update({ status: 'done', data, lang: s('lang', 5) || null, done_at: new Date().toISOString() })
    .eq('id', params.token).eq('status', 'open')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
