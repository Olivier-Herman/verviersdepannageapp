// src/app/api/site/etat/route.ts
//
// Ce que le site public doit savoir à l'instant : bureau ouvert ou version de
// nuit, délais promis, recrutement en cours. Lu par le navigateur (le site
// reste servi en cache, seule cette petite réponse est fraîche).

import { NextResponse } from 'next/server'
import { getBusinessNumber, getBusinessText } from '@/lib/settings/business'
import { bureauOuvert } from '@/lib/site/heures'

export const dynamic = 'force-dynamic'

export async function GET() {
  const [spec, rappel, devis, recrute] = await Promise.all([
    getBusinessText('site_heures_bureau').catch(() => null),
    getBusinessNumber('site_delai_rappel_heures').catch(() => null),
    getBusinessNumber('site_delai_devis_heures').catch(() => null),
    getBusinessText('site_recrutement_actif').catch(() => null),
  ])
  // Réglage manquant : pas de valeur inventée. Le site garde sa version de jour
  // et tait le délai plutôt que d'afficher une promesse que personne n'a faite.
  return NextResponse.json(
    { ouvert: spec ? bureauOuvert(spec) : true, delaiRappel: rappel, delaiDevis: devis, recrute: /^o/i.test(recrute || '') },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
