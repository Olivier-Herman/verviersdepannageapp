// VD Assistance (Olivier 10/10/2026) : l'app des clients des garages partenaires. ?garage=<code> = arrivé par le
// lien ou le QR code d'un garage (inscription chez lui, ou ajout d'un véhicule chez lui).
import { getBusinessText } from '@/lib/settings/business'
import AssistanceApp from './AssistanceApp'

export const dynamic = 'force-dynamic'

export default async function Page({ searchParams }: { searchParams: { garage?: string; action?: string } }) {
  const tel = await getBusinessText('telephone_depannage_public').catch(() => '')
  const appStore = await getBusinessText('vd_assistance_app_store_url').catch(() => '')
  const garage = String(searchParams?.garage || '').toLowerCase().replace(/[^a-z0-9-]/g, '') || null
  return <AssistanceApp contexte={garage} tel={tel} appStore={appStore} action={searchParams?.action || null} />
}
