// src/components/facturation/AutoInvoiceAlert.tsx
//
// Bandeau « À facturer » : fiches que la facturation automatique n'arrive pas à
// facturer depuis plusieurs passages d'affilée, ou facturation automatique à
// l'arrêt. Avant, un échec ne se voyait nulle part (4 passages ratés le
// 30/09/2026 pendant une lenteur Odoo). Lu dans auto_invoice_history /
// auto_invoice_last_run (écrits par /api/cron/auto-invoice).

import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase'

const MIN_FAILS = 2          // passages ratés d'affilée avant d'alerter
const STALE_MIN = 60         // passages toutes les 15 min : 1 h sans passage = arrêt

const parse = (v: any) => { try { return typeof v === 'string' ? JSON.parse(v) : v } catch { return null } }
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' })

function plainReason(r?: string): string {
  const s = String(r || '')
  if (/504|timeout|timed out|délai/i.test(s)) return 'le logiciel comptable a répondu trop lentement'
  if (/429/.test(s)) return 'le logiciel comptable était surchargé'
  if (/fetch/i.test(s)) return 'connexion impossible'
  return s ? `erreur : ${s.slice(0, 120)}` : 'erreur inconnue'
}

export default async function AutoInvoiceAlert() {
  const sb = createAdminClient()
  const { data: rows } = await sb.from('app_settings').select('key, value').in('key', ['auto_invoice_last_run', 'auto_invoice_history'])
  const last = parse(rows?.find(r => r.key === 'auto_invoice_last_run')?.value)
  const hist: any[] = parse(rows?.find(r => r.key === 'auto_invoice_history')?.value) || []
  if (!last?.at) return null

  const staleMin = Math.round((Date.now() - new Date(last.at).getTime()) / 60000)
  const stale = staleMin > STALE_MIN

  // Échecs d'affilée, comptés depuis le dernier passage (seulement s'il avait
  // des fiches à traiter : sinon rien n'est en échec).
  const fails = new Map<string, { count: number; reason?: string; since: string }>()
  if (Array.isArray(hist) && hist[0]?.at === last.at) {
    const current = (hist[0].details || []).filter((d: any) => d.outcome === 'failed')
    for (const d of current) {
      const key = String(d.mission)
      let count = 0, since = hist[0].at
      for (const run of hist) {
        const hit = (run.details || []).find((x: any) => String(x.mission) === key)
        if (hit?.outcome !== 'failed') break
        count++; since = run.at
      }
      if (count >= MIN_FAILS) fails.set(key, { count, reason: d.reason, since })
    }
  }

  // Fiche encore à facturer et sans facture : sinon l'alerte est déjà réglée.
  let items: { id: string; number: string; count: number; reason?: string; since: string }[] = []
  const nums = [...fails.keys()].map(Number).filter(Number.isFinite)
  if (nums.length) {
    const { data: ms } = await sb.from('incoming_missions').select('id, mission_number, invoice_odoo_id, status')
      .in('mission_number', nums).eq('status', 'to_invoice').is('invoice_odoo_id', null)
    items = (ms || []).map((m: any) => ({ id: m.id, number: String(m.mission_number), ...fails.get(String(m.mission_number))! }))
  }

  if (!stale && items.length === 0) return null

  return (
    <div className="mx-4 lg:mx-6 mt-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      {stale && (
        <p className="font-bold">
          La facturation automatique ne tourne plus depuis {hhmm(last.at)} ({Math.floor(staleMin / 60)} h {staleMin % 60} min). Prévenir Olivier.
        </p>
      )}
      {items.length > 0 && (
        <>
          <p className="font-bold">
            {items.length === 1 ? 'Une fiche n’arrive pas' : `${items.length} fiches n’arrivent pas`} à être facturée{items.length > 1 ? 's' : ''} automatiquement.
          </p>
          <p className="text-amber-800">Nouvel essai toutes les 15 minutes. Si ça dure, facturer la fiche à la main.</p>
          <ul className="mt-2 space-y-1">
            {items.map(it => (
              <li key={it.id} className="flex flex-wrap items-center gap-x-2">
                <Link href={`/dispatch/dossier/${it.id}`} className="inline-flex min-h-[44px] items-center font-bold text-amber-900 underline">Fiche {it.number}</Link>
                <span className="text-amber-800">{it.count} essais ratés depuis {hhmm(it.since)} : {plainReason(it.reason)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
