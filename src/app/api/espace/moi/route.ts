// GET   /api/espace/moi — compte connecté et ses sociétés.
// PATCH /api/espace/moi — { motDePasse } : choisir ou changer son mot de passe.
import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase'
import { getEspaceSession } from '@/lib/espace/session'

export const dynamic = 'force-dynamic'

export async function GET() {
  const s = await getEspaceSession()
  if (!s) return NextResponse.json({ error: 'Session expirée' }, { status: 401 })
  const { compte: c, societes } = s
  return NextResponse.json({
    compte: { id: c.id, nom: c.nom, email: c.emails[0], role: c.role, peutInviter: c.role === 'gestionnaire' || c.peut_inviter, aMotDePasse: !!c.password_hash },
    societes: societes.map(x => ({ id: x.id, nom: x.nom, couleur: x.couleur })),
  })
}

export async function PATCH(req: Request) {
  const s = await getEspaceSession()
  if (!s) return NextResponse.json({ error: 'Session expirée' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const mdp = String(b?.motDePasse || '')
  if (mdp.length < 8) return NextResponse.json({ error: 'Au moins 8 caractères.' }, { status: 400 })
  await createAdminClient().from('espace_comptes').update({ password_hash: await bcrypt.hash(mdp, 10), updated_at: new Date().toISOString() }).eq('id', s.compte.id)
  return NextResponse.json({ ok: true })
}
