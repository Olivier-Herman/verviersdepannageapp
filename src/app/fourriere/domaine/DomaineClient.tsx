'use client'

import { useState, useEffect, useCallback, Fragment } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'

interface Row {
  id: string; numero: string; vehicle: string; vin: string
  dateIn: string; dateOut: string; sortieReelle: string; prepared: boolean
  days: number; rate: number | null; amount: number
  matched: boolean; outcome: string; flag: 'ok' | 'warn'
  missionId: string | null; missionNumber: number | null; plate: string; zone: string | null
}
interface Group { vente: string; firm: string; rows: Row[]; days: number; amount: number }
const fmt = (ymd: string) => (ymd ? ymd.split('-').reverse().join('/') : '')

export default function DomaineClient({ userRole, userName, userEmail, userModules }: {
  userRole: string; userName: string; userEmail: string; userModules: string[]
}) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [from, setFrom] = useState('')
  const [to,   setTo]   = useState('')
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [total, setTotal] = useState(0)
  const [totalDays, setTotalDays] = useState(0)
  const [counts, setCounts] = useState<{ count: number; matched: number; unmatched: number } | null>(null)
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [completing, setCompleting] = useState(false)
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [invoicing, setInvoicing] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  function quarterBounds(q: number, y: number) {
    const m0 = (q - 1) * 3
    return {
      from: new Date(Date.UTC(y, m0, 1)).toISOString().slice(0, 10),
      to:   new Date(Date.UTC(y, m0 + 3, 0)).toISOString().slice(0, 10),
    }
  }
  function setQuarter(q: number) { const b = quarterBounds(q, year); setFrom(b.from); setTo(b.to) }

  const load = useCallback(async (f = from, t = to) => {
    if (!f || !t) return
    setLoading(true); setMsg(null)
    try {
      const r = await fetch(`/api/fourriere/domaine/ventes-register?from=${f}&to=${t}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) { setMsg(`⚠ ${j.error || 'Erreur'}`); setGroups(null); return }
      setGroups(j.groups); setTotal(j.total); setTotalDays(j.totalDays)
      setCounts({ count: j.count, matched: j.matched, unmatched: j.unmatched })
      setInvoiceNumber(j.invoiceNumber || '')
    } catch { setMsg('⚠ Erreur réseau') } finally { setLoading(false) }
  }, [from, to])

  // Auto-affichage : trimestre courant à l'ouverture, avec synchronisation
  // automatique des mails « Vente d'épaves » à chaque ouverture de la page.
  useEffect(() => {
    const q = Math.floor(now.getMonth() / 3) + 1
    const b = quarterBounds(q, now.getFullYear())
    setFrom(b.from); setTo(b.to)
    syncVentes(b.from, b.to)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function edit(action: string, id: string, value: any) {
    try {
      const r = await fetch('/api/fourriere/domaine/ventes-register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id, value }),
      })
      const j = await r.json()
      if (!r.ok) { setMsg(`⚠ ${j.error || 'Échec'}`); return false }
      if (action === 'set_sortie' && j.facturable) setMsg('✓ Sortie posée → fiche passée « à facturer » (cachet Domaine)')
      if (action === 'toggle_prepare' && j.transferred) setMsg('✓ Préparé → véhicule transféré en zone Domaine (I)')
      load()
      return true
    } catch { setMsg('⚠ Erreur réseau'); return false }
  }

  async function reprint(id: string) {
    setMsg(null)
    try {
      const r = await fetch('/api/fourriere/domaine/ventes-register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reprint', id }),
      })
      const j = await r.json()
      setMsg(r.ok ? (j.queued ? '🖨 Étiquette mise en file d’impression' : '🖨 Étiquette envoyée à l’imprimante') : `⚠ ${j.error || 'Échec impression'}`)
    } catch { setMsg('⚠ Erreur réseau') }
  }

  // Sortie réelle au niveau de la vente → propagée à toutes les lignes.
  async function editVente(venteDate: string, value: string | null) {
    try {
      const r = await fetch('/api/fourriere/domaine/ventes-register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_sortie_vente', venteDate, value }),
      })
      const j = await r.json()
      if (!r.ok) { setMsg(`⚠ ${j.error || 'Échec'}`); return }
      setMsg(value ? `✓ Sortie ${fmt(value)} appliquée à ${j.lines} ligne(s)${j.facturable ? ` · ${j.facturable} → à facturer` : ''}` : '✓ Sortie effacée sur la vente')
      load()
    } catch { setMsg('⚠ Erreur réseau') }
  }

  async function syncVentes(f = from, t = to) {
    setSyncing(true); setMsg('⏳ Synchronisation des mails « Vente d’épaves »…')
    try {
      const r = await fetch('/api/fourriere/domaine', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'sync' }),
      })
      const j = await r.json()
      if (!r.ok) { setMsg(`⚠ ${j.error || 'Erreur synchro'}`); load(f, t); return }
      const s = j.summary || {}
      setMsg(`✓ Synchro : ${s.applied || 0} appliquée(s), ${s.alreadySet || 0} complétée(s), ${s.noMatch || 0} non rapprochée(s), ${s.ambiguous || 0} ambiguë(s).`)
      load(f, t)
    } catch { setMsg('⚠ Erreur réseau'); load(f, t) } finally { setSyncing(false) }
  }

  async function invoiceQuarter() {
    if (!from || !to) { setMsg('⚠ Choisis la période'); return }
    const ref = window.prompt('N° de bon de commande (PO) du SPF Finances — laisser vide si aucun :', '') ?? ''
    if (!window.confirm(`Créer et comptabiliser la facture Domaine pour ${fmt(from)} → ${fmt(to)} (total ${total.toFixed(2)} €) ?\n\nLa facture NE sera PAS envoyée.`)) return
    setInvoicing(true); setMsg(null)
    try {
      const r = await fetch('/api/fourriere/domaine', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'invoice', from, to, ref: ref.trim() || null }),
      })
      const j = await r.json()
      if (!r.ok) { setMsg(`⚠ ${j.error || 'Échec facturation'}`); return }
      setMsg(`✓ Facture ${j.invoiceNumber || '(brouillon)'} créée — ${j.count} véhicule(s), ${(j.total || 0).toFixed(2)} € HTVA. À envoyer depuis Odoo.`)
      if (j.invoiceNumber) setInvoiceNumber(j.invoiceNumber)
    } catch { setMsg('⚠ Erreur réseau') } finally { setInvoicing(false) }
  }

  // Saisir le n° de facture Odoo du trimestre → passe les fiches « à facturer »
  // rapprochées de la période en « terminé » avec ce n°.
  async function completeQuarter() {
    if (!from || !to) { setMsg('⚠ Choisis la période'); return }
    const num = invoiceNumber.trim()
    if (!num) { setMsg('⚠ Saisis le n° de facture Odoo'); return }
    if (!window.confirm(`Passer les fiches « à facturer » du trimestre ${fmt(from)} → ${fmt(to)} en TERMINÉ avec le n° ${num} ?`)) return
    setCompleting(true); setMsg(null)
    try {
      const r = await fetch('/api/fourriere/domaine/ventes-register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete_quarter', from, to, invoiceNumber: num }),
      })
      const j = await r.json()
      if (!r.ok) { setMsg(`⚠ ${j.error || 'Échec'}`); return }
      setMsg(`✓ ${j.completed} fiche(s) passée(s) en Terminé avec le n° ${num}`)
      load()
    } catch { setMsg('⚠ Erreur réseau') } finally { setCompleting(false) }
  }

  return (
    <AppShell title="Domaine — Vente d'épaves" userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules}>
      <main className="p-4 lg:p-6 max-w-7xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Link href="/fourriere" className="text-ink-muted text-sm">← Fourrière</Link>
          <Link href="/fourriere/domaine/dates-in" className="text-sm font-semibold text-indigo-700 dark:text-indigo-300 hover:underline">📅 Dates IN (remises) →</Link>
        </div>
        <div>
          <h1 className="text-ink text-xl font-bold">🏛️ Vente d'épaves — Registre Domaine</h1>
          <p className="text-ink-muted text-sm">Reflet fidèle des tableaux de Rosemarie (toutes les lignes, rapprochées ou non). Gardiennage = Date IN → Date OUT au tarif parc saisie. <span className="text-amber-600 font-semibold">Orange = non rapproché à une fiche VD Soft</span> (mais compté).</p>
        </div>

        <div className="bg-surface border rounded-2xl p-4 space-y-3">
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="block text-ink-muted text-xs mb-1">Année</label>
              <input type="number" value={year} onChange={e => setYear(Number(e.target.value))}
                className="w-24 bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand" />
            </div>
            <div className="flex gap-1">
              {[1, 2, 3, 4].map(q => (
                <button key={q} type="button" onClick={() => setQuarter(q)}
                  className="px-3 py-2 bg-surface-2 border rounded-xl text-ink-secondary text-sm font-semibold hover:border-brand/40">T{q}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-ink-muted text-xs mb-1">Du</label>
                <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                  className="bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand" />
              </div>
              <div>
                <label className="block text-ink-muted text-xs mb-1">Au</label>
                <input type="date" value={to} onChange={e => setTo(e.target.value)}
                  className="bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand" />
              </div>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={() => load()} disabled={loading}
              className="px-4 py-2.5 bg-brand hover:bg-brand-hover text-white rounded-xl text-sm font-semibold disabled:opacity-50">{loading ? '⏳…' : '🔎 Afficher'}</button>
            <button type="button" onClick={() => syncVentes()} disabled={syncing}
              className="px-4 py-2.5 bg-surface-2 border text-ink-secondary rounded-xl text-sm font-semibold hover:border-brand/40 disabled:opacity-50"
              title="Relire les mails « Vente d'épaves »">{syncing ? '⏳…' : '🔄 Synchroniser'}</button>
            <button type="button"
              onClick={() => { if (!from || !to) { setMsg('⚠ Choisis la période'); return } window.location.href = `/api/fourriere/domaine/export?from=${from}&to=${to}` }}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold">⬇️ Export Excel</button>
            {userRole === 'superadmin' && (
              <button type="button" onClick={invoiceQuarter} disabled={invoicing || !groups || groups.length === 0}
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold disabled:opacity-50"
                title="Créer + comptabiliser la facture trimestrielle Odoo">{invoicing ? '⏳…' : '🧾 Facturer ce trimestre'}</button>
            )}
          </div>
          {userRole === 'superadmin' && (
            <div className="flex items-end gap-2 flex-wrap border-t pt-3">
              <div>
                <label className="block text-ink-muted text-xs mb-1">N° facture Odoo du trimestre</label>
                <input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="ex. 2026/07/248"
                  className="w-44 bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm font-mono focus:outline-none focus:border-brand" />
              </div>
              <button type="button" onClick={completeQuarter} disabled={completing || !invoiceNumber.trim() || !groups}
                className="px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-bold disabled:opacity-50"
                title="Passe les fiches « à facturer » rapprochées de ce trimestre en TERMINÉ avec ce n° de facture">
                {completing ? '⏳…' : '✅ Passer les fiches en Terminé'}
              </button>
            </div>
          )}
          {counts && <p className="text-xs text-ink-muted">{counts.count} ligne(s) · <span className="text-emerald-600 font-semibold">{counts.matched} rapprochée(s)</span> · <span className="text-amber-600 font-semibold">{counts.unmatched} non rapprochée(s)</span></p>}
          {msg && <p className="text-sm text-amber-600">{msg}</p>}
        </div>

        {groups && (groups.length === 0 ? (
          <p className="text-ink-muted py-8 text-center">Aucune vente Domaine sur cette période.</p>
        ) : (
          <div className="bg-surface border rounded-2xl overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="text-ink-muted text-[11px] uppercase border-b">
                  <th className="text-left px-2 py-2">Réf</th>
                  <th className="text-left px-2 py-2">Véhicule</th>
                  <th className="text-left px-2 py-2">Châssis</th>
                  <th className="text-left px-2 py-2">Date IN</th>
                  <th className="text-left px-2 py-2">Date OUT</th>
                  <th className="text-right px-2 py-2">Jours</th>
                  <th className="text-right px-2 py-2">Frais</th>
                  <th className="text-left px-2 py-2">Sortie réelle</th>
                  <th className="text-left px-2 py-2">Prépa.</th>
                  <th className="text-left px-2 py-2">Fiche</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(g => (
                  <Fragment key={g.vente}>
                    <tr className="bg-indigo-50/60 border-b">
                      <td colSpan={10} className="px-3 py-1.5 text-indigo-800 text-xs font-bold uppercase tracking-wide">
                        🏷️ Vente d'épaves du {fmt(g.vente)} — {g.rows.length} véhicule{g.rows.length > 1 ? 's' : ''}
                        {g.firm && <span className="normal-case font-semibold"> · Firme : {g.firm}</span>}
                        <span className="normal-case font-medium ml-3 text-indigo-700 dark:text-indigo-300">
                          · Sortie réelle de la vente :{' '}
                          <input type="date" defaultValue={g.rows[0]?.sortieReelle || ''}
                            onBlur={e => { const v = e.target.value; if (v !== (g.rows[0]?.sortieReelle || '')) editVente(g.vente, v || null) }}
                            className="bg-surface-2 border rounded px-1.5 py-0.5 text-ink text-xs" title="Appliquée à toutes les lignes de la vente (éditable par ligne ensuite)" />
                        </span>
                      </td>
                    </tr>
                    {g.rows.map(r => {
                      const rowCls = r.prepared ? 'bg-emerald-500/10' : (r.flag === 'warn' ? 'bg-amber-500/10' : '')
                      return (
                        <tr key={r.id} className={`border-b last:border-0 ${rowCls}`}>
                          <td className="px-2 py-1.5 font-mono font-semibold text-ink">{r.numero || '—'}</td>
                          <td className="px-2 py-1.5 text-ink-secondary">{r.vehicle || '—'}</td>
                          <td className="px-2 py-1.5 text-ink-secondary font-mono text-xs">{r.vin || '—'}</td>
                          <td className="px-2 py-1.5 text-ink-secondary">{fmt(r.dateIn) || <span className="text-amber-600">?</span>}</td>
                          <td className="px-2 py-1.5">
                            <input type="date" defaultValue={r.dateOut || ''}
                              onBlur={e => { const v = e.target.value; if (v !== (r.dateOut || '')) edit('set_date_out', r.id, v || null) }}
                              className="bg-surface-2 border rounded px-1.5 py-0.5 text-ink text-xs w-32" />
                          </td>
                          <td className="px-2 py-1.5 text-right text-ink">{r.days}</td>
                          <td className="px-2 py-1.5 text-right text-ink font-semibold">{r.amount.toFixed(2)} €</td>
                          <td className="px-2 py-1.5">
                            <input type="date" defaultValue={r.sortieReelle || ''}
                              onBlur={e => { const v = e.target.value; if (v !== (r.sortieReelle || '')) edit('set_sortie', r.id, v || null) }}
                              className="bg-surface-2 border rounded px-1.5 py-0.5 text-ink text-xs w-32" title="Sortie physique réelle → fiche à facturer" />
                          </td>
                          <td className="px-2 py-1.5">
                            {r.prepared
                              ? <span className="text-emerald-600 font-bold text-xs">✅ Prêt</span>
                              : <button onClick={() => edit('toggle_prepare', r.id, true)}
                                  className="text-xs px-2 py-1 rounded border bg-surface-2 hover:bg-surface-hover font-semibold">Préparation OK</button>}
                          </td>
                          <td className="px-2 py-1.5 whitespace-nowrap">
                            {r.missionId
                              ? <Link href={`/dispatch/${r.missionId}`} className="text-brand font-semibold hover:underline text-xs">{r.missionNumber ? `#${r.missionNumber}` : 'Voir'}{r.zone ? ` · ${r.zone}` : ''}</Link>
                              : <span className="text-amber-600 text-xs font-semibold" title={r.outcome === 'ambiguous' ? 'VIN ambigu' : 'Absente de VD Soft (TowSoft ?)'}>⚠ non rapproché</span>}
                            <button onClick={() => reprint(r.id)} title="Réimprimer l'étiquette VENDU DOMAINE"
                              className="ml-2 text-xs px-1.5 py-0.5 rounded border bg-surface-2 hover:bg-surface-hover">🖨</button>
                          </td>
                        </tr>
                      )
                    })}
                    <tr className="bg-surface-2 text-sm">
                      <td colSpan={5} className="px-2 py-1.5 text-right text-ink-secondary">Sous-total</td>
                      <td className="px-2 py-1.5 text-right font-semibold">{g.days}</td>
                      <td className="px-2 py-1.5 text-right font-semibold">{g.amount.toFixed(2)} €</td>
                      <td colSpan={3} />
                    </tr>
                  </Fragment>
                ))}
                <tr className="bg-indigo-100 font-bold">
                  <td className="px-2 py-2" colSpan={5}>TOTAL</td>
                  <td className="px-2 py-2 text-right">{totalDays}</td>
                  <td className="px-2 py-2 text-right">{total.toFixed(2)} €</td>
                  <td colSpan={3} />
                </tr>
              </tbody>
            </table>
          </div>
        ))}
      </main>
    </AppShell>
  )
}
