'use client'
// src/app/fourriere/migration/archive/ArchiveClient.tsx
//
// Olivier 2026-06-04 : liste read-only des fiches TowSoft NON scannees =
// vehicules sortis avant la migration. Sert d'archive consultable et permet
// d activer plus tard "Importer les photos" pour ces fiches si besoin.
//
// Pas d action destructive depuis cette page : on consulte / on filtre.

import { useState, useEffect } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { ArrowLeft, RefreshCw, Loader2, Archive, Search, Image as ImageIcon } from 'lucide-react'

interface Row {
  id:                 string
  towsoft_num:        string
  plate:              string | null
  vin:                string | null
  brand:              string | null
  model:              string | null
  motif:              string | null
  date_entree:        string | null
  parc_towsoft:       string | null
  client_name:        string | null
  appel_type:         string | null
  detail_fetched_at:  string | null
}

interface Props {
  userRole:    string
  userName:    string
  userEmail?:  string | null
  userModules: string[]
}

export default function ArchiveClient({ userRole, userName, userEmail, userModules }: Props) {
  const [rows, setRows]       = useState<Row[]>([])
  const [total, setTotal]     = useState(0)
  const [motifs, setMotifs]   = useState<string[]>([])
  const [q, setQ]             = useState('')
  const [motif, setMotif]     = useState('')
  const [loading, setLoading] = useState(true)
  const [photosLoading, setPhotosLoading] = useState(false)
  const limit = 200

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: '0' })
      if (q.trim())     params.set('q', q.trim())
      if (motif.trim()) params.set('motif', motif.trim())
      const r = await fetch(`/api/admin/towsoft-migration/archive?${params}`)
      const j = await r.json()
      if (r.ok) {
        setRows(j.rows || [])
        setTotal(j.total || 0)
        setMotifs(j.motifs || [])
      }
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() /* eslint-disable-next-line */ }, [])

  async function importPhotos() {
    if (!confirm(`Activer "Importer les photos" pour ces ${total} fiches d archive ?\n\nLes photos seront scrapees en arriere-plan via un cron dedie (peut prendre quelques heures). Operation idempotente.\n\nNB : non encore implementee, ce bouton activera juste le flag dans app_settings.`)) return
    setPhotosLoading(true)
    try {
      const r = await fetch('/api/admin/towsoft-migration/import-photos', { method: 'POST' })
      const j = await r.json()
      if (!r.ok) { alert(`Erreur : ${j.error || 'inconnue'}`); return }
      alert(j.message || '✓ Flag active. Les photos seront importees en arriere-plan.')
    } catch (e: any) {
      alert(`Erreur reseau : ${e?.message || e}`)
    } finally {
      setPhotosLoading(false)
    }
  }

  return (
    <AppShell title="Archive non-scannes" userRole={userRole} userName={userName} userEmail={userEmail || undefined} userModules={userModules}>
      <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-4">

        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/fourriere/migration"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-2 hover:bg-surface-hover border rounded-lg text-ink-secondary hover:text-ink text-xs font-medium transition">
            <ArrowLeft size={13} /> Migration
          </Link>
          <h1 className="font-display text-xl font-bold text-ink flex-1 flex items-center gap-2">
            <Archive size={20} className="text-ink-muted" />
            Archive TowSoft non-scannes ({total})
          </h1>
          <button onClick={importPhotos} disabled={photosLoading || total === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-info-50 hover:bg-info-100 border border-info-200 rounded-lg text-info-800 text-xs font-semibold transition disabled:opacity-50">
            <ImageIcon size={13} />
            {photosLoading ? 'Activation...' : 'Importer les photos (differe)'}
          </button>
          <button onClick={load} disabled={loading}
            className="p-2 bg-surface-2 hover:bg-surface-hover border rounded-lg text-ink-secondary hover:text-ink transition disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="bg-surface-2 border rounded-2xl p-4 text-sm text-ink-secondary">
          <p className="font-semibold text-ink mb-1">Lecture seule</p>
          <p>Ce sont les fiches TowSoft qui <b>n ont pas ete scannees</b> en migration.
          Hypothese : ces vehicules sont sortis avant la migration. Pour les retrouver, utilise
          la recherche par plaque ci-dessous. Aucune mission VD Soft n est creee depuis cette
          page (on consulte uniquement).</p>
        </div>

        <div className="bg-surface border rounded-2xl p-4 space-y-3">
          <div className="flex gap-3 flex-wrap">
            <div className="flex-1 min-w-[240px] relative">
              <Search size={14} className="absolute left-3 top-3 text-ink-muted" />
              <input
                value={q}
                onChange={e => setQ(e.target.value.toUpperCase())}
                onKeyDown={e => { if (e.key === 'Enter') load() }}
                placeholder="Plaque / VIN / n° TowSoft / client..."
                className="w-full pl-9 pr-3 py-2 bg-surface-2 border rounded-lg text-sm focus:outline-none focus:border-brand placeholder:text-ink-faint"
              />
            </div>
            <select
              value={motif}
              onChange={e => setMotif(e.target.value)}
              className="px-3 py-2 bg-surface-2 border rounded-lg text-sm focus:outline-none focus:border-brand">
              <option value="">Tous motifs</option>
              {motifs.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <button onClick={load} disabled={loading}
              className="px-4 py-2 bg-brand hover:bg-brand-hover text-white rounded-lg text-sm font-semibold disabled:opacity-50">
              {loading ? 'Recherche...' : 'Filtrer'}
            </button>
          </div>

          {loading ? (
            <div className="text-center text-ink-muted py-8">
              <Loader2 className="inline animate-spin mr-2" size={14} /> Chargement…
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center text-ink-muted py-8">
              Aucune fiche correspondante.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-xs text-ink-muted uppercase tracking-wide">
                  <tr className="border-b">
                    <th className="text-left py-2 px-2">N°</th>
                    <th className="text-left py-2 px-2">Plaque</th>
                    <th className="text-left py-2 px-2">Vehicule</th>
                    <th className="text-left py-2 px-2">Motif</th>
                    <th className="text-left py-2 px-2">Client</th>
                    <th className="text-left py-2 px-2">Entree</th>
                    <th className="text-left py-2 px-2">Parc TS</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id} className="border-b hover:bg-surface-2 transition">
                      <td className="py-2 px-2 font-mono text-ink-muted">{r.towsoft_num}</td>
                      <td className="py-2 px-2 font-mono font-bold">{r.plate || '—'}</td>
                      <td className="py-2 px-2 text-ink-secondary">{[r.brand, r.model].filter(Boolean).join(' ') || '—'}</td>
                      <td className="py-2 px-2 text-xs">{r.motif || '—'}</td>
                      <td className="py-2 px-2 text-xs text-ink-secondary">{r.client_name || '—'}</td>
                      <td className="py-2 px-2 text-xs text-ink-muted">{r.date_entree ? new Date(r.date_entree).toLocaleDateString('fr-BE') : '—'}</td>
                      <td className="py-2 px-2 text-xs text-ink-muted">{r.parc_towsoft || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {total > rows.length && (
                <div className="text-xs text-ink-muted text-center mt-3">
                  Affiche {rows.length} sur {total}. Affine la recherche pour voir plus.
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </AppShell>
  )
}
