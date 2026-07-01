// src/app/api/driver/fines-recap/route.ts
//
// GET /api/driver/fines-recap
//   Récap des amendes du chauffeur connecté, groupées par mois (une ligne par
//   mois avec le total). Sert au message de conscientisation affiché le 1er du
//   mois à la 1re ouverture de l'app. Olivier 2026-07-01.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const preview = new URL(req.url).searchParams.get('preview') === '1'

  const sb = createAdminClient()
  const { data: me } = await sb.from('users').select('id, name, role, roles').eq('email', session.user.email).maybeSingle()
  if (!me) return NextResponse.json({ months: [], grand_total: 0 })

  const isDriver = me.role === 'driver' || (Array.isArray(me.roles) && me.roles.includes('driver'))
  const isAdmin  = ['admin', 'superadmin'].includes(me.role) || (Array.isArray(me.roles) && me.roles.some((r: string) => ['admin', 'superadmin'].includes(r)))

  // Normal : uniquement profil Driver. Preview : autorisée aux admins pour tester.
  if (!isDriver && !(preview && isAdmin)) return NextResponse.json({ months: [], grand_total: 0 })

  // Mode prévisualisation → données FACTICES (pas les vraies amendes).
  if (preview) {
    const months = [
      { ym: '2026-06', label: 'juin 2026',  total: 165.00, count: 2 },
      { ym: '2026-05', label: 'mai 2026',   total: 58.00,  count: 1 },
      { ym: '2026-04', label: 'avril 2026', total: 240.00, count: 3 },
    ]
    return NextResponse.json({ driver_name: me.name, months, grand_total: 463.00, preview: true })
  }

  const { data: fines } = await sb
    .from('fines')
    .select('amount, infraction_date')
    .eq('driver_id', me.id)
    .not('status', 'in', '("cancelled")')

  // Groupage par mois (heure locale BE).
  const byMonth = new Map<string, { total: number; count: number }>()
  for (const f of fines || []) {
    const d = new Date(f.infraction_date)
    if (isNaN(d.getTime())) continue
    // clé YYYY-MM en Europe/Brussels
    const ym = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit' }).format(d) // "YYYY-MM"
    const cur = byMonth.get(ym) || { total: 0, count: 0 }
    cur.total += Number(f.amount || 0)
    cur.count += 1
    byMonth.set(ym, cur)
  }

  const months = [...byMonth.entries()]
    .map(([ym, v]) => {
      const [y, m] = ym.split('-')
      return { ym, label: `${MONTHS_FR[Number(m) - 1]} ${y}`, total: Math.round(v.total * 100) / 100, count: v.count }
    })
    .sort((a, b) => b.ym.localeCompare(a.ym))   // récent → ancien
    .slice(0, 12)

  const grand_total = Math.round((months.reduce((s, m) => s + m.total, 0)) * 100) / 100
  return NextResponse.json({ driver_name: me.name, months, grand_total })
}
