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

// Garde-fou : empêche un appel externe lent (Hexalite) de faire timeout tout le cron.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms)),
  ])
}

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
  let hexaliteError: string | null = null
  if (needHexalite) {
    try {
      const token = await withTimeout(getValidAllianzToken(), 15_000)
      const listing = await withTimeout(listAllianzToAssign(token), 15_000)
      hexaliteNumbers = new Set(
        (listing.content || []).map((a: any) => assignNo(a.assignmentNumber)).filter(Boolean),
      )
    } catch (e: any) {
      // Hexalite injoignable (OTP expiré, 401/403, timeout…) → on NE peut PAS
      // vérifier : par sécurité on saute les sources Allianz cette passe.
      hexaliteUnavailable = true
      hexaliteError = String(e?.message || e)
    }
  }

  // IMPORTANT : base URL STABLE pour le self-fetch vers /quote. En cron Vercel,
  // `req.url` ne pointe PAS vers l'URL publique utilisable → le fetch échouait en
  // silence (cause : le cron ne facturait jamais en planifié, seulement en
  // déclenchement manuel sur l'URL publique). Même pattern que auto-dispatch-tick.
  const baseUrl = process.env.NEXTAUTH_URL || 'https://app.verviersdepannage.com'

  const cutoff = new Date(Date.now() - delayH * 3600_000).toISOString()

  // Missions clôturées depuis > délai, sources concernées, pas déjà facturées/devisées.
  const { data: candidates } = await sb.from('incoming_missions')
    .select('id, mission_number, external_id, source, mission_type, parent_mission_id, completed_at, odoo_quote_id, invoice_odoo_id, billed_to_name')
    .eq('status', 'to_invoice')
    .eq('needs_siabis_decision', false)   // pas d'auto-facture tant que la question autoroute n'est pas tranchée
    .in('source', activeSources)
    .lt('completed_at', cutoff)
    .is('odoo_quote_id', null)
    .is('invoice_odoo_id', null)
    .order('completed_at', { ascending: true })
    .limit(200)

  // Exclusion COMEX BKO : une fiche présente dans COMEX BKO sera validée via le
  // flux Touring COMEX (qui fait sa propre auto-facturation) → on ne l'auto-
  // facture PAS ici (sinon doublon / mauvaise voie). Olivier 2026-07-29.
  const comexMissionIds = new Set<string>()
  {
    const { data: comexRows } = await sb.from('touring_comex_dossiers').select('mission_id, mission_ids').eq('in_comex', true)
    for (const cr of (comexRows || [])) {
      if (cr.mission_id) comexMissionIds.add(cr.mission_id)
      if (Array.isArray(cr.mission_ids)) for (const id of cr.mission_ids) comexMissionIds.add(id)
    }
  }

  let eligible = 0, invoiced = 0, noTariff = 0, combined = 0, failed = 0, hexalite = 0, comex = 0
  const done: string[] = []
  // Détail PAR mission (outcome + raison) — indispensable pour diagnostiquer.
  const details: { mission: number | string; source: string | null; type: string | null; outcome: string; reason?: string }[] = []
  const ref = (m: any) => (m.mission_number ?? m.external_id ?? m.id.slice(0, 8))

  for (const m of (candidates || [])) {
    const check = checkAutoInvoiceEligible(m as any, rules)
    if (!check.eligible) { details.push({ mission: ref(m), source: m.source, type: m.mission_type, outcome: 'not_eligible', reason: check.reason || undefined }); continue }
    eligible++
    // Présente dans COMEX BKO → validée via Touring COMEX, jamais ici.
    if (comexMissionIds.has(m.id)) {
      comex++; details.push({ mission: ref(m), source: m.source, type: m.mission_type, outcome: 'comex', reason: 'présente dans COMEX BKO (→ validation Touring COMEX)' }); continue
    }
    // Source Allianz : si la mission est encore "dans Hexalite" (liste à clôturer),
    // ou si Hexalite est injoignable, on ne la touche pas (auto-facturation Hexalite).
    if (HEXALITE_SOURCES.has(String(m.source || ''))) {
      if (hexaliteUnavailable || (hexaliteNumbers && hexaliteNumbers.has(assignNo(m.external_id)))) {
        hexalite++; details.push({ mission: ref(m), source: m.source, type: m.mission_type, outcome: 'hexalite', reason: hexaliteUnavailable ? `Hexalite injoignable (${hexaliteError})` : 'dans la liste à clôturer' }); continue
      }
    }
    // Mission sèche : aucune fiche enfant (relivraison).
    const { count: childCount } = await sb.from('incoming_missions')
      .select('id', { count: 'exact', head: true }).eq('parent_mission_id', m.id)
    if (childCount) { combined++; details.push({ mission: ref(m), source: m.source, type: m.mission_type, outcome: 'combined' }); continue }
    if (invoiced >= BATCH) { details.push({ mission: ref(m), source: m.source, type: m.mission_type, outcome: 'batch_skipped' }); continue }

    try {
      const url = `${baseUrl}/api/missions/${m.id}/quote`
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.NEXTAUTH_SECRET || '' },
        body: JSON.stringify({ mode: 'invoice', requireTariff: true }),
      })
      const j = await r.json().catch(() => ({}))
      if (j?.ok && j.invoice) { invoiced++; done.push(String(ref(m))); details.push({ mission: ref(m), source: m.source, type: m.mission_type, outcome: 'invoiced' }) }
      else if (j?.reason === 'no_tariff') { noTariff++; details.push({ mission: ref(m), source: m.source, type: m.mission_type, outcome: 'no_tariff' }) }
      else { failed++; details.push({ mission: ref(m), source: m.source, type: m.mission_type, outcome: 'failed', reason: (j?.error || j?.reason || `HTTP ${r.status}`) }) }
    } catch (e: any) { failed++; details.push({ mission: ref(m), source: m.source, type: m.mission_type, outcome: 'failed', reason: `fetch: ${String(e?.message || e)}` }) }
  }

  // Compteur de couverture + DÉTAIL par mission (diagnostic). On garde aussi un
  // historique roulant des 20 derniers runs (auto_invoice_history).
  const summary = {
    at: new Date().toISOString(), delay_hours: delayH,
    scanned: (candidates || []).length,
    eligible, invoiced, noTariff, combined, failed, hexalite, comex,
    ...(hexaliteError ? { hexaliteError } : {}),
    done: done.slice(0, 30),
    details: details.slice(0, 60),
  }
  await sb.from('app_settings').upsert({ key: 'auto_invoice_last_run', value: summary }, { onConflict: 'key' }).then(() => {}, () => {})
  // Historique : ne garder que les runs "intéressants" (candidats scannés > 0)
  // pour ne pas noyer sous les passes à vide.
  if ((candidates || []).length > 0) {
    try {
      const { data: hist } = await sb.from('app_settings').select('value').eq('key', 'auto_invoice_history').maybeSingle()
      let arr: any[] = []
      try { arr = Array.isArray(hist?.value) ? hist!.value : (hist?.value ? JSON.parse(hist.value as any) : []) } catch { arr = [] }
      arr.unshift(summary)
      await sb.from('app_settings').upsert({ key: 'auto_invoice_history', value: arr.slice(0, 20) }, { onConflict: 'key' })
    } catch { /* best-effort */ }
  }
  console.log('[auto-invoice]', JSON.stringify(summary))

  return NextResponse.json({ ok: true, ...summary })
}
