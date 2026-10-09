// GET  /api/vetements/me → { required, tailles, sizes, deadline } : faut-il afficher la
//      demande de Sam (campagne active, personnel concerné, pas encore répondu) ?
// POST /api/vetements/me { tshirt, pull } → enregistre (modifiable tant que la campagne est ouverte).
import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { getCampagne, personnelConcerne, TAILLES } from '@/lib/vetements'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  const me = (session?.user as any)?.id as string | undefined
  if (!me) return NextResponse.json({ required: false })
  const camp = await getCampagne()
  if (!camp.active) return NextResponse.json({ required: false })
  const people = await personnelConcerne(camp)
  const p = people.find(x => x.id === me)
  const { data: t } = await createAdminClient().from('tailles_vetements').select('tshirt, pull').eq('user_id', me).maybeSingle()
  return NextResponse.json({ required: !!p && !p.excluded && !t, tailles: t || null, sizes: TAILLES, deadline: camp.deadline, name: p?.name || null })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const me = (session?.user as any)?.id as string | undefined
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const tshirt = String(b.tshirt || ''), pull = String(b.pull || '')
  if (!(TAILLES as readonly string[]).includes(tshirt) || !(TAILLES as readonly string[]).includes(pull)) return NextResponse.json({ error: 'Choisis tes deux tailles.' }, { status: 400 })
  const camp = await getCampagne()
  if (!camp.active) return NextResponse.json({ error: 'La commande est clôturée.' }, { status: 409 })
  const now = new Date().toISOString()
  const { error } = await createAdminClient().from('tailles_vetements').upsert({ user_id: me, tshirt, pull, updated_at: now }, { onConflict: 'user_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, tailles: { tshirt, pull } })
}
