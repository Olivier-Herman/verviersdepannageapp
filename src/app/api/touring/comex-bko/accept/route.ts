// src/app/api/touring/comex-bko/accept/route.ts
//
// POST { ids: string[] } — accepte les dossiers COMEX BKO sélectionnés :
//   1. Écriture COMEX BKO (setKm + setDossStatut) via le compte du dossier.
//   2. Auto-facturation VD Soft de la fiche liée (status=completed, invoice_method=auto).
// Superadmin uniquement. ⚠️ Écritures réelles (Touring + VD Soft). Olivier 2026-07-27.

import { NextResponse }        from 'next/server'
import { getServerSession }    from 'next-auth'
import { authOptions }         from '@/lib/auth'
import { createAdminClient }   from '@/lib/supabase'
import { releaseParcAndShift } from '@/lib/parc/release'
import { getBkoAccounts, loginComexBko, acceptComexBkoDossier } from '@/lib/touring/comex-bko'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: Request) {
  const isInternal = !!process.env.NEXTAUTH_SECRET && req.headers.get('x-internal-secret') === process.env.NEXTAUTH_SECRET
  const session = isInternal ? null : await getServerSession(authOptions)
  const user = (session?.user as any) || {}
  const role: string = user?.role || ''
  const modules: string[] = Array.isArray(user?.modules) ? user.modules : []
  if (!isInternal && !(['admin', 'superadmin'].includes(role) || modules.includes('facturation'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: any) => typeof x === 'string') : []
  if (!ids.length) return NextResponse.json({ error: 'ids requis' }, { status: 400 })

  const sb = createAdminClient()
  const { data: rows } = await sb.from('touring_comex_dossiers').select('*').in('id', ids)
  if (!rows?.length) return NextResponse.json({ error: 'aucun dossier' }, { status: 404 })

  // Sessions BKO par compte (login une fois par compte).
  const accounts = getBkoAccounts()
  const cookies = new Map<string, string>()
  async function cookieFor(label: string): Promise<string | null> {
    if (cookies.has(label)) return cookies.get(label)!
    const acct = accounts.find(a => a.label === label)
    if (!acct) return null
    try { const c = await loginComexBko(acct); cookies.set(label, c); return c } catch { return null }
  }

  const now = new Date().toISOString()
  const results: any[] = []

  for (const r of rows) {
    const label = String(r.dossier || r.mission_number || r.id.slice(0, 8))
    const cookie = await cookieFor(r.account)
    if (!cookie) { results.push({ id: r.id, ref: label, ok: false, reason: `login COMEX ${r.account} KO` }); continue }

    // 1) Écriture COMEX BKO.
    const acc = await acceptComexBkoDossier(cookie, {
      dossier: r.dossier, cidSeqAction: r.cid_seq_action || '', commande: r.commande || '', km: Number(r.km) || 0,
    })
    if (!acc.ok) { results.push({ id: r.id, ref: label, ok: false, reason: `COMEX: ${acc.error}` }); continue }

    // 2) Auto-facturation VD Soft — TOUTES les fiches de la chaîne (REM + REL).
    const missionIds: string[] = Array.isArray(r.mission_ids) && r.mission_ids.length
      ? r.mission_ids
      : (r.mission_id ? [r.mission_id] : [])
    let vdFactured = 0
    for (const mid of missionIds) {
      const { data: m } = await sb.from('incoming_missions').select('id, status, invoice_method').eq('id', mid).maybeSingle()
      if (m && m.status === 'to_invoice' && m.invoice_method !== 'auto') {
        const { error: updErr } = await sb.from('incoming_missions').update({
          status: 'completed', invoice_method: 'auto', invoiced_at: now, invoiced_by: user.id || null,
          auto_invoiced: isInternal,   // cron → « Système (auto) » ; manuel → attribué à l'user
          updated_at: now,
        }).eq('id', mid)
        if (!updErr) {
          vdFactured++
          try { await releaseParcAndShift(sb, mid) } catch { /* hors parc : ok */ }
          await sb.from('mission_logs').insert({
            mission_id: mid, actor_id: user.id || null, action: 'invoiced',
            notes: `Auto-facturation (validation Touring COMEX BKO — ${r.account})`,
            metadata: { method: 'auto', comex_bko: true, dossier: r.dossier, commande: r.commande },
          }).then(() => {}, () => {})
        }
      } else if (m && (m.invoice_method === 'auto' || m.status === 'completed')) {
        vdFactured++   // déjà facturée
      }
    }

    // 3) Le dossier quitte la file COMEX.
    await sb.from('touring_comex_dossiers').update({
      in_comex: false, accepted_at: now, accepted_by: user.id || null, last_seen_at: now,
    }).eq('id', r.id)

    results.push({ id: r.id, ref: label, ok: true, vdFactured })
  }

  const okCount = results.filter(r => r.ok).length
  return NextResponse.json({ ok: true, accepted: okCount, total: results.length, results })
}
