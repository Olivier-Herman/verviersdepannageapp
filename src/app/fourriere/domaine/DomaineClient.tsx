'use client'

import { useState, Fragment } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'

interface Row {
  mission_number: number | null; plate: string; vehicle: string; vin: string; dossier: string
  remise: string; enlevement: string; vente: string; firm: string; days: number; rate: number | null; amount: number
}
interface Group { vente: string; rows: Row[]; days: number; amount: number }
const fmt = (ymd: string) => ymd ? ymd.split('-').reverse().join('/') : ''

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
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [invoicing, setInvoicing] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  function setQuarter(q: number) {
    const m0 = (q - 1) * 3
    const start = new Date(Date.UTC(year, m0, 1))
    const end   = new Date(Date.UTC(year, m0 + 3, 0))   // dernier jour du trimestre
    setFrom(start.toISOString().slice(0, 10))
    setTo(end.toISOString().slice(0, 10))
  }

  async function load() {
    if (!from || !to) { setMsg('⚠ Choisis la période'); return }
    setLoading(true); setMsg(null)
    try {
      const r = await fetch(`/api/fourriere/domaine?from=${from}&to=${to}`)
      const j = await r.json()
      if (!r.ok) { setMsg(`⚠ ${j.error || 'Erreur'}`); setGroups(null); return }
      setGroups(j.groups); setTotal(j.total); setTotalDays(j.totalDays)
    } catch { setMsg('⚠ Erreur réseau') } finally { setLoading(false) }
  }

  async function syncVentes() {
    setSyncing(true); setMsg(null)
    try {
      const r = await fetch('/api/fourriere/domaine', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync' }),
      })
      const j = await r.json()
      if (!r.ok) { setMsg(`⚠ ${j.error || 'Erreur synchro'}`); return }
      const s = j.summary || {}
      setMsg(`✓ Synchro : ${s.applied || 0} vente(s) appliquée(s), ${s.alreadySet || 0} déjà posée(s), ${s.noMatch || 0} sans correspondance, ${s.ambiguous || 0} ambiguë(s).`)
      if (from && to) load()
    } catch { setMsg('⚠ Erreur réseau') } finally { setSyncing(false) }
  }

  async function invoiceQuarter() {
    if (!from || !to) { setMsg('⚠ Choisis la période'); return }
    const ref = window.prompt('N° de bon de commande (PO) du SPF Finances — laisser vide si aucun :', '') ?? ''
    if (!window.confirm(`Créer et comptabiliser la facture Domaine pour ${fmt(from)} → ${fmt(to)} (total ${total.toFixed(2)} €) ?\n\nLa facture NE sera PAS envoyée — tu l'enverras depuis Odoo.`)) return
    setInvoicing(true); setMsg(null)
    try {
      const r = await fetch('/api/fourriere/domaine', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'invoice', from, to, ref: ref.trim() || null }),
      })
      const j = await r.json()
      if (!r.ok) { setMsg(`⚠ ${j.error || 'Échec facturation'}`); return }
      setMsg(`✓ Facture ${j.invoiceNumber || '(brouillon)'} créée et comptabilisée — ${j.count} véhicule(s), ${(j.total || 0).toFixed(2)} € HTVA. Tableau attaché. À envoyer depuis Odoo.`)
    } catch { setMsg('⚠ Erreur réseau') } finally { setInvoicing(false) }
  }

  return (
    <AppShell title="Domaine — Gardiennage État" userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules}>
      <main className="p-4 lg:p-8 max-w-4xl mx-auto space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Link href="/fourriere" className="text-ink-muted text-sm">← Fourrière</Link>
          <Link href="/fourriere/domaine/dates-in" className="text-sm font-semibold text-indigo-700 dark:text-indigo-300 hover:underline">📅 Dates IN (remises) →</Link>
        </div>
        <div>
          <h1 className="text-ink text-xl font-bold">🏛️ Gardiennage Domaine (État)</h1>
          <p className="text-ink-muted text-sm">Jours de gardiennage des véhicules remis au Domaine (remise → vente), au tarif parc saisie. Tableau + export Excel trimestriel.</p>
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
                  className="px-3 py-2 bg-surface-2 border rounded-xl text-ink-secondary text-sm font-semibold hover:border-brand/40">
                  T{q}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 max-w-md">
            <div>
              <label className="block text-ink-muted text-xs mb-1">Du</label>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand" />
            </div>
            <div>
              <label className="block text-ink-muted text-xs mb-1">Au</label>
              <input type="date" value={to} onChange={e => setTo(e.target.value)}
                className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand" />
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={load} disabled={loading}
              className="px-4 py-2.5 bg-brand hover:bg-brand-hover text-white rounded-xl text-sm font-semibold disabled:opacity-50">
              {loading ? '⏳…' : '🔎 Afficher'}
            </button>
            <button type="button" onClick={syncVentes} disabled={syncing}
              className="px-4 py-2.5 bg-surface-2 border text-ink-secondary rounded-xl text-sm font-semibold hover:border-brand/40 disabled:opacity-50"
              title="Relire les mails « Vente d'épaves » et poser vente/firme/Date OUT sur les fiches">
              {syncing ? '⏳…' : '🔄 Synchroniser ventes d’épaves'}
            </button>
            <button type="button"
              onClick={() => { if (!from || !to) { setMsg('⚠ Choisis la période'); return } window.location.href = `/api/fourriere/domaine/export?from=${from}&to=${to}` }}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold">
              ⬇️ Export Excel
            </button>
            {userRole === 'superadmin' && (
              <button type="button" onClick={invoiceQuarter} disabled={invoicing || !groups || groups.length === 0}
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold disabled:opacity-50"
                title="Créer + comptabiliser la facture trimestrielle Odoo (sans envoi) et y attacher le tableau">
                {invoicing ? '⏳…' : '🧾 Facturer ce trimestre (Odoo)'}
              </button>
            )}
          </div>
          {msg && <p className="text-sm text-amber-600">{msg}</p>}
        </div>

        {groups && (
          groups.length === 0 ? (
            <p className="text-ink-muted py-8 text-center">Aucune vente Domaine sur cette période.</p>
          ) : (
            <div className="bg-surface border rounded-2xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-ink-muted text-xs uppercase border-b">
                    <th className="text-left px-3 py-2">N° Véhicule</th>
                    <th className="text-left px-3 py-2">Marque</th>
                    <th className="text-left px-3 py-2">Châssis n°</th>
                    <th className="text-left px-3 py-2">Date IN</th>
                    <th className="text-left px-3 py-2">Date OUT</th>
                    <th className="text-right px-3 py-2">Jours</th>
                    <th className="text-right px-3 py-2">Frais H.TVA</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map(g => (
                    <Fragment key={g.vente}>
                      <tr className="bg-indigo-50/60 border-b">
                        <td colSpan={7} className="px-3 py-1.5 text-indigo-800 text-xs font-bold uppercase tracking-wide">
                          🏷️ Vente d'épaves du {fmt(g.vente)} — {g.rows.length} véhicule{g.rows.length > 1 ? 's' : ''}
                          {g.rows[0]?.firm && <span className="normal-case font-semibold"> · Firme : {g.rows[0].firm}</span>}
                        </td>
                      </tr>
                      {g.rows.map((r, i) => (
                        <tr key={g.vente + i} className="border-b last:border-0">
                          <td className="px-3 py-2 font-mono text-ink">{r.plate || (r.mission_number != null ? `#${r.mission_number}` : '—')}</td>
                          <td className="px-3 py-2 text-ink-secondary">{r.vehicle || '—'}</td>
                          <td className="px-3 py-2 text-ink-secondary font-mono text-xs">{r.vin || '—'}</td>
                          <td className="px-3 py-2 text-ink-secondary">{fmt(r.remise)}</td>
                          <td className="px-3 py-2 text-ink-secondary">{r.enlevement ? fmt(r.enlevement) : <span className="text-amber-600">à compléter</span>}</td>
                          <td className="px-3 py-2 text-right text-ink">{r.days}</td>
                          <td className="px-3 py-2 text-right text-ink font-semibold">{r.amount.toFixed(2)} €</td>
                        </tr>
                      ))}
                      <tr className="bg-surface-2 text-sm">
                        <td colSpan={5} className="px-3 py-1.5 text-right text-ink-secondary">Sous-total</td>
                        <td className="px-3 py-1.5 text-right font-semibold">{g.days}</td>
                        <td className="px-3 py-1.5 text-right font-semibold">{g.amount.toFixed(2)} €</td>
                      </tr>
                    </Fragment>
                  ))}
                  <tr className="bg-indigo-100 font-bold">
                    <td className="px-3 py-2" colSpan={5}>TOTAL</td>
                    <td className="px-3 py-2 text-right">{totalDays}</td>
                    <td className="px-3 py-2 text-right">{total.toFixed(2)} €</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )
        )}
      </main>
    </AppShell>
  )
}
