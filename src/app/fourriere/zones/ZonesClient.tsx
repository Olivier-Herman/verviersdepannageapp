'use client'

// Vue « Par zone » — voir page.tsx. Mêmes données que l'écran Parc
// (/api/fourriere/parc) ; un déplacement = l'API de changement de zone
// existante (transfer-parc), appelée une fois par véhicule.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Bandeau, CONTENEUR_HABILLE, RECHERCHE_BANDEAU, BOUTON_BANDEAU } from '@/components/ui/Bandeau'

interface V { id: string; plate: string | null; brand: string | null; model: string | null; zone: string | null; zone_label: string | null; nights: number; source: string | null; mission_number: number | null }
interface Z { key: string; label: string; waiting?: boolean }

const norm = (s: string) => s.toLowerCase().replace(/[\s.\-_/]/g, '')

export default function ZonesClient() {
  const [rows, setRows] = useState<V[]>([])
  const [zones, setZones] = useState<Z[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { const r = await fetch('/api/fourriere/parc', { cache: 'no-store' }); const j = await r.json(); if (r.ok) { setRows(j.vehicles || []); setZones(j.zones || []) } else setMsg(`⚠ ${j.error || 'Erreur'}`) }
    catch { setMsg('⚠ Erreur réseau') } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 6000); return () => clearTimeout(t) }, [msg])

  const nq = norm(q)
  const match = (v: V) => !nq || norm([v.plate, v.brand, v.model, String(v.mission_number ?? '')].filter(Boolean).join(' ')).includes(nq)
  const cols = useMemo(() => {
    const keys = new Set(zones.map(z => z.key))
    const list = [
      ...zones.filter(z => z.waiting), ...zones.filter(z => !z.waiting),
    ].map(z => ({ z, items: rows.filter(v => v.zone === z.key) }))
    const sans = rows.filter(v => !v.zone || !keys.has(v.zone))
    return [{ z: { key: '_sans', label: 'Sans zone', waiting: true } as Z, items: sans }, ...list].filter(c => c.z.key !== '_sans' || c.items.length)
  }, [zones, rows])

  async function deplacer(ids: string[], zone: string) {
    const cibles = ids.filter(id => rows.find(v => v.id === id)?.zone !== zone)
    if (!cibles.length) return
    setBusy(true)
    let ok = 0; const ko: string[] = []
    for (const id of cibles) {
      try { const r = await fetch(`/api/missions/${id}/transfer-parc`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ zone_key: zone }) }); if (r.ok) ok++; else { const j = await r.json().catch(() => ({})); ko.push(`${rows.find(v => v.id === id)?.plate || '?'} : ${j.error || r.status}`) } }
      catch { ko.push(rows.find(v => v.id === id)?.plate || '?') }
    }
    setMsg(`✓ ${ok} véhicule${ok > 1 ? 's' : ''} déplacé${ok > 1 ? 's' : ''} en ${zones.find(z => z.key === zone)?.label || zone}${ko.length ? ` · ⚠ ${ko.length} échec(s) : ${ko.slice(0, 3).join(' ; ')}` : ''}`)
    setSel(new Set()); setBusy(false); await load()
  }
  const toggle = (id: string) => setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toutCocher = (items: V[]) => setSel(p => { const n = new Set(p); const all = items.every(v => n.has(v.id)); items.forEach(v => all ? n.delete(v.id) : n.add(v.id)); return n })

  return (
    <div className={CONTENEUR_HABILLE}>
      <Bandeau teinte="vert" titre="Parc par zone"
        sousTitre={<><b>{rows.length}</b> véhicules · <b>{cols.filter(c => c.z.waiting).reduce((s, c) => s + c.items.length, 0)}</b> en zone d'attente, à ranger · glisse un véhicule dans une autre zone, ou coche-en plusieurs</>}
        droite={<>
          <div className="relative flex-1 min-w-0"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Plaque, marque, n°…" className={RECHERCHE_BANDEAU} aria-label="Rechercher" /></div>
          <button onClick={load} className={BOUTON_BANDEAU} title="Rafraîchir">↻</button>
          <Link href="/fourriere/plan" className={`${BOUTON_BANDEAU} inline-flex items-center`}>Plan dessiné</Link>
        </>} />

      <div className="flex max-w-full overflow-x-auto items-center gap-1 bg-surface-2 border rounded-xl p-1 text-sm whitespace-nowrap [&>*]:shrink-0">
        <Link href="/fourriere" className="px-3 py-1.5 rounded-lg text-ink-secondary hover:text-ink">Liste</Link>
        <span className="px-3 py-1.5 rounded-lg bg-surface text-ink font-semibold shadow-sm">Par zone</span>
        <Link href="/fourriere/controle" className="px-3 py-1.5 rounded-lg text-ink-secondary hover:text-ink">Contrôle</Link>
        <Link href="/taches" className="px-3 py-1.5 rounded-lg text-ink-secondary hover:text-ink">Accident</Link>
        <Link href="/fourriere/recherche" className="px-3 py-1.5 rounded-lg text-ink-secondary hover:text-ink">Historique</Link>
      </div>

      {msg && <div className="text-sm px-4 py-2.5 rounded-xl bg-surface-2 border text-ink">{msg}</div>}
      {loading && <div className="text-center py-16 text-ink-faint text-sm">Chargement du parc…</div>}

      {!loading && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,230px),1fr))] gap-3 items-start">
          {cols.map(({ z, items }) => {
            const vis = items.filter(match)
            if (nq && !vis.length) return null
            return (
              <section key={z.key}
                onDragOver={e => { if (drag && z.key !== '_sans') { e.preventDefault(); setOver(z.key) } }}
                onDragLeave={() => setOver(o => o === z.key ? null : o)}
                onDrop={e => { e.preventDefault(); setOver(null); if (drag && z.key !== '_sans') { const ids = sel.has(drag) ? [...sel] : [drag]; setDrag(null); deplacer(ids, z.key) } }}
                className={`rounded-2xl border shadow-sm overflow-hidden min-w-0 ${z.waiting ? 'bg-amber-50 border-amber-300' : 'bg-surface'} ${over === z.key ? 'ring-2 ring-brand' : ''}`}>
                <header className={`flex items-center gap-2 px-3 py-2.5 border-b ${z.waiting ? 'text-amber-900 border-amber-200' : 'text-ink'}`}>
                  <b className="text-2xl font-extrabold tabular-nums leading-none">{items.length}</b>
                  <span className="font-bold truncate">{z.label}</span>
                  {z.waiting && <span className="text-[11px] font-bold uppercase tracking-wide">à ranger</span>}
                  {vis.length > 0 && <button onClick={() => toutCocher(vis)} className="ml-auto min-h-[36px] px-2 text-xs font-semibold opacity-70 hover:opacity-100">Tout</button>}
                </header>
                <ul className="max-h-[420px] overflow-y-auto divide-y">
                  {vis.map(v => (
                    <li key={v.id} draggable onDragStart={() => setDrag(v.id)} onDragEnd={() => { setDrag(null); setOver(null) }}
                      className={`flex items-center gap-2 px-3 min-h-[44px] text-sm cursor-grab ${sel.has(v.id) ? 'bg-brand/10' : ''}`}>
                      <input type="checkbox" checked={sel.has(v.id)} onChange={() => toggle(v.id)} aria-label={`Sélectionner ${v.plate || ''}`} className="w-5 h-5 shrink-0" />
                      <span className="font-mono font-bold text-[12.5px] shrink-0">{v.plate || '—'}</span>
                      <span className="truncate text-ink-secondary flex-1 min-w-0">{[v.brand, v.model].filter(Boolean).join(' ')}</span>
                      <span className="text-[11px] text-ink-faint tabular-nums shrink-0">{v.nights} j</span>
                    </li>
                  ))}
                  {!vis.length && <li className="px-3 py-3 text-xs text-ink-faint">Vide</li>}
                </ul>
              </section>
            )
          })}
        </div>
      )}

      {sel.size > 0 && (
        <div className="sticky z-40 bg-surface border rounded-2xl shadow-lg p-3 space-y-2" style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}>
          <div className="flex items-center gap-2 flex-wrap">
            <b className="text-sm">{sel.size} véhicule{sel.size > 1 ? 's' : ''} sélectionné{sel.size > 1 ? 's' : ''} · déplacer vers :</b>
            <button onClick={() => setSel(new Set())} className="ml-auto min-h-[40px] px-3 rounded-xl border text-sm">Annuler</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {zones.filter(z => !z.waiting).concat(zones.filter(z => z.waiting)).map(z => (
              <button key={z.key} disabled={busy} onClick={() => deplacer([...sel], z.key)}
                className={`min-h-[44px] min-w-[44px] px-3 rounded-xl border text-sm font-bold disabled:opacity-40 ${z.waiting ? 'bg-amber-50 text-amber-900 border-amber-300' : 'bg-surface text-ink hover:border-brand'}`}>{z.label}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
