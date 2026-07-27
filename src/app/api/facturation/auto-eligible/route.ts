// src/app/api/facturation/auto-eligible/route.ts
//
// GET /api/facturation/auto-eligible
// Compte, EN DIRECT, combien de missions seraient auto-facturées au prochain
// cron (mêmes portes que /api/cron/auto-invoice, mais LECTURE SEULE, sans
// créer de facture). Sert l'indicateur « Éligible : x » côté module facturation
// (superadmin uniquement) + le diagnostic (?verbose=1) pour comprendre pourquoi
// une mission passe ou non. Olivier 2026-07-27.
//
// Accès : superadmin (session) OU x-internal-secret === NEXTAUTH_SECRET (debug).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { getAutoInvoiceRules, getAutoInvoiceDelayHours, checkAutoInvoiceEligible, autoInvoiceType, AUTO_INVOICE_TYPES } from '@/lib/facturation/auto-invoice'
import { getValidAllianzToken, listAllianzToAssign } from '@/lib/allianz/closure'
import { estimateMissionPrice } from '@/lib/missions/estimate-price'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const HEXALITE_SOURCES = new Set(['allianz', 'mondial'])
const assignNo = (v: string | null | undefined) => String(v || '').split('/')[0].trim()

export async function GET(req: Request) {
  // Auth : superadmin OU secret interne.
  const isInternal = req.headers.get('x-internal-secret') === process.env.NEXTAUTH_SECRET && !!process.env.NEXTAUTH_SECRET
  if (!isInternal) {
    const session = await getServerSession(authOptions)
    if ((session?.user as any)?.role !== 'superadmin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }
  const url = new URL(req.url)
  const verbose = url.searchParams.get('verbose') === '1'

  const sb = createAdminClient()
  const rules  = await getAutoInvoiceRules(sb)
  const delayH = await getAutoInvoiceDelayHours(sb)
  const activeSources = Object.entries(rules)
    .filter(([, r]) => AUTO_INVOICE_TYPES.some(t => r?.[t.key]))
    .map(([s]) => s)

  if (activeSources.length === 0) {
    return NextResponse.json({ eligible: 0, waiting: 0, delayHours: delayH, activeSources: [], items: [] })
  }

  const nowMs  = Date.now()
  const cutoff = new Date(nowMs - delayH * 3600_000).toISOString()

  // Toutes les missions to_invoice des sources actives, pas encore facturées.
  const { data: rows } = await sb.from('incoming_missions')
    .select('id, mission_number, external_id, source, mission_type, parent_mission_id, completed_at, odoo_quote_id, invoice_odoo_id')
    .eq('status', 'to_invoice')
    .in('source', activeSources)
    .is('odoo_quote_id', null)
    .is('invoice_odoo_id', null)
    .order('completed_at', { ascending: true })
    .limit(300)

  // Liste Hexalite « à clôturer » (une seule fois) si une source Allianz active.
  const needHexalite = activeSources.some(s => HEXALITE_SOURCES.has(s))
  let hexaliteNumbers: Set<string> | null = null
  let hexaliteUnavailable = false
  if (needHexalite) {
    try {
      const token = await getValidAllianzToken()
      const listing = await listAllianzToAssign(token)
      hexaliteNumbers = new Set((listing.content || []).map((a: any) => assignNo(a.assignmentNumber)).filter(Boolean))
    } catch { hexaliteUnavailable = true }
  }

  let eligible = 0, waiting = 0, hexalite = 0
  const items: any[] = []

  for (const m of (rows || [])) {
    const type = autoInvoiceType(m.mission_type)
    const check = checkAutoInvoiceEligible(m as any, rules)
    let reason: string | null = null
    let ok = false

    const isHexSource = HEXALITE_SOURCES.has(String(m.source || ''))
    const inHexalite  = isHexSource && !hexaliteUnavailable && !!hexaliteNumbers && hexaliteNumbers.has(assignNo(m.external_id))

    if (!check.eligible) {
      reason = check.reason || 'non éligible'
    } else if (inHexalite) {
      // Dans Hexalite → Clôture Allianz IMMÉDIATEMENT, sans attendre le délai.
      reason = 'dans Hexalite (→ Clôture Allianz)'
      hexalite++
    } else if (isHexSource && hexaliteUnavailable) {
      reason = 'Hexalite injoignable (reporté)'
    } else {
      // Délai après clôture (fenêtre de correction manuelle).
      const compMs = m.completed_at ? new Date(m.completed_at).getTime() : null
      if (compMs == null || compMs >= nowMs - delayH * 3600_000) {
        reason = 'en attente du délai'
        waiting++
      } else {
        // Mission sèche (pas d'enfant relivraison).
        const { count: childCount } = await sb.from('incoming_missions')
          .select('id', { count: 'exact', head: true }).eq('parent_mission_id', m.id)
        if (childCount) {
          reason = 'combinée (relivraison liée)'
        } else {
          // Vrai tarif présent ?
          let est: any = null
          try { est = await estimateMissionPrice(m as any) } catch { /* ignore */ }
          if (!est || !est.ok || !(Number(est.total_eur) > 0)) {
            reason = 'pas de tarif'
          } else {
            ok = true
            eligible++
          }
        }
      }
    }
    if (verbose) items.push({
      mission_number: m.mission_number, source: m.source, mission_type: m.mission_type,
      type, eligible: ok, reason,
    })
  }

  return NextResponse.json({
    eligible, waiting, hexalite, delayHours: delayH,
    ...(verbose ? { activeSources, hexaliteUnavailable, total_scanned: (rows || []).length, items } : {}),
  })
}
