// src/app/api/mail/[mailbox]/[messageId]/route.ts
//
// GET /api/mail/{mailbox}/{messageId}
//   → contenu complet d un email (body + attachments metadata).
//   Mailbox autorisee uniquement (allowlist SEARCH_MAILBOXES).

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { fetchMailFull, isAllowedMailbox } from '@/lib/graph-mail-search'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

export async function GET(_req: Request, { params }: { params: { mailbox: string; messageId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const mailbox   = decodeURIComponent(params.mailbox)
  const messageId = decodeURIComponent(params.messageId)

  if (!isAllowedMailbox(mailbox)) {
    return NextResponse.json({ error: 'Mailbox non autorisee' }, { status: 403 })
  }

  try {
    const mail = await fetchMailFull({ mailbox, messageId })
    if (!mail) return NextResponse.json({ error: 'Email introuvable' }, { status: 404 })
    return NextResponse.json({ ok: true, mail })
  } catch (e: any) {
    console.error('[mail] fetchMailFull error:', e.message)
    return NextResponse.json({ error: e.message || 'Erreur Graph' }, { status: 500 })
  }
}
