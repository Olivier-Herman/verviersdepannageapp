// Ancien portail garage (/garage) : remplacé par l'espace client unique /espace le 10/10/2026 (Olivier :
// « on va dans l'amélioration », un seul portail pour EBAC, Centracar, Car Parts, Car Avenue…).
// Les comptes ont été repris dans l'espace avec leur mot de passe ; toute adresse /garage y mène.
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function GarageLayout(_: { children: React.ReactNode }) {
  redirect('/espace/connexion')
}
