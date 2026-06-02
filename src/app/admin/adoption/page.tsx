// Page admin "Adoption" : qui utilise quoi (App native iOS/Android, PWA, Web nu).
// Croise les sources users + device_tokens + push_subscriptions.
// Olivier 2026-06-02.

import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import AdoptionClient        from './AdoptionClient'

export const dynamic = 'force-dynamic'

interface UserRow {
  id: string
  name: string | null
  email: string | null
  role: string | null
  active: boolean
  last_login: string | null
  created_at: string | null
}

export default async function AdminAdoptionPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const role: string = (session.user as any).role || ''
  if (!['admin', 'superadmin'].includes(role)) redirect('/dashboard?error=access_denied')

  const sb = createAdminClient()

  // Users actifs
  const { data: users } = await sb
    .from('users')
    .select('id, name, email, role, active, last_login, created_at')
    .eq('active', true)
    .order('last_login', { ascending: false, nullsFirst: false })

  // Device tokens (iOS + Android natifs Capacitor)
  const { data: devices } = await sb
    .from('device_tokens')
    .select('user_id, platform, created_at, last_seen_at')

  // Push subscriptions (PWA Web Push)
  const { data: subs } = await sb
    .from('push_subscriptions')
    .select('user_id, created_at')

  // Aggregate per user
  const byUserDevices: Record<string, { ios: { first: string; last: string }[]; android: { first: string; last: string }[]; watch: { first: string; last: string }[] }> = {}
  for (const d of devices || []) {
    const u = d.user_id as string
    if (!byUserDevices[u]) byUserDevices[u] = { ios: [], android: [], watch: [] }
    const platform = String(d.platform || '').toLowerCase()
    const entry = { first: d.created_at as string, last: (d.last_seen_at || d.created_at) as string }
    if (platform === 'ios')     byUserDevices[u].ios.push(entry)
    else if (platform === 'android') byUserDevices[u].android.push(entry)
    else if (platform === 'watchos') byUserDevices[u].watch.push(entry)
  }

  const byUserPwa: Record<string, { first: string }> = {}
  for (const s of subs || []) {
    const u = s.user_id as string
    if (!byUserPwa[u]) byUserPwa[u] = { first: s.created_at as string }
    else if ((s.created_at as string) < byUserPwa[u].first) byUserPwa[u].first = s.created_at as string
  }

  const rows = (users || []).map((u: UserRow) => {
    const d = byUserDevices[u.id]
    const pwa = byUserPwa[u.id]
    const iosFirst   = d?.ios.length ? d.ios.map(x => x.first).sort()[0] : null
    const iosLast    = d?.ios.length ? d.ios.map(x => x.last).sort().slice(-1)[0] : null
    const androidFirst = d?.android.length ? d.android.map(x => x.first).sort()[0] : null
    const androidLast  = d?.android.length ? d.android.map(x => x.last).sort().slice(-1)[0] : null
    const watchHas   = !!d?.watch.length
    return {
      id:           u.id,
      name:         u.name,
      email:        u.email,
      role:         u.role,
      last_login:   u.last_login,
      iosFirst, iosLast,
      androidFirst, androidLast,
      watchHas,
      pwaFirst:     pwa?.first || null,
    }
  })

  return <AdoptionClient rows={rows} />
}
