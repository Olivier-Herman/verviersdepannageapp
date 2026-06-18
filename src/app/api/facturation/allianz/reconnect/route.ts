// src/app/api/facturation/allianz/reconnect/route.ts
//
// POST /api/facturation/allianz/reconnect
//
// Olivier 2026-06-18 : régénère un token Hexalite (Allianz) à la demande quand
// le token est expiré/invalidé (401 sur le listing). On demande un OTP : Hexalite
// envoie un mail OTP qui est capté et vérifié automatiquement par le processor
// (handler allianz_otp_pending), ce qui stocke un access_token frais.
//
// Accès : admin / superadmin / module facturation.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!(['admin', 'superadmin'].includes(role) || modules.includes('facturation'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { allianzRequestOTP } = await import('@/lib/missions/allianz')
    const { refNo } = await allianzRequestOTP()

    const sb = createAdminClient()
    // Pending de re-auth pure (pas de mission/assignment rattaché). Le processor
    // capte le mail OTP, vérifie via allianzVerifyOTP et stocke l'access_token
    // (l'éventuel fetch de mission échoue sans assignment, mais le TOKEN est
    // déjà sauvé à ce stade → c'est ce qu'on veut).
    const { error } = await sb.from('allianz_otp_pending').insert({
      ref_no:        refNo,
      assignment_id: `reauth_${Date.now()}`,
      dispatch_link: null,
      mission_id:    null,
      status:        'waiting',
    })
    if (error) {
      return NextResponse.json({ error: `Enregistrement reconnexion échoué : ${error.message}` }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      message: "OTP demandé. Le mail Allianz est traité automatiquement (~30s). Patiente puis clique « Rafraîchir ».",
    })
  } catch (e: any) {
    return NextResponse.json({ error: `Demande OTP Allianz échouée : ${e.message}` }, { status: 502 })
  }
}
