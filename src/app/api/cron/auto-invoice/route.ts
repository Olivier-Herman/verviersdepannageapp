// src/app/api/cron/auto-invoice/route.ts
//
// Facturation AUTOMATIQUE (cron roulant). Toutes les 30 min : scanne les missions
// clôturées (to_invoice) depuis > délai (défaut 2h), éligibles (règle source+type
// DSP/REM activée), SÈCHES (pas de parent ni d'enfant relivraison), pas encore
// facturées, et crée la facture brouillon Odoo si un VRAI tarif est présent.
//
// Idempotent (skip si odoo_quote_id/invoice_odoo_id déjà là) → jamais de doublon,
// pas de conflit avec la facturation manuelle. Olivier 2026-07-27.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { getAutoInvoiceRules, getAutoInvoiceDelayHours, checkAutoInvoiceEligible, AUTO_INVOICE_TYPES } from '@/lib/facturation/auto-invoice'
import { getValidAllianzToken, listAllianzToAssign } from '@/lib/allianz/closure'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

const BATCH = 25   // borne par passe (chaque facture = ~2-3s Odoo)

// Sources gérées via Hexalite (Allianz). Une mission encore présente dans la liste
// Hexalite "à clôturer" NE doit PAS être auto-facturée par nous : elle sera
// auto-facturée à la clôture Hexalite (onglet "Clôture Allianz"). Olivier 2026-07-27.
const HEXALITE_SOURCES = new Set(['allianz', 'mondial'])
const assignNo = (v: string | null | undefined) => String(v || '').split('/')[0].trim()

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = createAdminClient()
  const rules = await getAutoInvoiceRules(sb)
  const delayH = await getAutoInvoiceDelayHours(sb)

  // Sources ayant AU MOINS un type activé (n'importe lequel).
  const activeSources = Object.entries(rules)
    .filter(([, r]) => AUTO_INVOICE_TYPES.some(t => r?.[t.key]))
    .map(([s]) => s)
  if (activeSources.length === 0) {
    return NextResponse.json({ ok: true, delay_hours: delayH, invoiced: 0, note: 'aucune règle active' })
  }

  // Exclusion Hexalite : si une source Allianz (allianz/mondial) est active, on
  // récupère une fois la liste Hexalite "à clôturer" et on refuse d'auto-facturer
  // toute mission qui y figure encore (même filtre que l'onglet Clôture Allianz).
  const needHexalite = activeSources.some(s => HEXALITE_SOURCES.has(s))
  let hexaliteNumbers: Set<string> | null = null
  let hexaliteUnavailable = false
  if (needHexalite) {
    try {
      const token = await getValidAllianzToken()
      const listing = await listAllianzToAssign(token)
      hexaliteNumbers = new Set(
        (listing.content || []).map((a: any) => assignNo(a.assignmentNumber)).filter(Boolean),
      )
    } catch {
      // Hexalite injoignable (OTP expiré, 401/403…) → on NE peut PAS vérifier :
      // par sécurité on saute les sources Allianz cette passe (jamais de doublon).
      hexaliteUnavailable = true
    }
  }

  const cutoff = new Date(Date.now() - delayH * 3600_000).toISOString()

  // Missions clôturées depuis > délai, sources concernées, pas déjà facturées/devisées.
  const { data: candidates } = await sb.from('incoming_missions')
    .select('id, external_id, source, mission_type, parent_mission_id, completed_at, odoo_quote_id, invoice_odoo_id')
    .eq('status', 'to_invoice')
    .in('source', activeSources)
    .lt('completed_at', cutoff)
    .is('odoo_quote_id', null)
    .is('invoice_odoo_id', null)
    .order('completed_at', { ascending: true })
    .limit(200)

  let eligible = 0, invoiced = 0, noTariff = 0, combined = 0, failed = 0, hexalite = 0
  const done: string[] = []

  for (const m of (candidates || [])) {
    const check = checkAutoInvoiceEligible(m as any, rules)
    if (!check.eligible) continue
    eligible++
    // Source Allianz : si la mission est encore "dans Hexalite" (liste à clôturer),
    // ou si Hexalite est injoignable, on ne la touche pas (auto-facturation Hexalite).
    if (HEXALITE_SOURCES.has(String(m.source || ''))) {
      if (hexaliteUnavailable || (hexaliteNumbers && hexaliteNumbers.has(assignNo(m.external_id)))) {
        hexalite++; continue
      }
    }
    // Mission sèche : aucune fiche enfant (relivraison).
    const { count: childCount } = await sb.from('incoming_missions')
      .select('id', { count: 'exact', head: true }).eq('parent_mission_id', m.id)
    if (childCount) { combined++; continue }
    if (invoiced >= BATCH) break

    try {
      const url = new URL(`/api/missions/${m.id}/quote`, req.url).toString()
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.NEXTAUTH_SECRET || '' },
        body: JSON.stringify({ mode: 'invoice', requireTariff: true }),
      })
      const j = await r.json().catch(() => ({}))
      if (j?.ok && j.invoice) { invoiced++; done.push(m.external_id || m.id.slice(0, 8)) }
      else if (j?.reason === 'no_tariff') noTariff++
      else failed++
    } catch { failed++ }
  }

  // Compteur de couverture : combien le système a dû facturer (Jona ne l'avait pas fait).
  const summary = { at: new Date().toISOString(), delay_hours: delayH, eligible, invoiced, noTariff, combined, failed, hexalite, done: done.slice(0, 30) }
  await sb.from('app_settings').upsert({ key: 'auto_invoice_last_run', value: summary }, { onConflict: 'key' }).then(() => {}, () => {})
  console.log('[auto-invoice]', JSON.stringify(summary))

  return NextResponse.json({ ok: true, ...summary })
}
