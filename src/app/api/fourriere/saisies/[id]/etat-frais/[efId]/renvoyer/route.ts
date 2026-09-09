// POST → renvoie un état de frais EXISTANT (même numéro) reconstruit avec les
// données véhicule actuelles, + réquisitoire, au destinataire d'origine.
// Réservé admin / superadmin / module fourriere. Olivier 2026-09-09.
import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { resendEtatFrais }   from '@/lib/missions/saisie-dossier'

export const dynamic = 'force-dynamic'
export const maxDuration = 40

export async function POST(_req: Request, { params }: { params: { id: string; efId: string } }) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!session || !(['admin', 'superadmin'].includes(u.role || '') || (u.modules || []).includes('fourriere'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const res = await resendEtatFrais(createAdminClient(), params.id, params.efId, u.id || null)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json(res)
}
