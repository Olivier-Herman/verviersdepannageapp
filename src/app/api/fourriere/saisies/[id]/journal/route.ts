// src/app/api/fourriere/saisies/[id]/journal/route.ts
//
// JOURNAL d'un dossier Parquet : tout ce que le robot et le bureau ont fait,
// dans l'ordre, au même endroit — états de frais établis/envoyés, retours du
// Parquet (lien, mail, scan), dépôts JustInvoice, liquidation, facture,
// réquisitoire, levée, pause. Sources : saisie_etats_frais, saisie_mail_events,
// mission_logs et mission_remarks de la fiche. Olivier 16/09/2026 (temps 3).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sessionAccess }     from '@/lib/access'

export const dynamic = 'force-dynamic'

export interface JournalEntry { at: string; icon: string; text: string; by?: string | null; source: 'robot' | 'bureau' | 'externe' }

const fmtEur = (n: any) => `${Number(n || 0).toFixed(2).replace('.', ',')} €`
const fmtD   = (iso?: string | null) => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!sessionAccess(session, { modules: ['fourriere'] }).ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const sb = createAdminClient()
  const { data: d } = await sb.from('saisie_dossiers').select('id, mission_id, ef_number, created_at, notes, paused_at, paused_reason, paused_by, levee_date, domaine_remise_date').eq('id', params.id).maybeSingle()
  if (!d) return NextResponse.json({ error: 'Dossier introuvable' }, { status: 404 })

  const entries: JournalEntry[] = []
  entries.push({ at: d.created_at, icon: '📂', text: `Dossier Parquet ouvert${d.notes ? ` — ${d.notes}` : ''}`, source: 'robot' })
  if (d.paused_at) entries.push({ at: d.paused_at, icon: '⏸', text: `Mis en pause${d.paused_reason ? ` — ${d.paused_reason}` : ''}`, by: d.paused_by, source: 'bureau' })

  const { data: efs } = await sb.from('saisie_etats_frais')
    .select('id, numero, status, period_from, period_to, total_tvac, created_at, created_by, validation_at, liquide_at, odoo_invoice_id, justinvoice_ref, status_note, relance_count, last_relance_at')
    .eq('dossier_id', params.id).order('created_at')
  const numeros = new Set<string>()
  const jiRefs  = new Set<string>()
  for (const e of efs || []) {
    numeros.add(e.numero); if (e.justinvoice_ref) jiRefs.add(e.justinvoice_ref)
    entries.push({ at: e.created_at, icon: '📄', text: `État de frais ${e.numero} établi — ${fmtD(e.period_from)} → ${fmtD(e.period_to)} · ${fmtEur(e.total_tvac)} TVAC`, by: e.created_by, source: e.created_by ? 'bureau' : 'robot' })
    if (e.validation_at) entries.push({ at: e.validation_at, icon: e.status === 'refuse' ? '❌' : '✅', text: `${e.numero} ${e.status === 'refuse' ? 'refusé' : 'validé'} par le Parquet`, source: 'externe' })
    if (e.liquide_at) entries.push({ at: e.liquide_at, icon: '🏛️', text: `${e.numero} liquidé${e.justinvoice_ref ? ` (dossier ${e.justinvoice_ref})` : ''}`, source: 'externe' })
    if (e.last_relance_at) entries.push({ at: e.last_relance_at, icon: '📨', text: `Rappel au Parquet pour ${e.numero}${e.relance_count ? ` (n°${e.relance_count})` : ''}`, source: 'bureau' })
  }

  // Mails lus par la veille (statuts JustInvoice, retours signés).
  const refs = [...numeros, ...jiRefs]
  if (refs.length) {
    const { data: ev } = await sb.from('saisie_mail_events').select('kind, ref, outcome, created_at').in('ref', refs).order('created_at')
    for (const e of ev || []) entries.push({ at: e.created_at, icon: e.kind === 'liquidation' ? '🏛️' : e.kind === 'retour_signe' ? '📬' : '✉️', text: `${e.kind === 'liquidation' ? 'Liquidation' : e.kind === 'retour_signe' ? 'Retour signé reçu par mail' : 'Statut JustInvoice'}${e.ref ? ` ${e.ref}` : ''}${e.outcome ? ` — ${String(e.outcome).slice(0, 160)}` : ''}`, source: 'robot' })
  }

  // Fiche : logs et remarques du circuit (réquisitoire, levée, envois, dépôts…).
  if (d.mission_id) {
    const { data: logs } = await sb.from('mission_logs').select('action, notes, created_at, actor_id')
      .eq('mission_id', d.mission_id)
      .or('action.ilike.requisitoire%,action.ilike.officer%,action.ilike.levee%,action.ilike.saisie%,action.ilike.etat_frais%,action.ilike.justinvoice%,action.ilike.parquet%')
      .order('created_at').limit(200)
    for (const l of logs || []) entries.push({ at: l.created_at, icon: /requisitoire|officer/.test(l.action) ? '🚔' : /levee/.test(l.action) ? '🔓' : /justinvoice/.test(l.action) ? '📤' : /etat_frais/.test(l.action) ? '📧' : '•', text: l.notes || l.action, by: l.actor_id, source: l.actor_id ? 'bureau' : 'robot' })
    const { data: rem } = await sb.from('mission_remarks').select('text, created_at, created_by')
      .eq('mission_id', d.mission_id)
      .or('text.ilike.%état de frais%,text.ilike.%Parquet%,text.ilike.%JustInvoice%,text.ilike.%réquisitoire%,text.ilike.%Réquisitoire%,text.ilike.%Levée de saisie%')
      .order('created_at').limit(200)
    for (const r of rem || []) entries.push({ at: r.created_at, icon: '💬', text: r.text, by: r.created_by, source: r.created_by ? 'bureau' : 'robot' })
  }

  // Noms des acteurs.
  const ids = [...new Set(entries.map(e => e.by).filter(Boolean))] as string[]
  const names: Record<string, string> = {}
  if (ids.length) { const { data: us } = await sb.from('users').select('id, name').in('id', ids); for (const u of us || []) names[u.id] = u.name || '' }
  const out = entries
    .map(e => ({ ...e, by: e.by ? (names[e.by] || null) : null }))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
  return NextResponse.json({ ok: true, entries: out })
}
