'use client'

// Modale « Facture partielle » (fiche d'intervention, véhicule en parc).
// On coche les postes à facturer maintenant (dépannage) et/ou une période de
// gardiennage. → prépare un devis Odoo partiel + enregistre les postes facturés.
// Le véhicule reste en parc. Olivier 2026-06-17. Cf project_facture_partielle.

import { useEffect, useState } from 'react'

interface Line { kind: string; label: string; qty: number; price_unit: number; checked: boolean }
interface BilledItem { kind: string; label: string; amount_htva: number; period_from: string | null; period_to: string | null; billed_at: string; odoo_quote_id: number | null; invoice_number: string | null }

const todayISO = () => new Date().toISOString().slice(0, 10)
const addDays = (iso: string, n: number) => { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const daysBetween = (from: string, to: string) => {
  const a = new Date(from).getTime(), b = new Date(to).getTime()
  if (isNaN(a) || isNaN(b) || b < a) return 0
  return Math.floor((b - a) / 86400000) + 1   // inclusif
}

export default function PartialInvoiceModal({ missionId, parkedSince, onClose, onDone }: {
  missionId:   string
  parkedSince?: string | null     // date d'entrée parc (intervention_date / parked_at)
  onClose:     () => void
  onDone:      () => void
}) {
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [lines, setLines] = useState<Line[]>([])
  const [billed, setBilled] = useState<BilledItem[]>([])
  const [invDraft, setInvDraft] = useState<Record<number, string>>({})
  const [savingInv, setSavingInv] = useState<number | null>(null)

  async function saveInvoiceNumber(quoteId: number) {
    const num = (invDraft[quoteId] || '').trim()
    if (!num) return
    setSavingInv(quoteId)
    try {
      const r = await fetch(`/api/missions/${missionId}/billed-items`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ odoo_quote_id: quoteId, invoice_number: num }),
      })
      if (r.ok) setBilled(bs => bs.map(b => b.odoo_quote_id === quoteId ? { ...b, invoice_number: num } : b))
    } finally { setSavingInv(null) }
  }

  // Gardiennage
  const [parcOn, setParcOn]       = useState(false)
  const [parcWaived, setParcWaived] = useState(false)   // abandon volontaire → gardiennage offert
  const [parcForfait, setParcForfait] = useState(false) // forfait → pas de comptage au jour
  const [parcPrice, setParcPrice] = useState(0)
  const [parcFrom, setParcFrom]   = useState('')
  const [parcTo, setParcTo]       = useState(todayISO())

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch(`/api/missions/${missionId}/price-estimate`).then(r => r.json()),
      fetch(`/api/missions/${missionId}/billed-items`).then(r => r.json()),
    ]).then(([est, bi]) => {
      if (cancelled) return
      // Postes dépannage proposés depuis l'estimation — CHAQUE ligne est
      // sélectionnable (Olivier 2026-06-22). Le gardiennage (SERV-PARC) est géré
      // séparément dans sa propre section (période + prix/jour).
      let proposed: Line[] = []
      let parcUnitFromLines: number | null = null
      if (est?.ok) {
        if (Array.isArray(est.template_lines) && est.template_lines.length > 0) {
          // Chemin "lines" (police / saisie / accident) : reprend chaque ligne.
          for (const tl of est.template_lines) {
            if (tl.kind === 'SERV-PARC') {
              // Gardiennage → section dédiée (récupère le prix/jour).
              if (tl.default_price != null) parcUnitFromLines = round(Number(tl.default_price))
              continue
            }
            const qty = tl.default_qty != null && Number(tl.default_qty) > 0 ? Number(tl.default_qty) : 1
            const pu  = tl.default_price != null ? round(Number(tl.default_price)) : 0
            if (pu <= 0) continue
            proposed.push({ kind: tl.kind, label: tl.name, qty, price_unit: pu, checked: true })
          }
        } else {
          // Chemin "forfait" (assurances / garage / privé).
          // Tarif convenu (relivraison à prix imposé, accord client) : l'estimation
          // renvoie `special_tarif` et met tout le montant dans `forfait`. On le
          // nomme comme la facturation le nommera. Olivier 2026-08-31.
          if (est.special_tarif && est.forfait > 0) {
            proposed.push({ kind: 'SERV-DIV', label: 'Intervention suivant prix convenu', qty: 1, price_unit: round(est.forfait), checked: true })
          } else if (est.forfait && est.forfait > 0) proposed.push({ kind: 'SERV-PEC', label: 'Prise en charge / forfait', qty: 1, price_unit: round(est.forfait), checked: true })
          if (est.km_extra > 0 && est.km_extra_eur > 0) proposed.push({ kind: 'SERV-KM', label: 'Km supplémentaires', qty: est.km_extra, price_unit: round(est.km_extra_eur / est.km_extra), checked: true })
        }
        if (est.surcharge_eur > 0) proposed.push({ kind: 'SERV-MAJ', label: `Majoration ${est.surcharge_pct || ''}%`, qty: 1, price_unit: round(est.surcharge_eur), checked: true })
        // Gardiennage AU FORFAIT : une ligne de parc normale, mais un montant
        // fixe et une seule fois — pas de période, donc pas de section « jours ».
        // Olivier 2026-08-31 (Ethias / Kaze sur accident police).
        if (bi?.storage_flat_htva > 0) {
          proposed.push({ kind: 'SERV-PARC', label: 'Frais de gardiennage — forfait', qty: 1, price_unit: round(Number(bi.storage_flat_htva)), checked: true })
        }
      }
      setLines(proposed)
      // Prix gardiennage / jour — le CATALOGUE DE LA SOURCE fait foi (Olivier
      // 2026-08-17). L'estimation ne servait que de repli et donnait un prix
      // reconstitué qui ne suivait pas la fiche.
      setParcWaived(!!bi?.storage_waived)
      setParcForfait(Number(bi?.storage_flat_htva) > 0)
      if (bi?.parc_day_price != null && Number(bi.parc_day_price) > 0) setParcPrice(round(Number(bi.parc_day_price)))
      else if (est?.parc_jours > 0 && est?.parc_eur > 0) setParcPrice(round(est.parc_eur / est.parc_jours))
      else if (parcUnitFromLines && parcUnitFromLines > 0) setParcPrice(parcUnitFromLines)
      // Postes déjà facturés
      const items: BilledItem[] = bi?.items || []
      setBilled(items)
      // ⚠️ Un poste déjà facturé ne doit PLUS être proposé. Sur #10112844, la
      // seconde facture partielle reproposait la prise en charge, les km et les
      // frais administratifs déjà réglés (Olivier 2026-08-17). Le gardiennage
      // fait exception : il se facture par tranches successives.
      const dejaFactures = new Set(items.filter(i => i.kind !== 'SERV-PARC').map(i => i.kind))
      if (dejaFactures.size > 0) proposed = proposed.filter(l => !dejaFactures.has(l.kind))
      // Pré-remplit les n° de facture déjà saisis (par lot odoo_quote_id).
      const drafts: Record<number, string> = {}
      for (const it of items) if (it.odoo_quote_id && it.invoice_number) drafts[it.odoo_quote_id] = it.invoice_number
      setInvDraft(drafts)
      // Période gardiennage par défaut : au lendemain de la dernière tranche
      // facturée, sinon au LENDEMAIN DE L'ENTRÉE — le jour d'entrée ne se
      // facture pas (Olivier 2026-08-17). On partait du jour d'entrée lui-même :
      // un véhicule pris le 16 et facturé le 17 comptait deux jours au lieu d'un.
      const start = bi?.last_parc_period_to
        ? addDays(String(bi.last_parc_period_to).slice(0, 10), 1)
        : (parkedSince ? addDays(parkedSince.slice(0, 10), 1) : todayISO())
      setParcFrom(start)
    }).catch(() => setError('Erreur de chargement'))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [missionId, parkedSince])

  const parcDays  = parcOn ? daysBetween(parcFrom, parcTo) : 0
  const parcTotal = parcDays * parcPrice
  const linesTotal = lines.filter(l => l.checked).reduce((s, l) => s + l.qty * l.price_unit, 0)
  const grandTotal = linesTotal + parcTotal

  const submit = async () => {
    const payload: any[] = lines.filter(l => l.checked && l.qty > 0).map(l => ({ kind: l.kind, label: l.label, qty: l.qty, price_unit: l.price_unit }))
    if (parcOn && parcDays > 0 && parcPrice > 0) {
      payload.push({ kind: 'SERV-PARC', label: `Gardiennage du ${fmt(parcFrom)} au ${fmt(parcTo)} (${parcDays} j)`, qty: parcDays, price_unit: parcPrice, period_from: parcFrom, period_to: parcTo })
    }
    if (payload.length === 0) { setError('Sélectionne au moins un poste à facturer'); return }
    setSubmitting(true); setError(null)
    try {
      const r = await fetch(`/api/missions/${missionId}/partial-invoice`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines: payload }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Erreur')
      if (j.quote_url) window.open(j.quote_url, '_blank')
      onDone()
    } catch (e: any) { setError(e.message || 'Échec de la facture partielle') }
    finally { setSubmitting(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-surface border rounded-2xl p-5 max-w-lg w-full max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-ink font-semibold">🧾 Facture partielle</h3>
          <button onClick={onClose} className="text-ink-muted text-2xl leading-none">×</button>
        </div>
        <p className="text-ink-muted text-xs mb-4">Coche les postes à facturer maintenant. Le véhicule <strong>reste en parc</strong> ; le solde se facturera à la sortie.</p>

        {error && <p className="text-error text-sm mb-3">{error}</p>}
        {loading && <p className="text-ink-muted text-sm">⏳ Chargement…</p>}

        {!loading && (
          <>
            {/* Déjà facturé — groupé par facture partielle (lot odoo_quote_id),
                avec saisie du n° de facture par lot. */}
            {billed.length > 0 && (() => {
              const groups = new Map<number | string, { quoteId: number | null; items: BilledItem[]; total: number; invoice: string | null }>()
              for (const b of billed) {
                const key = b.odoo_quote_id ?? `none-${b.billed_at}`
                const g = groups.get(key) || { quoteId: b.odoo_quote_id, items: [], total: 0, invoice: b.invoice_number }
                g.items.push(b); g.total += Number(b.amount_htva || 0); g.invoice = g.invoice || b.invoice_number
                groups.set(key, g)
              }
              return (
                <div className="mb-4 space-y-2">
                  <p className="text-ink-muted text-xs font-semibold uppercase tracking-wide">✓ Déjà facturé</p>
                  {[...groups.values()].map((g, gi) => (
                    <div key={gi} className="rounded-xl bg-surface-2 border p-3 space-y-1">
                      {g.items.map((b, i) => (
                        <p key={i} className="text-ink-faint text-xs">
                          {b.label} — {Number(b.amount_htva).toFixed(2)} € HTVA
                          {b.period_from && b.period_to ? ` (du ${fmt(b.period_from)} au ${fmt(b.period_to)})` : ''}
                        </p>
                      ))}
                      <p className="text-ink text-xs font-semibold pt-1">Total : {g.total.toFixed(2)} € HTVA</p>
                      {g.quoteId != null && (
                        <div className="flex items-center gap-2 pt-1.5 border-t mt-1">
                          <span className="text-ink-muted text-xs whitespace-nowrap">N° facture :</span>
                          <input
                            type="text"
                            value={invDraft[g.quoteId] ?? ''}
                            onChange={e => setInvDraft(d => ({ ...d, [g.quoteId as number]: e.target.value }))}
                            placeholder="ex. INV/2026/0123"
                            className="flex-1 bg-surface border rounded px-2 py-1 text-ink text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => saveInvoiceNumber(g.quoteId as number)}
                            disabled={savingInv === g.quoteId || !(invDraft[g.quoteId] || '').trim()}
                            className="px-2.5 py-1 bg-brand hover:bg-brand-dark text-white rounded text-xs font-semibold disabled:opacity-50"
                          >
                            {savingInv === g.quoteId ? '…' : (g.invoice ? '✓ Maj' : 'Enregistrer')}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )
            })()}

            {/* Postes dépannage */}
            <div className="space-y-2 mb-4">
              <p className="text-ink-muted text-xs font-semibold uppercase tracking-wide">Postes</p>
              {lines.length === 0 && <p className="text-ink-faint text-xs">Aucun poste dépannage estimé.</p>}
              {lines.map((l, idx) => (
                <label key={idx} className="flex items-center gap-2 bg-surface-2 border rounded-xl px-3 py-2 cursor-pointer">
                  <input type="checkbox" checked={l.checked} onChange={e => setLines(ls => ls.map((x, i) => i === idx ? { ...x, checked: e.target.checked } : x))} />
                  <span className="flex-1 text-ink text-sm">{l.label}</span>
                  <input type="number" value={l.qty} onChange={e => setLines(ls => ls.map((x, i) => i === idx ? { ...x, qty: Number(e.target.value) } : x))}
                    className="w-14 bg-surface border rounded px-1.5 py-1 text-ink text-xs text-right" />
                  <span className="text-ink-faint text-xs">×</span>
                  <input type="number" step="0.01" value={l.price_unit} onChange={e => setLines(ls => ls.map((x, i) => i === idx ? { ...x, price_unit: Number(e.target.value) } : x))}
                    className="w-20 bg-surface border rounded px-1.5 py-1 text-ink text-xs text-right" />
                  <span className="text-ink-faint text-xs">€</span>
                </label>
              ))}
            </div>

            {/* Gardiennage par période — masqué quand le parc est AU FORFAIT :
                il est déjà proposé plus haut comme une ligne fixe, et laisser la
                section ouverte inviterait à facturer les deux. Olivier 2026-08-31. */}
            {parcForfait ? (
              <div className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 p-3">
                <p className="text-emerald-900 text-xs font-semibold">🅿️ Gardiennage au forfait</p>
                <p className="text-emerald-900 text-xs mt-1">
                  Le parc est facturé en une ligne fixe (voir ci-dessus), pas au jour — aucune tranche à choisir.
                </p>
              </div>
            ) : (
            <div className="mb-4 rounded-xl border p-3">
              <label className={`flex items-center gap-2 mb-2 ${parcWaived ? 'opacity-60' : 'cursor-pointer'}`}>
                <input type="checkbox" checked={parcOn} disabled={parcWaived} onChange={e => setParcOn(e.target.checked)} />
                <span className="text-ink text-sm font-medium">Gardiennage (par période)</span>
              </label>
              {parcWaived && (
                <p className="text-ink-muted text-xs">
                  📄 Abandon volontaire du véhicule — gardiennage offert, plus rien à facturer à ce titre.
                </p>
              )}
              {parcOn && !parcWaived && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-ink-muted">Du</span>
                    <input type="date" value={parcFrom} onChange={e => setParcFrom(e.target.value)} className="bg-surface border rounded px-2 py-1 text-ink" />
                    <span className="text-ink-muted">au</span>
                    <input type="date" value={parcTo} onChange={e => setParcTo(e.target.value)} className="bg-surface border rounded px-2 py-1 text-ink" />
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-ink-muted">{parcDays} jour(s) ×</span>
                    <input type="number" step="0.01" value={parcPrice} onChange={e => setParcPrice(Number(e.target.value))} className="w-20 bg-surface border rounded px-1.5 py-1 text-ink text-right" />
                    <span className="text-ink-muted">€/j = <strong className="text-ink">{parcTotal.toFixed(2)} €</strong></span>
                  </div>
                </div>
              )}
            </div>
            )}

            <div className="flex items-center justify-between border-t pt-3 mb-3">
              <span className="text-ink-muted text-sm">Total facture partielle</span>
              <span className="text-ink font-bold">{grandTotal.toFixed(2)} € HTVA · {(grandTotal * 1.21).toFixed(2)} € TVAC</span>
            </div>

            <button onClick={submit} disabled={submitting || grandTotal <= 0}
              className="w-full py-3 bg-brand hover:bg-brand/80 text-white rounded-2xl font-semibold text-sm disabled:opacity-50">
              {submitting ? '⏳ Préparation…' : 'Préparer la facture partielle'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function round(n: number) { return Math.round(n * 100) / 100 }
function fmt(iso: string) { return iso ? new Date(iso).toLocaleDateString('fr-BE') : '' }
