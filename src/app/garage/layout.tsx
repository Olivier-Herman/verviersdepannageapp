// Layout racine /garage : simple passe-plat. Les pages publiques (login,
// activate) et set-password vivent ici sans garde ; les pages protégées sont
// dans le groupe (app), dont le layout vérifie la session côté serveur.
// Olivier 2026-06-02, revu 2026-09-09.

export const dynamic = 'force-dynamic'

export default function GarageLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
