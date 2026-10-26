// GET /api/agents/facturation-auto/etat — état de l'interrupteur général de la facturation, pour les agents du village
// (clé VDSOFT_CLE_*, lecture seule). Off = les agents ne préparent aucune facturation (Olivier 26/10/2026).
// Réponse : { "facturation_auto": true | false }. Jamais montré à un utilisateur de VD Soft.
import { NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agents/core'
import { createAdminClient } from '@/lib/supabase'
import { facturationAutoSuspendue } from '@/lib/facturation/suspension'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const agent = await authenticateAgent(req)
  if (!agent) return NextResponse.json({ error: 'Clé d’agent absente, invalide ou désactivée.' }, { status: 401 })
  return NextResponse.json({ facturation_auto: !(await facturationAutoSuspendue(createAdminClient())) })
}
