// Accueil de l'app VD Assistance (Olivier 10/10/2026) : le client rejoint son garage en scannant son QR code ou en
// tapant le code du garage ; l'app rouvre ensuite directement sur ce garage.
import { createAdminClient } from '@/lib/supabase'
import Accueil from './Accueil'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const { data } = await createAdminClient().from('espace_societes').select('nom, clients_slug, couleur')
    .eq('active', true).eq('clients_actif', true).eq('demo', false).not('clients_slug', 'is', null).order('nom')
  return <Accueil garages={(data || []).map(g => ({ nom: g.nom, slug: g.clients_slug!, couleur: g.couleur }))} />
}
