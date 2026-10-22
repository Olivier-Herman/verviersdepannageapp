// GET /api/assistant/veille — les questions de Max pour la personne connectée (missions
// figées, commandes à trier). Olivier 14/10/2026. Réservé aux personnes qui ont Max.
import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { veilleUser }        from '@/lib/assistant/access'
import { veilleCards, inWorkHours } from '@/lib/assistant/veille'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await veilleUser()
  if (!user) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  try {
    const { getBusinessList } = await import('@/lib/settings/business')
    // Questions de dispatch sans propriétaire : au dispatch titulaire seulement, pas à tout le bureau
    // (Olivier 15/10/2026 : Jona fait la facturation et la fourrière, le dispatch en remplacement).
    const bureau = (await getBusinessList('max_veille_dispatch_users').catch(() => [] as string[])).map(x => String(x).toLowerCase()).includes(String(user.email || '').toLowerCase())
    return NextResponse.json({ heures: inWorkHours(), cartes: await veilleCards(createAdminClient(), user.id, { bureau }) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), cartes: [] }, { status: 500 })
  }
}
