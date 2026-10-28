// GET /api/agents/facturation-auto/etat — état de l'interrupteur général de la facturation, pour les agents du village
// (clé VDSOFT_CLE_*, lecture seule). Off = les agents ne préparent aucune facturation (Olivier 26/10/2026).
// Réponse : { "facturation_auto": true | false, "actif": true | false }. « actif » = cet agent peut agir maintenant
// (interrupteur « Mes assistants » de Mobi, général ou son bloc, Olivier 28/10/2026) ; en pause, ses écritures sont
// refusées (423). Jamais montré à un utilisateur de VD Soft.
import { NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agents/core'
import { createAdminClient } from '@/lib/supabase'
import { facturationAutoSuspendue, assistantEnPause, blocDeLAgent } from '@/lib/facturation/suspension'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const agent = await authenticateAgent(req)
  if (!agent) return NextResponse.json({ error: 'Clé d’agent absente, invalide ou désactivée.' }, { status: 401 })
  const sb = createAdminClient()
  return NextResponse.json({
    facturation_auto: !(await facturationAutoSuspendue(sb)),
    // ?agent=<slug> : un agent du village sans clé à lui (Aurélie, Lucie, Mobia) lu avec la clé d'un autre (28/10/2026).
    actif: !(await assistantEnPause(sb, blocDeLAgent(new URL(req.url).searchParams.get('agent') || agent.name))),
  })
}
