// src/app/api/admin/missions/link-source/route.ts
//
// POST /api/admin/missions/link-source
// Body : { sender_email: string, source: string, label?: string }
//
// 1. Ajoute le sender (email_pattern) dans la table senders -> les prochains
//    mails de cet expéditeur seront détectés comme la source choisie.
// 2. Supprime les missions UNKNOWN_SENDER actuelles qui matchent cet
//    expéditeur (le user a choisi "juste supprimer", pas de retraitement).
//
// Acces : admin / superadmin uniquement.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const user    = session?.user as any
  if (!session || !['admin', 'superadmin'].includes(user?.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { sender_email?: string; source?: string; label?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const senderEmail = (body.sender_email || '').trim().toLowerCase()
  const source      = (body.source || '').trim()
  const label       = (body.label || '').trim() || null

  if (!senderEmail || !source) {
    return NextResponse.json({ error: 'sender_email et source requis' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Pattern = le domaine si email complet, sinon tel quel. On stocke le
  // domaine "@example.be" pour matcher tous les emails de ce domaine.
  const atIdx = senderEmail.indexOf('@')
  const pattern = atIdx >= 0 ? senderEmail.slice(atIdx) : senderEmail

  // 1. INSERT sender (ignore si déjà présent)
  const { error: insertErr } = await supabase
    .from('mission_senders')
    .upsert(
      { email_pattern: pattern, source, label, active: true },
      { onConflict: 'email_pattern', ignoreDuplicates: false },
    )

  if (insertErr) {
    console.error('[link-source] upsert sender:', insertErr.message)
    return NextResponse.json({ error: `Sender: ${insertErr.message}` }, { status: 500 })
  }

  // 2. Delete UNKNOWN missions matching this sender_email (full email match)
  const { count, error: deleteErr } = await supabase
    .from('incoming_missions')
    .delete({ count: 'exact' })
    .eq('source', 'unknown')
    .eq('sender_email', senderEmail)

  if (deleteErr) {
    console.warn('[link-source] delete UNKNOWN failed (non bloquant):', deleteErr.message)
  }

  return NextResponse.json({
    ok:       true,
    pattern,
    source,
    deleted:  count || 0,
  })
}
