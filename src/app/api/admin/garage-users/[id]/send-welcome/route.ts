// POST /api/admin/garage-users/[id]/send-welcome : envoie l email de bienvenue
// au user garage avec un lien magic link genere via NextAuth (Email provider).
// Olivier 2026-06-02.

import { NextResponse }         from 'next/server'
import { getServerSession }     from 'next-auth'
import { authOptions }          from '@/lib/auth'
import { createAdminClient }    from '@/lib/supabase'
import { sendGarageWelcomeEmail } from '@/lib/emails-garage'
import crypto                   from 'crypto'

export const dynamic = 'force-dynamic'

function requireAdmin(session: any): boolean {
  const role: string = session?.user?.role || ''
  return ['admin', 'superadmin'].includes(role)
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireAdmin(session)) return NextResponse.json({ error: 'Acces refuse' }, { status: 403 })

  const userId = params.id
  if (!userId) return NextResponse.json({ error: 'userId requis' }, { status: 400 })

  const sb = createAdminClient()

  // Recup le user + ses partners
  const { data: user, error: uErr } = await sb
    .from('users')
    .select(`
      id, email, name, active, role,
      garage_user_partners ( garage_partners ( id, name, active ) )
    `)
    .eq('id', userId)
    .eq('role', 'garage')
    .maybeSingle()

  if (uErr || !user) {
    return NextResponse.json({ error: 'User garage introuvable' }, { status: 404 })
  }

  const partners = (Array.isArray((user as any).garage_user_partners) ? (user as any).garage_user_partners : [])
    .map((gup: any) => gup.garage_partners)
    .filter((p: any) => p && p.active)
    .map((p: any) => ({ name: p.name }))

  // Genere un token signed simple (HMAC-SHA256) qui sera valide par
  // /garage/activate?token=xxx (sans NextAuth Email provider — implementation
  // legere pour MVP). Valable 24h.
  const secret  = process.env.NEXTAUTH_SECRET || 'dev-secret-change-me'
  const expires = Math.floor(Date.now() / 1000) + 24 * 60 * 60
  const payload = `${user.id}:${expires}`
  const sig     = crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 32)
  const token   = Buffer.from(`${payload}:${sig}`).toString('base64url')

  const baseUrl     = process.env.NEXT_PUBLIC_APP_URL || 'https://app.verviersdepannage.com'
  const magicLinkUrl = `${baseUrl}/garage/activate?token=${token}`

  try {
    await sendGarageWelcomeEmail({
      userEmail:    user.email,
      userName:     user.name || user.email,
      partners,
      magicLinkUrl,
    })
    return NextResponse.json({ ok: true, sent_to: user.email })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Echec envoi email' }, { status: 500 })
  }
}
