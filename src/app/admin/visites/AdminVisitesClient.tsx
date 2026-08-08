'use client'

// Paramétrage du module Visiteur : motifs de visite (dont « expert ») + bureaux
// d'expertise. Deux catalogues éditables (ajout / renommer / ordre / (dés)activer).
// Zéro hardcode : ces listes alimentent l'écran comptoir et l'ajout manuel.

import { useState }  from 'react'
import { useRouter } from 'next/navigation'
import Link          from 'next/link'

interface Motif  { id: string; label: string; is_expert: boolean; sort_order: number; active: boolean }
interface Bureau { id: string; name: string;  sort_order: number; active: boolean }

export default function AdminVisitesClient({
  initialMotifs, initialBureaux,
}: {
  initialMotifs: Motif[]; initialBureaux: Bureau[]
}) {
  const router = useRouter()
  const [motifs, setMotifs]   = useState<Motif[]>(initialMotifs)
  const [bureaux, setBureaux] = useState<Bureau[]>(initialBureaux)
  const [showInactive, setShowInactive] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [busy, setBusy]       = useState(false)

  // Ajout
  const [newMotif, setNewMotif]   = useState('')
  const [newMotifExpert, setNewMotifExpert] = useState(false)
  const [newBureau, setNewBureau] = useState('')

  async function call(cat: 'motifs' | 'bureaux', method: string, id: string | null, body?: any) {
    const qs = new URLSearchParams({ cat }); if (id) qs.set('id', id)
    const res = await fetch(`/api/admin/visites?${qs}`, {
      method, headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Erreur')
    return data.item
  }

  async function addMotif() {
    const label = newMotif.trim(); if (!label) return
    setBusy(true); setError(null)
    try {
      const item = await call('motifs', 'POST', null, { label, is_expert: newMotifExpert, sort_order: (motifs.at(-1)?.sort_order || 0) + 10 })
      setMotifs([...motifs, item]); setNewMotif(''); setNewMotifExpert(false); router.refresh()
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }
  async function addBureau() {
    const name = newBureau.trim(); if (!name) return
    setBusy(true); setError(null)
    try {
      const item = await call('bureaux', 'POST', null, { name, sort_order: (bureaux.at(-1)?.sort_order || 0) + 10 })
      setBureaux([...bureaux, item]); setNewBureau(''); router.refresh()
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }

  async function patchMotif(m: Motif, patch: Partial<Motif>) {
    setBusy(true); setError(null)
    try {
      const item = await call('motifs', 'PATCH', m.id, patch)
      setMotifs(motifs.map(x => x.id === m.id ? item : x)); router.refresh()
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }
  async function patchBureau(b: Bureau, patch: Partial<Bureau>) {
    setBusy(true); setError(null)
    try {
      const item = await call('bureaux', 'PATCH', b.id, patch)
      setBureaux(bureaux.map(x => x.id === b.id ? item : x)); router.refresh()
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }

  async function toggleActive(cat: 'motifs' | 'bureaux', item: Motif | Bureau) {
    if (item.active && !confirm('Désactiver cet élément ? Il ne sera plus proposé (historique conservé).')) return
    setBusy(true); setError(null)
    try {
      if (item.active) {
        await call(cat, 'DELETE', item.id)
        if (cat === 'motifs') setMotifs(motifs.map(x => x.id === item.id ? { ...x, active: false } as Motif : x))
        else setBureaux(bureaux.map(x => x.id === item.id ? { ...x, active: false } as Bureau : x))
      } else {
        const upd = await call(cat, 'PATCH', item.id, { active: true })
        if (cat === 'motifs') setMotifs(motifs.map(x => x.id === item.id ? upd : x))
        else setBureaux(bureaux.map(x => x.id === item.id ? upd : x))
      }
      router.refresh()
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }

  const inputCls  = 'flex-1 px-3 py-2 bg-surface border border-app rounded-xl text-sm text-ink'
  const visMotifs = motifs.filter(m => showInactive || m.active)
  const visBureaux = bureaux.filter(b => showInactive || b.active)

  return (
    <div className="min-h-screen bg-surface max-w-3xl mx-auto flex flex-col">
      <div className="bg-surface-2 border-b border-app px-5 pt-12 pb-4">
        <div className="flex items-center gap-3 mb-1">
          <Link href="/admin" className="w-10 h-10 flex items-center justify-center bg-surface-hover rounded-xl text-ink text-lg">←</Link>
          <div className="flex-1">
            <h1 className="text-ink font-bold text-lg">👥 Visites au comptoir</h1>
            <p className="text-ink-muted text-xs">Motifs de visite et bureaux d'expertise proposés lors de l'enregistrement d'une visite (véhicule en parc).</p>
          </div>
        </div>
      </div>

      <div className="flex-1 px-5 py-6 space-y-6">
        <label className="flex items-center gap-2 text-ink-secondary text-sm">
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
          Afficher les désactivés
        </label>
        {error && <p className="text-critical text-sm bg-critical-soft border border-critical rounded-xl px-3 py-2">⚠️ {error}</p>}

        {/* ── Motifs ─────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-ink font-semibold text-sm">Motifs de visite</h2>
          <div className="flex gap-2 items-center">
            <input className={inputCls} placeholder="Nouveau motif (ex. Récupérer des affaires)"
              value={newMotif} onChange={e => setNewMotif(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addMotif()} />
            <label className="flex items-center gap-1.5 text-xs text-ink-secondary whitespace-nowrap" title="Ce motif demandera de choisir un bureau d'expertise">
              <input type="checkbox" checked={newMotifExpert} onChange={e => setNewMotifExpert(e.target.checked)} />
              🔎 Expert
            </label>
            <button onClick={addMotif} disabled={busy || !newMotif.trim()}
              className="px-4 py-2 bg-brand text-white rounded-xl text-sm font-semibold disabled:opacity-50">+ Ajouter</button>
          </div>
          <ul className="space-y-1.5">
            {visMotifs.map(m => (
              <li key={m.id} className={`flex items-center gap-2 bg-surface-2 border border-app rounded-xl px-3 py-2 ${!m.active ? 'opacity-50' : ''}`}>
                <span className="flex-1 text-sm text-ink">{m.label}</span>
                <button onClick={() => patchMotif(m, { is_expert: !m.is_expert })}
                  className={`text-xs px-2 py-1 rounded-lg font-medium ${m.is_expert ? 'bg-amber-100 text-amber-800' : 'bg-surface text-ink-muted'}`}
                  title="Motif « expert » : demande le bureau d'expertise">
                  🔎 Expert {m.is_expert ? 'ON' : 'off'}
                </button>
                <button onClick={() => toggleActive('motifs', m)}
                  className="text-xs text-ink-muted hover:text-critical">{m.active ? 'Désactiver' : 'Réactiver'}</button>
              </li>
            ))}
            {!visMotifs.length && <li className="text-xs text-ink-muted italic">Aucun motif.</li>}
          </ul>
        </section>

        {/* ── Bureaux d'expertise ────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-ink font-semibold text-sm">Bureaux d'expertise</h2>
          <p className="text-ink-muted text-xs">Proposés quand un motif « expert » est choisi (+ un champ « Autre » toujours disponible).</p>
          <div className="flex gap-2 items-center">
            <input className={inputCls} placeholder="Nouveau bureau (ex. Dekra)"
              value={newBureau} onChange={e => setNewBureau(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addBureau()} />
            <button onClick={addBureau} disabled={busy || !newBureau.trim()}
              className="px-4 py-2 bg-brand text-white rounded-xl text-sm font-semibold disabled:opacity-50">+ Ajouter</button>
          </div>
          <ul className="space-y-1.5">
            {visBureaux.map(b => (
              <li key={b.id} className={`flex items-center gap-2 bg-surface-2 border border-app rounded-xl px-3 py-2 ${!b.active ? 'opacity-50' : ''}`}>
                <span className="flex-1 text-sm text-ink">{b.name}</span>
                <button onClick={() => toggleActive('bureaux', b)}
                  className="text-xs text-ink-muted hover:text-critical">{b.active ? 'Désactiver' : 'Réactiver'}</button>
              </li>
            ))}
            {!visBureaux.length && <li className="text-xs text-ink-muted italic">Aucun bureau.</li>}
          </ul>
        </section>
      </div>
    </div>
  )
}
