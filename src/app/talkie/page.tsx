// Talkie « Garde de nuit » (Olivier 30/09/2026) : 1er départ et réserve de la nuit ;
// superadmins en écoute seule. Cf TalkieClient et lib/talkie/session.ts.
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import AppShell              from '@/components/layout/AppShell'
import TalkieClient          from './TalkieClient'
import { talkieSession }     from '@/lib/talkie/session'

export const dynamic = 'force-dynamic'

export default async function TalkiePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any
  const t = await talkieSession(user)
  return (
    <AppShell title="Talkie" userRole={user.role || ''} userName={user.name} userEmail={user.email} userId={user.id} userModules={user.modules || []}>
      {t.allowed && t.channel && t.me && t.role ? (
        <TalkieClient role={t.role} channel={t.channel} me={t.me} members={t.members || []} />
      ) : (
        <div className="p-4 max-w-md mx-auto">
          <div className="bg-surface border rounded-2xl p-8 text-center space-y-2">
            <p className="text-ink font-semibold">📻 Talkie garde de nuit</p>
            <p className="text-ink-muted text-sm">Réservé au 1er départ et à la réserve de la nuit de garde.</p>
          </div>
        </div>
      )}
    </AppShell>
  )
}
