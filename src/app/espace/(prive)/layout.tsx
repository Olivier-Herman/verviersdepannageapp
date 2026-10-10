import { redirect } from 'next/navigation'
import { getEspaceSession } from '@/lib/espace/session'
import EspaceShell from './EspaceShell'

export const dynamic = 'force-dynamic'

export default async function EspacePriveLayout({ children }: { children: React.ReactNode }) {
  const s = await getEspaceSession()
  if (!s) redirect('/espace/connexion')
  const { compte: c, societes } = s
  return (
    <EspaceShell
      compte={{ id: c.id, nom: c.nom, email: c.emails[0], role: c.role, peutInviter: c.role === 'gestionnaire' || c.peut_inviter, aMotDePasse: !!c.password_hash }}
      societes={societes.map(x => ({ id: x.id, nom: x.nom, couleur: x.couleur }))}
    >
      {children}
    </EspaceShell>
  )
}
