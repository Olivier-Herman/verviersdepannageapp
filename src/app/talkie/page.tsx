// Talkie (Olivier 30/09/2026) : « Garde de nuit » (1er départ + réserve + superadmins)
// et canal direct de chaque chauffeur vers Mobi / IT. ?c=<clé du canal>
// ouvre directement un canal (lien des notifs). Cf TalkieClient et lib/talkie/session.ts.
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import AppShell              from '@/components/layout/AppShell'
import TalkieClient          from './TalkieClient'
import { talkieAccess }      from '@/lib/talkie/session'

export const dynamic = 'force-dynamic'

export default async function TalkiePage({ searchParams }: { searchParams: { c?: string; play?: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any
  const a = await talkieAccess(user)
  return (
    <AppShell title="Talkie" userRole={user.role || ''} userName={user.name} userEmail={user.email} userId={user.id} userModules={user.modules || []}>
      {a.me && a.channels.length ? (
        <TalkieClient me={a.me} channels={a.channels} initialKey={searchParams.c || a.channels[0].key} playSince={Number(searchParams.play) || null} />
      ) : (
        <div className="p-4 max-w-md mx-auto">
          <div className="bg-surface border rounded-2xl p-8 text-center space-y-2">
            <p className="text-ink font-semibold">📻 Talkie</p>
            <p className="text-ink-muted text-sm">Le talkie est ouvert de 18 h à 8 h, pour le 1er départ et la réserve de la nuit de garde.</p>
          </div>
        </div>
      )}
    </AppShell>
  )
}
