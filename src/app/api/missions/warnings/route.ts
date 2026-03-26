// src/app/api/missions/warnings/route.ts

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('mission_warnings')
    .select('id, label, icon, color')
    .eq('active', true)
    .order('sort_order')

  return NextResponse.json({ warnings: data || [] })
}
