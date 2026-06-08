'use client'

import { useEffect, useState, useCallback } from 'react'
import { Plus, RefreshCw, Trash2, ExternalLink, Check, X, Loader2, CalendarDays, Users, MapPin, Pencil } from 'lucide-react'

interface Prestation {
  id:                   string
  client_name:          string
  client_odoo_id:       number | null
  type:                 'incentive' | 'after_six'
  prestation_date:      string
  nb_depanneuses:       number
  odoo_sale_order_id:   number | null
  odoo_sale_order_name: string | null
  notes:                string | null
  invoiced_at:          string | null
  created_at:           string
}

const TYPE_LABELS: Record<string, string> = {
  incentive: 'Incentive (8h-18h)',
  after_six: 'After-Six (18h-20h)',
}

const TYPE_COLORS: Record<string, string> = {
  incentive: 'bg-blue-100 text-blue-800 border-blue-200',
  after_six: 'bg-purple-100 text-purple-800 border-purple-200',
}

type Period = 'upcoming' | 'current' | 'past' | 'all'

const ODOO_BASE = 'https://verviers-depannage.odoo.com/web#id={ID}&model=sale.order&view_type=form'
const odooUrl = (id: number) => ODOO_BASE.replace('{ID}', String(id))

export default function CircuitClient() {
  const [period, setPeriod]     = useState<Period>('upcoming')
  const [list, setList]         = useState<Prestation[]>([])
  const [loading, setLoading]   = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy]         = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/circuit-prestations?period=${period}`, { cache: 'no-store' })
      const j = await r.json()
      setList(j.prestations || [])
    } catch (e: any) {
      console.warn('[CircuitClient] load KO:', e?.message)
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => { load() }, [load])

  const removeOne = async (id: string) => {
    if (!confirm('Supprimer cette prestation ? (Le devis Odoo sera annulé si plus aucune autre date n\'y est rattachée.)')) return
    setBusy(id)
    try {
      const r = await fetch(`/api/circuit-prestations/${id}`, { method: 'DELETE' })
      const j = await r.json()
      if (!r.ok) { alert(`Erreur : ${j.error}`); return }
      await load()
    } catch (e: any) {
      alert(`Erreur réseau : ${e?.message}`)
    } finally {
      setBusy(null)
    }
  }

  const toggleInvoiced = async (id: string, currentlyInvoiced: boolean) => {
    setBusy(id)
    try {
      const r = await fetch(`/api/circuit-prestations/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: currentlyInvoiced ? 'unmark_invoiced' : 'mark_invoiced' }),
      })
      const j = await r.json()
      if (!r.ok) { alert(`Erreur : ${j.error}`); return }
      await load()
    } catch (e: any) {
      alert(`Erreur réseau : ${e?.message}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-brand/10 text-brand flex items-center justify-center text-2xl flex-shrink-0">
            🏁
          </div>
          <div>
            <h1 className="text-2xl font-bold text-ink">Prestations Circuit</h1>
            <p className="text-sm text-ink-secondary">Spa-Francorchamps · Incentive & After-Six</p>
          </div>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2.5 bg-brand hover:bg-brand-hover text-white rounded-lg font-semibold inline-flex items-center gap-2"
        >
          <Plus size={16} /> Ajouter une prestation
        </button>
      </div>

      {/* Onglets de filtre */}
      <div className="flex items-center gap-2 flex-wrap border-b border-default pb-2">
        {(['upcoming', 'current', 'past', 'all'] as Period[]).map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
              period === p
                ? 'bg-brand text-white'
                : 'text-ink-secondary hover:text-ink hover:bg-surface-hover'
            }`}
          >
            {p === 'upcoming' ? 'À venir'
              : p === 'current' ? 'Aujourd\'hui'
              : p === 'past' ? 'Passées'
              : 'Toutes'}
          </button>
        ))}
        <div className="flex-1" />
        <button onClick={load} className="p-1.5 rounded-md hover:bg-surface-hover" title="Recharger">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Liste */}
      {loading ? (
        <div className="bg-surface border rounded-2xl p-10 text-center text-ink-muted">
          <Loader2 className="inline animate-spin mr-2" size={14} /> Chargement…
        </div>
      ) : list.length === 0 ? (
        <div className="bg-surface border rounded-2xl p-10 text-center">
          <p className="text-ink-muted text-sm">Aucune prestation dans cette catégorie.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {list.map(p => {
            const isPast    = p.prestation_date < new Date().toISOString().slice(0, 10)
            const isInvoiced = !!p.invoiced_at
            return (
              <div key={p.id}
                className={`bg-surface border rounded-xl p-4 flex items-start gap-4 ${isInvoiced ? 'opacity-60' : ''}`}>
                {/* Date badge */}
                <div className="text-center flex-shrink-0 w-16">
                  <div className="text-xs text-ink-muted uppercase">
                    {formatMonth(p.prestation_date)}
                  </div>
                  <div className="text-2xl font-bold text-ink">
                    {formatDay(p.prestation_date)}
                  </div>
                  <div className="text-xs text-ink-muted">
                    {formatYear(p.prestation_date)}
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <strong className="text-ink font-semibold">{p.client_name}</strong>
                    <span className={`px-2 py-0.5 text-xs rounded-md border ${TYPE_COLORS[p.type]}`}>
                      {TYPE_LABELS[p.type]}
                    </span>
                    {p.type === 'incentive' && p.nb_depanneuses > 1 && (
                      <span className="inline-flex items-center gap-1 text-xs text-ink-secondary">
                        <Users size={11} /> {p.nb_depanneuses} dépanneuses
                      </span>
                    )}
                  </div>
                  {p.notes && (
                    <p className="text-xs text-ink-muted mt-1">{p.notes}</p>
                  )}
                  <div className="flex items-center gap-3 mt-2 flex-wrap text-xs">
                    {p.odoo_sale_order_name && p.odoo_sale_order_id && (
                      <a
                        href={odooUrl(p.odoo_sale_order_id)}
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded border border-purple-200 font-medium"
                      >
                        <ExternalLink size={11} /> Devis {p.odoo_sale_order_name}
                      </a>
                    )}
                    {isInvoiced && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-success-soft text-success rounded border border-success/30 font-medium">
                        <Check size={11} /> Facturée le {new Date(p.invoiced_at!).toLocaleDateString('fr-BE')}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-1 items-end flex-shrink-0">
                  {isPast && (
                    <button
                      onClick={() => toggleInvoiced(p.id, isInvoiced)}
                      disabled={busy === p.id}
                      className={`px-2 py-1 rounded text-xs font-medium border inline-flex items-center gap-1 disabled:opacity-50 ${
                        isInvoiced
                          ? 'bg-surface-2 border text-ink-secondary hover:bg-surface-hover'
                          : 'bg-success-soft border-success/40 text-success hover:bg-success/20'
                      }`}
                      title={isInvoiced ? 'Démarquer comme facturée' : 'Marquer comme facturée'}
                    >
                      {isInvoiced ? <X size={11} /> : <Check size={11} />}
                      {isInvoiced ? 'Démarquer' : 'Facturée'}
                    </button>
                  )}
                  {!isInvoiced && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => { setEditingId(p.id); setShowModal(true) }}
                        disabled={busy === p.id}
                        className="p-1.5 rounded text-info hover:bg-info-soft disabled:opacity-50"
                        title="Modifier ce dossier"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => removeOne(p.id)}
                        disabled={busy === p.id}
                        className="p-1.5 rounded text-red-700 hover:bg-red-50 disabled:opacity-50"
                        title="Supprimer cette prestation"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showModal && (
        <AddPrestationModal
          editingId={editingId}
          onClose={() => { setShowModal(false); setEditingId(null) }}
          onCreated={() => { setShowModal(false); setEditingId(null); load() }}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Modal ajout prestation
// ─────────────────────────────────────────────────────────────────
function AddPrestationModal({ editingId, onClose, onCreated }: { editingId: string | null; onClose: () => void; onCreated: () => void }) {
  const [type, setType]                 = useState<'incentive' | 'after_six'>('incentive')
  const [nbDep, setNbDep]               = useState<number>(1)
  const [dates, setDates]               = useState<string[]>([''])
  const [notes, setNotes]               = useState('')
  const [busy, setBusy]                 = useState(false)
  const [loadingEdit, setLoadingEdit]   = useState(false)

  // Client search
  const [clientQuery, setClientQuery]   = useState('')
  const [results, setResults]           = useState<any[]>([])
  const [searching, setSearching]       = useState(false)
  const [selected, setSelected]         = useState<{ id: number; name: string } | null>(null)

  // Mode edition : charge le groupe (toutes les lignes du meme devis Odoo)
  useEffect(() => {
    if (!editingId) return
    setLoadingEdit(true)
    fetch(`/api/circuit-prestations/${editingId}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => {
        if (!Array.isArray(j.group) || j.group.length === 0) return
        const first = j.group[0]
        setSelected({ id: first.client_odoo_id, name: first.client_name })
        setType(first.type)
        setNbDep(first.nb_depanneuses || 1)
        setDates(j.group.map((g: any) => g.prestation_date))
        setNotes(first.notes || '')
      })
      .catch(e => console.warn('[edit prestation] charge KO:', e))
      .finally(() => setLoadingEdit(false))
  }, [editingId])

  // debounce client search
  useEffect(() => {
    if (selected) return
    if (clientQuery.trim().length < 3) { setResults([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const r = await fetch(`/api/odoo/search-client?q=${encodeURIComponent(clientQuery.trim())}`, { cache: 'no-store' })
        const j = await r.json()
        setResults(j.clients || [])
      } catch {} finally {
        setSearching(false)
      }
    }, 350)
    return () => clearTimeout(t)
  }, [clientQuery, selected])

  const setDate = (idx: number, value: string) => {
    setDates(prev => prev.map((d, i) => i === idx ? value : d))
  }
  const addDate = () => setDates(prev => [...prev, ''])
  const removeDate = (idx: number) => setDates(prev => prev.filter((_, i) => i !== idx))

  const submit = async () => {
    if (!selected) { alert('Sélectionne un client'); return }
    const validDates = dates.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    if (validDates.length === 0) { alert('Au moins 1 date requise'); return }

    const isEdit = !!editingId
    const url    = isEdit ? `/api/circuit-prestations/${editingId}` : '/api/circuit-prestations'
    const method = isEdit ? 'PUT' : 'POST'

    setBusy(true)
    try {
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name:    selected.name,
          client_odoo_id: selected.id,
          type,
          dates:          validDates,
          nb_depanneuses: type === 'after_six' ? 1 : nbDep,
          notes:          notes.trim() || undefined,
        }),
      })
      const j = await r.json()
      if (!r.ok) { alert(`Erreur : ${j.error || 'inconnue'}`); return }
      alert(j.message || (isEdit ? 'Dossier modifié' : 'Prestation créée'))
      onCreated()
    } catch (e: any) {
      alert(`Erreur réseau : ${e?.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <span className="text-2xl">🏁</span>
          <h2 className="text-lg font-bold text-ink">
            {editingId ? 'Modifier le dossier Circuit' : 'Nouvelle prestation Circuit'}
          </h2>
          {loadingEdit && <Loader2 size={14} className="animate-spin text-ink-muted" />}
        </div>
        {editingId && (
          <div className="bg-warning-soft border border-warning/30 rounded-lg p-2 mb-4 text-xs text-warning">
            ⚠️ La modification annule l'ancien devis Odoo et en crée un nouveau.
          </div>
        )}

        {/* Client */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-ink-secondary uppercase mb-1">Client</label>
          {selected ? (
            <div className="flex items-center justify-between bg-success-soft border border-success/30 rounded-lg p-3">
              <div>
                <p className="font-medium text-ink">{selected.name}</p>
                <p className="text-xs text-ink-muted">Odoo ID : {selected.id}</p>
              </div>
              <button onClick={() => { setSelected(null); setClientQuery('') }} className="text-xs text-ink-secondary hover:text-ink">
                Changer
              </button>
            </div>
          ) : (
            <>
              <input
                type="text"
                value={clientQuery}
                onChange={e => setClientQuery(e.target.value)}
                placeholder="Tape au moins 3 caractères du nom du client Odoo..."
                className="w-full px-3 py-2 border rounded-lg bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-brand"
              />
              {searching && <p className="text-xs text-ink-muted mt-1"><Loader2 size={11} className="inline animate-spin mr-1" /> Recherche...</p>}
              {results.length > 0 && (
                <div className="mt-2 border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                  {results.map(c => (
                    <button
                      key={c.id}
                      onClick={() => setSelected({ id: c.id, name: c.name })}
                      className="w-full text-left px-3 py-2 hover:bg-surface-hover border-b last:border-b-0 text-sm"
                    >
                      <strong>{c.name}</strong>
                      {(c.city || c.zip) && <span className="text-ink-muted ml-2">{[c.zip, c.city].filter(Boolean).join(' ')}</span>}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Type */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-ink-secondary uppercase mb-2">Type de prestation</label>
          <div className="grid grid-cols-2 gap-2">
            {(['incentive', 'after_six'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`p-3 rounded-lg border-2 text-sm font-medium transition ${
                  type === t
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-default hover:border-brand/40'
                }`}
              >
                <div className="font-bold">{t === 'incentive' ? 'Incentive' : 'After-Six'}</div>
                <div className="text-xs text-ink-muted mt-0.5">
                  {t === 'incentive' ? '8h - 18h' : '18h - 20h'}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Nb dépanneuses (Incentive uniquement) */}
        {type === 'incentive' && (
          <div className="mb-4">
            <label className="block text-xs font-semibold text-ink-secondary uppercase mb-2">
              Nombre de dépanneuses
            </label>
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5, 6].map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setNbDep(n)}
                  className={`w-10 h-10 rounded-lg border font-bold transition ${
                    nbDep === n
                      ? 'bg-brand text-white border-brand'
                      : 'border-default hover:border-brand/40 text-ink'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Dates */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-ink-secondary uppercase mb-2">
            Date(s) de prestation
          </label>
          <div className="space-y-2">
            {dates.map((d, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="date"
                  value={d}
                  onChange={e => setDate(idx, e.target.value)}
                  className="flex-1 px-3 py-2 border rounded-lg bg-surface text-ink"
                />
                {dates.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeDate(idx)}
                    className="p-2 text-red-700 hover:bg-red-50 rounded-lg"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={addDate}
              className="text-sm text-brand hover:underline inline-flex items-center gap-1"
            >
              <Plus size={12} /> Ajouter une autre date
            </button>
          </div>
        </div>

        {/* Notes */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-ink-secondary uppercase mb-1">Notes (optionnel)</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            placeholder="Info complémentaire ajoutée au devis Odoo..."
            className="w-full px-3 py-2 border rounded-lg bg-surface text-ink resize-none"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 py-2 bg-surface-2 border text-ink-secondary rounded-lg text-sm font-medium disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !selected || loadingEdit}
            className="flex-1 py-2 bg-brand hover:bg-brand-hover text-white rounded-lg text-sm font-bold disabled:opacity-50"
          >
            {busy
              ? (editingId ? '⏳ Mise à jour…' : '⏳ Création…')
              : (editingId ? '✓ Modifier le dossier' : '✓ Créer + devis Odoo')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ───── helpers date format ─────
function formatDay(iso: string): string {
  const [, , d] = iso.split('-')
  return d
}
function formatMonth(iso: string): string {
  const months = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc']
  const m = parseInt(iso.split('-')[1], 10)
  return months[m - 1] || ''
}
function formatYear(iso: string): string {
  return iso.split('-')[0]
}
