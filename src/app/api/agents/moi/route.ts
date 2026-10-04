// GET /api/agents/moi — ce que l'agent (clé) peut lire, proposer et envoyer seul.
import { NextResponse } from 'next/server'
import { authenticateAgent, KIND_LABEL, COMPANY_LABEL, isNight } from '@/lib/agents/core'
import { READS, READ_LABEL, VD_ONLY } from '@/lib/agents/read'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const agent = await authenticateAgent(req)
  if (!agent) return NextResponse.json({ error: 'Clé d’agent absente, invalide ou désactivée.' }, { status: 401 })
  return NextResponse.json({
    agent: agent.name, role: agent.role_label,
    societes: agent.companies.map(c => ({ id: c, nom: COMPANY_LABEL[c] })),
    lectures: READS.map(r => ({ quoi: r, libelle: READ_LABEL[r], societes: VD_ONLY.includes(r) ? [1] : agent.companies })),
    propositions: agent.kinds.map(k => ({ type: k, libelle: (KIND_LABEL as any)[k], envoi_direct: agent.direct_kinds.includes(k) })),
    nuit: isNight(),
    regles: [
      'Vous préparez ; une personne valide ; VD Soft exécute.',
      'La nuit (18 h–6 h), rien ne part : seules les notes de crédit / refacturations certaines d’Élodie sont exécutées directement.',
      'Tout appel hors de vos sociétés ou de vos types est refusé et noté.',
    ],
  })
}
