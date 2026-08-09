// src/app/api/saisie/etat-frais-preview/route.ts
//
// Prévisualisation de l'ÉTAT DE FRAIS saisie (PDF réel, données représentatives)
// pour valider le rendu vs la maquette. Ouvre-la dans le navigateur :
//   /api/saisie/etat-frais-preview                → parquet, 1er état (dépannage + gardiennage)
//   /api/saisie/etat-frais-preview?recipient=client
//   /api/saisie/etat-frais-preview?recipient=domaine
// Les montants sortent de computeSaisieBilling (grilles police_saisie réelles).
// Olivier 2026-08-09.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { computeSaisieBilling, type SaisieRecipient } from '@/lib/missions/saisie-billing'
import { renderEtatFraisPdf } from '@/lib/missions/saisie-etat-frais-pdf'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const DEST: Record<SaisieRecipient, { name: string; lines: string[] }> = {
  parquet: { name: 'Parquet', lines: ['Quai d\'Arona 4, 4500 Huy', 'fdj.pplge@just.fgov.be', 'TVA BE 0308.357.753'] },
  domaine: { name: 'SPF Finances — Domaine', lines: ['Recette des domaines', 'Verviers'] },
  client:  { name: 'M. Jean Dupont', lines: ['Rue de la Station 12, 4800 Verviers', 'jean.dupont@email.be'] },
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const recipient = (['parquet', 'domaine', 'client'].includes(url.searchParams.get('recipient') || '')
    ? url.searchParams.get('recipient') : 'parquet') as SaisieRecipient

  // Scénario représentatif : saisie entrée le 14/09/2025, état de frais coupé au
  // 31/10/2026 → exerce le découpage annuel du gardiennage. 1er état = dépannage inclus.
  const parkedAt = '2025-09-14'
  const billingTo = '2026-10-31'
  const billing = await computeSaisieBilling({
    parkedAt, billingTo, recipient, includeDepannage: true,
    vehicleClass: 'car', chargedKmBeyond: 0,
  })

  const pdf = await renderEtatFraisPdf({
    numero: 'EDF-2026-0428',
    dateEmission: billingTo,
    recipient,
    destinataire: DEST[recipient],
    pv: '2026 / 045678',
    dateSaisie: parkedAt,
    parkedAt,
    periodFrom: parkedAt,
    periodTo: billingTo,
    plate: '1-ABC-234',
    vehicle: 'Renault Trafic',
    vin: 'VF1JL000272031498',
    motif: 'Saisie Générale',
    billing,
    qrUrl: 'https://app.verviersdepannage.com/saisie-validation/apercu',
  })

  return new NextResponse(pdf as any, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="etat-de-frais-apercu.pdf"',
      'Cache-Control': 'no-store',
    },
  })
}
