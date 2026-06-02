// GET /api/garage/user-email?id=xxx — retourne juste l email d un user garage
// par son id. Utilise par /garage/activate pour passer l email a NextAuth.
// PAS d auth requise (le caller a deja le token signe qui prouve son identite).
// Olivier 2026-06-02.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

  const sb = createAdminClient()
  const { data } = await sb
    .from('users')
    .select('email, role, active')
    .eq('id', id)
    .eq('role', 'garage')
    .eq('active', true)
    .maybeSingle()
  if (!data) return NextResponse.json({ error: 'User introuvable' }, { status: 404 })
  return NextResponse.json({ email: data.email })
}
