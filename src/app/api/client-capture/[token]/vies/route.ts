// src/app/api/client-capture/[token]/vies/route.ts
//
// PUBLIC, gardé par le jeton QR client (ouvert, non expiré) : vérification VIES
// d'un n° de TVA saisi par un client PRO sur son téléphone → nom + adresse
// officiels. Même lib que le formulaire chauffeur (lib/vies). Olivier 19/09/2026.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { checkVat }          from '@/lib/vies'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: { token: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.token)) return NextResponse.json({ error: 'Lien invalide' }, { status: 404 })
  const { data: c } = await createAdminClient().from('client_capture').select('status, expires_at').eq('id', params.token).maybeSingle()
  if (!c || c.status !== 'open' || new Date(c.expires_at).getTime() < Date.now()) return NextResponse.json({ error: 'Lien invalide' }, { status: 404 })
  const vat = String(new URL(req.url).searchParams.get('vat') || '').replace(/[\s.-]/g, '').toUpperCase()
  if (vat.length < 5) return NextResponse.json({ error: 'vat' }, { status: 400 })
  const r = await checkVat(vat)
  return NextResponse.json({ valid: !!r.valid, name: r.name || null, address: r.address || null })
}
