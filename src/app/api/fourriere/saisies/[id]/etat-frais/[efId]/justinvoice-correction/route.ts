// POST → renvoie la version corrigée d'un état de frais DANS son dossier JustInvoice existant (« besoin d'une
// correction » du bureau de taxation). Corps : { docs: ('CostState'|'Claim'|'Approval')[], comment }.
// Réservé admin / superadmin / module fourriere. Olivier 2026-10-09.
import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { submitJustInvoiceCorrection, type CorrectionDoc } from '@/lib/justinvoice/correction'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: Request, { params }: { params: { id: string; efId: string } }) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!session || !(['admin', 'superadmin'].includes(u.role || '') || (u.modules || []).includes('fourriere'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({}))
  const docs = (Array.isArray(body.docs) ? body.docs : ['CostState']).filter((x: any) => ['CostState', 'Claim', 'Approval'].includes(x)) as CorrectionDoc[]
  try {
    const res = await submitJustInvoiceCorrection(createAdminClient(), params.id, params.efId, { docs, comment: String(body.comment || '') })
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
    return NextResponse.json(res)
  } catch (e: any) {
    return NextResponse.json({ error: `JustInvoice : ${e?.message || e}` }, { status: 500 })
  }
}
