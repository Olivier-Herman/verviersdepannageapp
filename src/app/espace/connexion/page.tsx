import { getBusinessText } from '@/lib/settings/business'
import ConnexionClient from './ConnexionClient'

export const dynamic = 'force-dynamic'

export default async function Connexion() {
  const tel = await getBusinessText('telephone_depannage_public').catch(() => '')
  return <ConnexionClient tel={tel} />
}
