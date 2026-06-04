'use client'
// src/app/fourriere/migration/orphans/OrphansClient.tsx
//
// Olivier 2026-06-04 : liste consultable des "fantomes inverses".
// Permet a un operateur fourriere d investiguer manuellement :
//   - Verifier Odoo helpdesk (vehicule deja la mais sans fiche TowSoft)
//   - Creer fiche depuis PoliceClient si vraiment nouveau
//   - Marquer "ignore" si erreur de scan
//
// On affiche unresolved par defaut, toggle pour voir l historique resolus.

import { useState, useEffect } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { ArrowLeft, RefreshCw, Loader2, Ghost, Check, Eye, EyeOff, RotateCw } from 'lucide-react'

interface Orphan {
  id:                  string
  raw_input:           string
  parsed_format:       string | null
  plate:               string | null
  vin:                 string | null
  zone:                string
  scanned_by:          string | null
  scanned_at:          string
  resolved_at:         string | null
  resolved_action:     string | null
  resolved_mission_id: string | null
  resolution_notes:    string | null
}

interface Props {
  userRole:    string
  userName:    string
  userEmail?:  string | null
  userModules: string[]
}

const ACTIONS = [
  { value: 'created_in_vdsoft', label: 'Cree dans VD Soft' },
  { value: 'found_in_odoo',     label: 'Trouve dans Odoo' },
  { value: 'ignored',           label: 'Erreur scan / ignore' },
]

