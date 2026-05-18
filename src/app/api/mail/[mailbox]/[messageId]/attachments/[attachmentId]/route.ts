// src/app/api/mail/{mailbox}/{messageId}/attachments/{attachmentId}/route.ts
//
// GET → stream le contenu binaire d une piece jointe.
// Mailbox autorisee uniquement.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { fetchAttachmentBytes, isAllowedMailbox } from '@/lib/graph-mail-search'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

export async function GET(_req: Request, { params }: { params: { mailbox: string; messageId: string; attachmentId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const mailbox      = decodeURIComponent(params.mailbox)
  const messageId    = decodeURIComponent(params.messageId)
  const attachmentId = decodeURIComponent(params.attachmentId)

  if (!isAllowedMailbox(mailbox)) {
    return NextResponse.json({ error: 'Mailbox non autorisee' }, { status: 403 })
  }

  try {
    const att = await fetchAttachmentBytes({ mailbox, messageId, attachmentId })
    if (!att) return NextResponse.json({ error: 'Piece jointe introuvable' }, { status: 404 })

    return new Response(att.bytes, {
      headers: {
        'Content-Type':        att.contentType,
        'Content-Disposition': `inline; filename="${encodeURIComponent(att.name)}"`,
        'Cache-Control':       'private, max-age=300',
      },
    })
  } catch (e: any) {
    console.error('[mail/attachment] error:', e.message)
    return NextResponse.json({ error: e.message || 'Erreur Graph' }, { status: 500 })
  }
}
