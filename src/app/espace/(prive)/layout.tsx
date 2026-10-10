import { redirect } from 'next/navigation'
import { getEspaceSession } from '@/lib/espace/session'
import { createAdminClient } from '@/lib/supabase'
import EspaceShell from './EspaceShell'

export const dynamic = 'force-dynamic'

export default async function EspacePriveLayout({ children }: { children: React.ReactNode }) {
  const s = await getEspaceSession()
  if (!s) redirect('/espace/connexion')
  const { compte: c, societes } = s
  const { data: garages } = await createAdminClient().from('espace_garages').select('societe_id, nom, adresse, lat, lng, ordre').in('societe_id', societes.map(x => x.id)).order('ordre')
  return (
    <EspaceShell
      compte={{ id: c.id, nom: c.nom, email: c.emails[0], role: c.role, peutInviter: c.role === 'gestionnaire' || c.peut_inviter, aMotDePasse: !!c.password_hash }}
      societes={societes.map(x => ({ id: x.id, nom: x.nom, couleur: x.couleur, garages: (garages || []).filter(g => g.societe_id === x.id).map(g => ({ nom: g.nom, adresse: g.adresse, lat: g.lat, lng: g.lng })) }))}
    >
      {children}
    </EspaceShell>
  )
}