export default function OrphansClient({ userRole, userName, userEmail, userModules }: Props) {
  const [orphans, setOrphans]   = useState<Orphan[]>([])
  const [counts, setCounts]     = useState<{ unresolved: number; resolved: number }>({ unresolved: 0, resolved: 0 })
  const [showResolved, setShow] = useState(false)
  const [loading, setLoading]   = useState(true)
  const [resolving, setResolv]  = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const r = await fetch(`/api/admin/towsoft-migration/orphans?resolved=${showResolved ? 1 : 0}`)
      const j = await r.json()
      if (r.ok) {
        setOrphans(j.orphans || [])
        setCounts(j.counts || { unresolved: 0, resolved: 0 })
      }
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() /* eslint-disable-next-line */ }, [showResolved])

  async function retry(orphan: Orphan) {
    setResolv(orphan.id)
    try {
      const r = await fetch('/api/admin/towsoft-migration/orphans/retry', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id: orphan.id }),
      })
      const j = await r.json()
      if (j.ok) {
        alert(j.message || '✓ Lié avec succès')
        load()
      } else {
        alert(j.message || '⚠ Pas de match VD Soft ni TowSoft. Résolution manuelle nécessaire.')
      }
    } catch (e: any) {
      alert(`Erreur réseau : ${e?.message || e}`)
    } finally {
      setResolv(null)
    }
  }

  async function retryAll() {
    if (!confirm(`Re-tenter automatiquement les ${orphans.length} fantômes ?\n\nPour chacun, on cherche d abord dans TowSoft puis dans incoming_missions par plaque/VIN. Les matches sont liés automatiquement à leur zone, les autres restent fantômes.`)) return
    setResolv('all')
    let linked = 0
    let stillOrphan = 0
    for (const o of orphans) {
      try {
        const r = await fetch('/api/admin/towsoft-migration/orphans/retry', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ id: o.id }),
        })
        const j = await r.json()
        if (j.ok) linked++; else stillOrphan++
      } catch { stillOrphan++ }
    }
    alert(`✓ Re-tentative terminée : ${linked} liés, ${stillOrphan} restent fantômes`)
    setResolv(null)
    load()
  }

  async function resolve(orphan: Orphan, action: string) {
    const notes = prompt(`Notes pour cette resolution ? (optionnel)\n\nScan : ${orphan.raw_input} (zone ${orphan.zone})`)
    if (notes === null) return  // cancel
    setResolv(orphan.id)
    try {
      const r = await fetch('/api/admin/towsoft-migration/orphans', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: orphan.id, action, notes }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        alert(`Erreur : ${j.error || r.status}`)
        return
      }
      load()
    } catch (e: any) {
      alert(`Erreur reseau : ${e?.message || e}`)
    } finally {
      setResolv(null)
    }
  }

  return (
    <AppShell title="Fantomes inverses" userRole={userRole} userName={userName} userEmail={userEmail || undefined} userModules={userModules}>
      <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-4">

        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/fourriere/migration"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-2 hover:bg-surface-hover border rounded-lg text-ink-secondary hover:text-ink text-xs font-medium transition">
            <ArrowLeft size={13} /> Migration
          </Link>
          <h1 className="font-display text-xl font-bold text-ink flex-1 flex items-center gap-2">
            <Ghost size={20} className="text-warning-700" />
            Fantomes inverses
          </h1>
          <button onClick={load} disabled={loading}
            className="p-2 bg-surface-2 hover:bg-surface-hover border rounded-lg text-ink-secondary hover:text-ink transition disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="bg-warning-50 border border-warning-200 rounded-2xl p-4 text-sm text-warning-800">
          <p className="font-semibold mb-1">Qu est-ce qu un fantome inverse ?</p>
          <p>Vehicule scanne physiquement en zone mais <b>absent de la liste TowSoft</b>. Cas typique :
          fiche TowSoft creee apres la migration, ou vehicule entre sans passer par TowSoft.</p>
          <p className="mt-2">Pour chaque ligne : verifier Odoo helpdesk avec la plaque, puis soit creer
          la fiche depuis PoliceClient (recherche par plaque pour autocompletion), soit marquer comme erreur de scan.</p>
        </div>

        <div className="flex items-center gap-3 text-sm flex-wrap">
          <button
            onClick={() => setShow(false)}
            className={`px-3 py-1.5 rounded-lg font-semibold transition ${!showResolved ? 'bg-warning-100 text-warning-800 border border-warning-300' : 'bg-surface-2 text-ink-muted hover:text-ink border'}`}>
            <Eye size={14} className="inline mr-1" />
            A traiter ({counts.unresolved})
          </button>
          <button
            onClick={() => setShow(true)}
            className={`px-3 py-1.5 rounded-lg font-semibold transition ${showResolved ? 'bg-surface-2 text-ink border' : 'bg-surface-2 text-ink-muted hover:text-ink border'}`}>
            <EyeOff size={14} className="inline mr-1" />
            Resolus ({counts.resolved})
          </button>
          {!showResolved && orphans.length > 0 && (
            <button
              onClick={retryAll}
              disabled={resolving === 'all'}
              className="ml-auto px-3 py-1.5 bg-info-50 hover:bg-info-100 text-info-800 border border-info-200 rounded-lg font-semibold transition disabled:opacity-50">
              <RotateCw size={14} className="inline mr-1" />
              {resolving === 'all' ? 'Re-tentative...' : `Re-tenter tous (${orphans.length})`}
            </button>
          )}
        </div>

        {loading ? (
          <div className="bg-surface border rounded-2xl p-6 text-center text-ink-muted">
            <Loader2 className="inline animate-spin mr-2" size={14} /> Chargement…
          </div>
        ) : orphans.length === 0 ? (
          <div className="bg-surface border rounded-2xl p-8 text-center text-ink-muted">
            {showResolved
              ? 'Aucun fantome resolu.'
              : 'Aucun fantome a traiter. Tout est OK.'}
          </div>
        ) : (
          <div className="space-y-2">
            {orphans.map(o => (
              <div key={o.id} className="bg-surface border rounded-2xl p-4 space-y-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="px-2 py-1 bg-ink-100 text-ink rounded font-mono text-sm font-bold">{o.raw_input}</span>
                  <span className="px-2 py-0.5 bg-info-50 text-info-800 rounded text-xs">Zone {o.zone}</span>
                  {o.parsed_format && (
                    <span className="px-2 py-0.5 bg-surface-2 text-ink-muted rounded text-xs">{o.parsed_format}</span>
                  )}
                  <span className="ml-auto text-xs text-ink-muted">{new Date(o.scanned_at).toLocaleString('fr-BE')}</span>
                </div>
                {(o.plate || o.vin) && (
                  <div className="text-xs text-ink-muted">
                    {o.plate && <>Plaque : <b className="text-ink font-mono">{o.plate}</b></>}
                    {o.plate && o.vin && ' · '}
                    {o.vin && <>VIN : <b className="text-ink font-mono">{o.vin}</b></>}
                  </div>
                )}

                {o.resolved_at ? (
                  <div className="text-xs text-success-800 bg-success-50 border border-success-200 rounded p-2">
                    <Check size={12} className="inline mr-1" />
                    <b>{ACTIONS.find(a => a.value === o.resolved_action)?.label || o.resolved_action}</b>
                    {' · '}{new Date(o.resolved_at).toLocaleString('fr-BE')}
                    {o.resolution_notes && <div className="mt-1 italic">"{o.resolution_notes}"</div>}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap pt-1">
                    {ACTIONS.map(a => (
                      <button
                        key={a.value}
                        onClick={() => resolve(o, a.value)}
                        disabled={resolving === o.id}
                        className="px-2 py-1 bg-surface-2 hover:bg-success-50 hover:text-success-800 hover:border-success-300 border rounded text-xs font-semibold transition disabled:opacity-50">
                        {resolving === o.id ? '⏳' : a.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

      </div>
    </AppShell>
  )
}
