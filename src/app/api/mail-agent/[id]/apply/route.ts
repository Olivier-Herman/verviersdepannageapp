// POST /api/mail-agent/[id]/apply
// Applique un item : extourne + refacturation Odoo, puis classe le mail.
// ⚠️ Écriture comptable — réservé admin/superadmin.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { sessionAccess }    from '@/lib/access'
import { applyItem }        from '@/lib/mail-agent'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const access  = sessionAccess(session, { roles: ['superadmin'] })
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const actor = (session?.user as any)?.name || (session?.user as any)?.email || 'inconnu'
  const res = await applyItem(params.id, actor)
  return NextResponse.json(res, { status: res.ok ? 200 : 400 })
}
