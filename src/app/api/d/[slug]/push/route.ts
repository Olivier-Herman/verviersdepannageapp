// POST /api/d/[slug]/push — abonnement du client aux notifications de suivi (Olivier 10/10/2026).
//   { kind: 'web', subscription }  → navigateur / app installée (web push)
//   { kind: 'apns', token }        → app iPhone VD Assistance
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { getClientSession } from '@/lib/espace/clients'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const s = await getClientSession(params.slug)
  if (!s) return NextResponse.json({ error: 'Session expirée' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const web = b?.kind === 'web' && typeof b?.subscription?.endpoint === 'string'
  const apns = b?.kind === 'apns' && typeof b?.token === 'string' && /^[0-9a-f]{32,200}$/i.test(b.token)
  if (!web && !apns) return NextResponse.json({ error: 'Abonnement invalide' }, { status: 400 })
  const token = web ? String(b.subscription.endpoint).slice(0, 1000) : String(b.token)
  const { error } = await createAdminClient().from('espace_client_push').upsert(
    { client_id: s.client.id, kind: web ? 'web' : 'apns', token, subscription: web ? b.subscription : null },
    { onConflict: 'client_id,token' })
  return error ? NextResponse.json({ error: 'Enregistrement impossible' }, { status: 500 }) : NextResponse.json({ ok: true })
}
