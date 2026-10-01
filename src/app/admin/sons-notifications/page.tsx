// src/app/admin/sons-notifications/page.tsx — choix du son des notifications iPhone
// par famille (Olivier 02/10/2026). Cf lib/notifications/sound-families.ts.
import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import { sessionAccess }    from '@/lib/access'
import { SOUND_FAMILIES, loadSoundChoices } from '@/lib/notifications/sound-families'
import SonsClient           from './SonsClient'

export const dynamic = 'force-dynamic'

export default async function SonsNotificationsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (!sessionAccess(session).ok) redirect('/dashboard')
  const choices = await loadSoundChoices(true)
  return <SonsClient families={SOUND_FAMILIES.map(f => ({ key: f.key, label: f.label, desc: f.desc }))} initial={choices} />
}
