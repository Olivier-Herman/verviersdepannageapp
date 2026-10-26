// GET /api/agents/compteurs — compteurs du relevé du lundi pour les agents du village (clé VDSOFT_CLE_*, lecture seule,
// Olivier 26/10/2026) : missions à facturer (Aurélie), mails non triés d'info@ et d'administration@ (Justine), mails
// « Claudy » sans brouillon (Mobia). Un compteur illisible vaut null, les autres sont quand même rendus.
import { NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agents/core'
import { createAdminClient } from '@/lib/supabase'
import { getAppOnlyToken } from '@/lib/graph-mail-search'
import { MAIL_AGENT_MAILBOX } from '@/lib/mail-agent'
import { OUT_MAILBOX } from '@/lib/mail-agent/actions'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function boite(adresse: string): Promise<{ total: number; non_lus: number } | null> {
  try {
    const tok = await getAppOnlyToken()
    const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(adresse)}/mailFolders/inbox?$select=totalItemCount,unreadItemCount`, { headers: { Authorization: `Bearer ${tok}` }, cache: 'no-store' })
    if (!r.ok) return null
    const j = await r.json()
    return { total: Number(j.totalItemCount) || 0, non_lus: Number(j.unreadItemCount) || 0 }
  } catch { return null }
}

export async function GET(req: Request) {
  const agent = await authenticateAgent(req)
  if (!agent) return NextResponse.json({ error: 'Clé d’agent absente, invalide ou désactivée.' }, { status: 401 })
  const sb = createAdminClient()
  const [aFacturer, info, admin, claudy] = await Promise.all([
    import('@/lib/dossier/todo-count').then(m => m.readTodoCount(sb)).then(t => t ? { nombre: t.count, compte_le: t.at } : null).catch(() => null),
    boite(MAIL_AGENT_MAILBOX),   // info@
    boite(OUT_MAILBOX),          // administration@
    import('@/lib/mobia/run').then(m => m.compterClaudySansBrouillon()).catch(() => null),
  ])
  return NextResponse.json({
    a_facturer: aFacturer,
    mails_non_tries: { info: info, administration: admin },
    claudy_sans_brouillon: claudy,
    at: new Date().toISOString(),
  })
}
