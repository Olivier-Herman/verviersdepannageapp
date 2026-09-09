// GET /api/settings/business?keys=a,b — valeurs résolues des réglages métier
// (repli du registre si rien en base). Session requise ; clés hors registre ignorées.
import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { getBusinessSettings } from '@/lib/settings/business'
import { BUSINESS_SETTING_KEYS } from '@/lib/settings/business-registry'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const wanted = String(new URL(req.url).searchParams.get('keys') || '').split(',').map(s => s.trim()).filter(k => BUSINESS_SETTING_KEYS.has(k))
  const all = await getBusinessSettings()
  const values = wanted.length ? Object.fromEntries(wanted.map(k => [k, all[k]])) : all
  return NextResponse.json({ values })
}
