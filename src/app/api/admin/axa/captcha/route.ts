// src/app/api/admin/axa/captcha/route.ts — captcha AXA montré pendant « Reconnecter maintenant » (Olivier 14/11/2026).
//   GET            → { image, at } si un captcha attend une réponse, sinon { image: null }
//   POST {answer}  → transmet ce que Mobi a tapé au robot de connexion (qui attend 2 min au plus)
import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { AXA_CAPTCHA_KEY }   from '@/lib/axa/relogin-run'

export const dynamic = 'force-dynamic'

function isSuperadmin(session: any): boolean {
  return session?.user?.role === 'superadmin' || (Array.isArray(session?.user?.roles) && session.user.roles.includes('superadmin'))
}

async function lire(sb: any): Promise<any | null> {
  const { data } = await sb.from('app_settings').select('value').eq('key', AXA_CAPTCHA_KEY).maybeSingle()
  try { return data?.value ? JSON.parse(data.value) : null } catch { return null }
}

export async function GET() {
  if (!isSuperadmin(await getServerSession(authOptions))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const v = await lire(createAdminClient())
  const frais = v && !v.answer && Date.now() - Date.parse(v.at) < 2 * 60_000
  return NextResponse.json({ id: frais ? v.id : null, image: frais ? v.image : null, at: frais ? v.at : null }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: Request) {
  if (!isSuperadmin(await getServerSession(authOptions))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const answer = String(b.answer || '').trim().slice(0, 20)
  if (!answer) return NextResponse.json({ error: 'Tape les caractères de l’image.' }, { status: 400 })
  const sb = createAdminClient()
  const v = await lire(sb)
  if (!v || v.id !== b.id) return NextResponse.json({ error: 'Ce captcha a expiré : relance « Reconnecter maintenant ».' }, { status: 409 })
  await sb.from('app_settings').update({ value: JSON.stringify({ ...v, answer, answered_at: new Date().toISOString() }) }).eq('key', AXA_CAPTCHA_KEY)
  return NextResponse.json({ ok: true })
}
