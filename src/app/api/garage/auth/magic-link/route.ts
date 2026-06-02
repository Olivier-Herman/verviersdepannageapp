// POST /api/garage/auth/magic-link { email } — envoie un lien magique au user
// garage si le compte existe. Reponse generique (ne revele pas l existence du
// compte) pour eviter l enumeration.
// Olivier 2026-06-02.

import { NextResponse }            from 'next/server'
import { createAdminClient }       from '@/lib/supabase'
import { sendGarageWelcomeEmail }  from '@/lib/emails-garage'
import crypto                      from 'crypto'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const body  = await req.json().catch(() => ({}))
  const email = String(body?.email || '').trim().toLowerCase()
  if (!email) return NextResponse.json({ ok: true })  // reponse generique

  const sb = createAdminClient()

  // Lookup user garage actif uniquement
  const { data: user } = await sb
    .from('users')
    .select(`
      id, email, name, role, active,
      garage_user_partners ( garage_partners ( id, name, active ) )
    `)
    .ilike('email', email)
    .eq('role', 'garage')
    .eq('active', true)
    .maybeSingle()

  if (!user) {
    // Pas de fuite : on repond OK meme si pas trouve.
    return NextResponse.json({ ok: true })
  }

  const partners = (Array.isArray((user as any).garage_user_partners) ? (user as any).garage_user_partners : [])
    .map((gup: any) => gup.garage_partners)
    .filter((p: any) => p && p.active)
    .map((p: any) => ({ name: p.name }))

  // Genere token signe (24h)
  const secret  = process.env.NEXTAUTH_SECRET || 'dev-secret-change-me'
  const expires = Math.floor(Date.now() / 1000) + 24 * 60 * 60
  const payload = `${user.id}:${expires}`
  const sig     = crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 32)
  const token   = Buffer.from(`${payload}:${sig}`).toString('base64url')

  const baseUrl      = process.env.NEXT_PUBLIC_APP_URL || 'https://app.verviersdepannage.com'
  const magicLinkUrl = `${baseUrl}/garage/activate?token=${token}`

  try {
    await sendGarageWelcomeEmail({
      userEmail:    user.email,
      userName:     user.name || user.email,
      partners,
      magicLinkUrl,
    })
  } catch (e) {
    console.error('[garage magic-link] send failed:', e)
  }

  return NextResponse.json({ ok: true })
}
