'use client'

// Grille transport / rapatriement : une ligne par source, une colonne par
// gabarit, la case = prix au km HTVA. Case vide = pas de tarif (la fiche
// reste « à calculer » tant que le prix n'est pas saisi).
// Olivier 21/09/2026 (grille par gabarit, préalable robot transports).

import { useEffect, useMemo, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { TRANSPORT_GABARITS, TRANSPORT_GABARIT_LABELS, TRANSPORT_GABARIT_HELP, type TransportGabarit } from '@/lib/tarifs/transport-gabarits'

interface Tariff { id: string; source_key: string; vehicle_category: TransportGabarit; price_per_km_htva: number; active: boolean }
interface Source { key: string; label: string }

const TVA = 1.21
const fmt = (n: number, d = 2) => n.toFixed(d).replace('.', ',')
/** Saisie belge (« 1,25 ») → chaîne stockée dans l'input, sans virgule. */
const normalize = (v: string) => v.replace(',', '.').replace(/[^\d.]/g, '')

export default function TarifsTransportClient(props: { userRole: string; userName: string; userEmail?: string; userModules: string[] }) {
  const [tariffs, setTariffs] = useState<Tariff[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [busy,    setBusy]    = useState<string | null>(null)     // "source:gabarit" en cours d'enregistrement
  const [toast,   setToast]   = useState<string | null>(null)
  // Valeurs en cours de frappe (clé "source:gabarit" → texte). Enregistré au blur / Entrée.
  const [drafts,  setDrafts]  = useState<Record<string, string>>({})
  // Sources ajoutées à la grille mais sans prix encore (pas en base tant qu'une case n'est pas remplie).
  const [extraSources, setExtraSources] = useState<string[]>([])
  const [pick, setPick] = useState('')

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2200) }

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const r = await fetch('/api/admin/transport-tariffs', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Chargement impossible')
      setTariffs(j.tariffs || []); setSources(j.sources || [])
    } catch (e: any) { setError(e?.message || 'Erreur') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const labelOf = useMemo(() => Object.fromEntries(sources.map(s => [s.key, s.label])), [sources])
  const priceOf = (source: string, cat: TransportGabarit) => tariffs.find(t => t.source_key === source && t.vehicle_category === cat)?.price_per_km_htva ?? null

  // Lignes de la grille : sources qui ont déjà un prix + celles ajoutées à la main, triées par libellé.
  const rows = useMemo(() => {
    const keys = new Set<string>([...tariffs.map(t => t.source_key), ...extraSources])
    return Array.from(keys).sort((a, b) => (labelOf[a] || a).localeCompare(labelOf[b] || b, 'fr', { sensitivity: 'base' }))
  }, [tariffs, extraSources, labelOf])
  const addable = sources.filter(s => !rows.includes(s.key))

  async function save(source: string, cat: TransportGabarit, text: string) {
    const key = `${source}:${cat}`
    const current = priceOf(source, cat)
    const empty = text.trim() === ''
    const n = empty ? null : Number(normalize(text))
    if (!empty && (!Number.isFinite(n) || (n as number) < 0)) { flash('⚠ Prix invalide'); return }
    if ((n == null && current == null) || (n != null && current != null && Math.abs(n - current) < 0.00005)) return   // rien à faire
    setBusy(key)
    try {
      const r = await fetch('/api/admin/transport-tariffs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_key: source, vehicle_category: cat, price_per_km_htva: n }),
      })
      const j = await r.json()
      if (!r.ok) { flash(`⚠ ${j?.error || 'Échec'}`); return }
      setTariffs(j.tariffs || [])
      setDrafts(d => { const c = { ...d }; delete c[key]; return c })
      flash(n == null ? 'Tarif retiré' : `✅ ${labelOf[source] || source} · ${TRANSPORT_GABARIT_LABELS[cat]} : ${fmt(n, 4)} € HTVA/km`)
    } catch { flash('⚠ Erreur réseau') }
    finally { setBusy(null) }
  }

  const configured = tariffs.filter(t => t.active).length

  return (
    <AppShell title="Tarifs transport" userRole={props.userRole} userName={props.userName} userEmail={props.userEmail} userModules={props.userModules}>
      <main className="p-4 max-w-5xl mx-auto space-y-4">
        {toast && <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[70] bg-surface border shadow-lg rounded-xl px-4 py-2 text-sm font-medium text-ink">{toast}</div>}

        <div>
          <h1 className="text-ink text-lg font-bold">🚐 Tarifs transport / rapatriement</h1>
          <p className="text-ink-muted text-sm mt-1">
            Prix au kilomètre <b>HTVA</b> par assisteur et par gabarit de véhicule. Un transport se facture
            <b> prix/km × kilomètres aller-retour depuis le dépôt</b> (dépôt → prise en charge → dépose → dépôt), sans forfait ni prise en charge.
          </p>
        </div>

        {/* Aide courte, sans jargon */}
        <div className="bg-sky-50 border border-sky-200 rounded-xl px-3 py-2 text-sky-900 text-xs space-y-1">
          <p>• Le dispatch choisit le <b>gabarit</b> sur la fiche (Voiture, Monospace, Camionnette L1/H1, Camionnette L2/H2, Autre). Le prix se calcule tout seul avec cette grille.</p>
          <p>• <b>Autre</b> (camping-car, remorque, hors gabarit) : pas de prix ici, le prix/km se tape directement sur la fiche.</p>
          <p>• Case vide = pas de tarif : la fiche reste « à calculer » en facturation tant que le prix manque.</p>
          <p>• Les transports se facturent <b>à la main</b> (bouton Facturer) : le robot ne les prend pas encore.</p>
        </div>

        {error && <div className="bg-rose-50 border border-rose-300 rounded-xl px-3 py-2 text-rose-800 text-sm">{error}</div>}

        {/* Ajouter une source à la grille */}
        <div className="bg-surface border rounded-xl p-3 flex items-center gap-2 flex-wrap">
          <span className="text-ink text-sm font-medium">➕ Ajouter un assisteur à la grille</span>
          <select value={pick} onChange={e => setPick(e.target.value)}
            className="bg-surface border rounded-lg px-2 py-1.5 text-sm text-ink focus:outline-none focus:border-brand">
            <option value="">— choisir —</option>
            {addable.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <button type="button" disabled={!pick}
            onClick={() => { if (pick) { setExtraSources(x => x.includes(pick) ? x : [...x, pick]); setPick('') } }}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand text-white disabled:opacity-40">Ajouter</button>
          <span className="text-ink-faint text-[11px]">Touring, Mondial / Allianz, VAB, AXA, Kaze… — toute source du catalogue peut envoyer un transport.</span>
        </div>

        {loading ? (
          <p className="text-ink-muted py-8 text-center">Chargement…</p>
        ) : (
          <div className="bg-surface border rounded-2xl overflow-x-auto">
            <div className="min-w-[760px]">
              <div className="grid grid-cols-[minmax(160px,1.2fr)_repeat(5,minmax(120px,1fr))] gap-2 px-4 py-2 border-b text-ink-muted text-[11px] uppercase tracking-wide">
                <span>Assisteur</span>
                {TRANSPORT_GABARITS.map(c => (
                  <span key={c} className="text-center" title={TRANSPORT_GABARIT_HELP[c]}>{TRANSPORT_GABARIT_LABELS[c]}<br /><span className="normal-case tracking-normal text-ink-faint">€ HTVA / km</span></span>
                ))}
                <span className="text-center" title={TRANSPORT_GABARIT_HELP.autre}>Autre<br /><span className="normal-case tracking-normal text-ink-faint">prix/km sur la fiche</span></span>
              </div>

              {rows.map(source => (
                <div key={source} className="grid grid-cols-[minmax(160px,1.2fr)_repeat(5,minmax(120px,1fr))] gap-2 px-4 py-2.5 border-b last:border-0 items-center">
                  <div className="min-w-0">
                    <p className="text-ink text-sm font-medium truncate">{labelOf[source] || source}</p>
                    <p className="text-ink-faint text-[11px] font-mono truncate">{source}</p>
                  </div>
                  {TRANSPORT_GABARITS.map(cat => {
                    const key = `${source}:${cat}`
                    const saved = priceOf(source, cat)
                    const value = drafts[key] ?? (saved != null ? String(saved) : '')
                    const n = value.trim() === '' ? null : Number(normalize(value))
                    return (
                      <div key={cat} className="flex flex-col items-center">
                        <input
                          inputMode="decimal"
                          value={value}
                          disabled={busy === key}
                          placeholder="—"
                          onChange={e => setDrafts(d => ({ ...d, [key]: e.target.value }))}
                          onBlur={() => save(source, cat, value)}
                          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                          className={`w-24 text-center bg-surface border rounded-lg px-2 py-1.5 text-sm text-ink tabular-nums focus:outline-none focus:border-brand disabled:opacity-50 ${saved == null && !value ? 'border-dashed' : ''}`}
                        />
                        <span className="text-ink-faint text-[10px] mt-0.5 tabular-nums">
                          {n != null && Number.isFinite(n) ? `= ${fmt(n * TVA)} € TVAC/km` : 'pas de tarif'}
                        </span>
                      </div>
                    )
                  })}
                  <div className="text-center text-ink-faint text-[11px]">saisi sur la fiche</div>
                </div>
              ))}
              {rows.length === 0 && (
                <p className="text-ink-muted text-sm text-center py-8">Aucun assisteur dans la grille : ajoute-en un ci-dessus, puis tape les prix au km.</p>
              )}
            </div>
          </div>
        )}

        <p className="text-ink-faint text-xs text-center">
          {configured} prix configuré{configured > 1 ? 's' : ''} · les montants chauffeur s'affichent TVAC, la grille reste HTVA.
        </p>
      </main>
    </AppShell>
  )
}
