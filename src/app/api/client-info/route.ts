// POST /api/client-info — ce que l'appareil transmet de lui-même à l'ouverture (Olivier
// 17/10/2026) : navigateur, plateforme, version de l'app native si connue. Répond si une
// mise à jour de l'app iPhone est disponible (version App Store plus récente).
import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const DEFAULT_IOS_URL = 'https://apps.apple.com/be/app/vd-soft/id6769551627'
let cache: { at: number; version: string | null; url: string } | null = null

async function latestIos(): Promise<{ version: string | null; url: string }> {
  if (cache && Date.now() - cache.at < 3600_000) return cache
  let url = DEFAULT_IOS_URL
  try { const { getBusinessText } = await import('@/lib/settings/business'); url = (await getBusinessText('vd_soft_app_store_url')) || url } catch {}
  const id = (url.match(/id(\d{6,})/) || [])[1]
  let version: string | null = null
  if (id) {
    try { const j = await fetch(`https://itunes.apple.com/lookup?id=${id}&country=be`, { cache: 'no-store' }).then(r => r.json()); version = j?.results?.[0]?.version || null } catch {}
  }
  cache = { at: Date.now(), version, url }
  return cache
}

const older = (a: string, b: string) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0 }
  return false
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u?.id) return NextResponse.json({ ok: false }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const ua = String(req.headers.get('user-agent') || b.ua || '').slice(0, 500)
  const platform = ['ios', 'android', 'web'].includes(b.platform) ? b.platform : (/iPhone|iPad/.test(ua) ? 'ios' : /Android/.test(ua) ? 'android' : 'web')
  const native = !!b.native
  // « VDNav/1 » dans le navigateur de l'app est un marqueur fixe, PAS la version (lu à tort comme
  // « 1 » le 17/10 → popup affiché à des iPhones à jour). Seule la version donnée par l'app compte.
  const appVersion = b.app_version ? String(b.app_version).slice(0, 30) : null
  const appBuild = b.app_build ? String(b.app_build).slice(0, 30) : null
  const deviceKey = `${platform}|${native ? 'app' : 'web'}|${String(b.model || '').slice(0, 40)}`
  const now = new Date().toISOString()
  await createAdminClient().from('client_infos').upsert({
    user_id: u.id, device_key: deviceKey, platform, user_agent: ua, app_version: appVersion, app_build: appBuild,
    plugins: Array.isArray(b.plugins) ? b.plugins.slice(0, 40).map(String) : null, last_seen: now,
  }, { onConflict: 'user_id,device_key' }).then(() => {}, () => {})
  // Mise à jour proposée seulement dans l'app iPhone dont on connaît la version.
  if (platform !== 'ios' || !native || !appVersion) return NextResponse.json({ ok: true, update: null })
  const latest = await latestIos()
  const update = latest.version && older(appVersion, latest.version) ? { installed: appVersion, latest: latest.version, url: latest.url } : null
  return NextResponse.json({ ok: true, update })
}
