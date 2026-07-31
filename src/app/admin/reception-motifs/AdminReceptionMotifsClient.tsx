'use client'

import { useState }  from 'react'
import { useRouter } from 'next/navigation'
import Link          from 'next/link'

interface Motif {
  id:               string
  label:            string
  label_en:         string | null
  kind:             string          // visit | call | both
  service:          string | null
  color:            string | null   // fond de bouton (borne)
  section:          string | null   // regroupement (borne)
  requires_vehicle: boolean
  free_text:        boolean
  sort_order:       number
  active:           boolean
}

const EMPTY: Partial<Motif> = { label: '', label_en: '', kind: 'visit', service: '', color: '#E11D2E', section: '', requires_vehicle: false, free_text: false, sort_order: 100, active: true }

const KIND_LABEL: Record<string, string> = { visit: '🪪 Visite', call: '📞 Appel', both: '🪪📞 Les deux' }

export default function AdminReceptionMotifsClient({ initialMotifs }: { initialMotifs: Motif[] }) {
  const router = useRouter()
  const [motifs, setMotifs]   = useState<Motif[]>(initialMotifs)
  const [editing, setEditing] = useState<Partial<Motif> | null>(null)
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)

  async function save() {
    if (!editing) return
    const isUpdate = !!editing.id
    setBusy(true); setError(null)
    try {
      const url = isUpdate ? `/api/admin/reception-motifs?id=${editing.id}` : '/api/admin/reception-motifs'
      const res = await fetch(url, {
        method:  isUpdate ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(editing),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      if (isUpdate) setMotifs(motifs.map(m => m.id === editing.id ? data.motif : m))
      else setMotifs([...motifs, data.motif].sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label)))
      setEditing(null)
      router.refresh()
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }

  async function softDelete(m: Motif) {
    if (!confirm(`Désactiver le motif « ${m.label} » ?\nIl ne sera plus proposé mais l'historique est conservé, et la compétence associée disparaît de la matrice.`)) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/admin/reception-motifs?id=${m.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      setMotifs(motifs.map(x => x.id === m.id ? { ...x, active: false } : x))
      router.refresh()
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }

  const visible = motifs.filter(m => showInactive || m.active)

  return (
    <div className="min-h-screen bg-surface max-w-3xl mx-auto flex flex-col">
      <div className="bg-surface-2 border-b border px-5 pt-12 pb-4">
        <div className="flex items-center gap-3 mb-1">
          <Link href="/admin" className="w-10 h-10 flex items-center justify-center bg-surface-hover rounded-xl text-ink text-lg">←</Link>
          <div className="flex-1">
            <h1 className="text-ink font-bold text-lg">🪪 Motifs de réception</h1>
            <p className="text-ink-muted text-xs">Motifs de visite et d'appel. Chaque motif crée une compétence activable dans la matrice.</p>
          </div>
        </div>
      </div>

      <div className="flex-1 px-5 py-6 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <label className="flex items-center gap-2 text-ink-secondary text-sm">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
            Afficher les désactivés
          </label>
          <button onClick={() => { setError(null); setEditing({ ...EMPTY }) }}
            className="px-4 py-2 bg-brand text-white rounded-xl text-sm font-semibold">+ Nouveau motif</button>
        </div>

        {error && <p className="text-critical text-sm bg-critical-soft border border-critical rounded-xl px-3 py-2">⚠️ {error}</p>}

        {visible.length === 0 ? (
          <div className="bg-surface border rounded-2xl p-10 text-center text-ink-muted text-sm">Aucun motif. Crée le premier.</div>
        ) : (
          <ul className="space-y-2">
            {visible.map(m => (
              <li key={m.id} className={`bg-surface border rounded-2xl p-4 flex items-center gap-3 ${!m.active ? 'opacity-50' : ''}`}>
                <span className="w-5 h-5 rounded-md flex-shrink-0" style={{ background: m.color || '#E5E0DA', border: '1px solid rgba(0,0,0,.1)' }} title={m.color || 'aucune couleur'} />
                <div className="flex-1 min-w-0">
                  <p className="text-ink font-semibold text-sm">{m.label} {m.label_en && <span className="text-xs font-normal text-ink-faint">· EN: {m.label_en}</span>} {!m.active && <span className="text-xs font-normal text-ink-faint">(désactivé)</span>}</p>
                  <p className="text-ink-muted text-xs flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
                    <span>{KIND_LABEL[m.kind] || m.kind}</span>
                    {m.section && <span>· 📑 {m.section}</span>}
                    {m.service && <span>· {m.service}</span>}
                    {m.requires_vehicle && <span>· 🚗 véhicule requis</span>}
                    {m.free_text && <span>· ✍️ texte libre</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => { setError(null); setEditing({ ...m }) }}
                    className="px-3 py-1.5 bg-surface-2 hover:bg-surface-hover border rounded-lg text-xs">Modifier</button>
                  {m.active && (
                    <button onClick={() => softDelete(m)}
                      className="px-3 py-1.5 bg-critical/10 hover:bg-critical/20 border border-critical/30 text-critical rounded-lg text-xs">Désactiver</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 px-4">
          <div className="bg-surface w-full max-w-md rounded-2xl border p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="text-ink font-bold text-base">{editing.id ? '✏️ Modifier le motif' : '+ Nouveau motif'}</h3>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-ink-muted text-xs font-semibold mb-1.5">Libellé FR *</label>
                <input type="text" value={editing.label || ''}
                  onChange={e => setEditing({ ...editing, label: e.target.value })}
                  placeholder="Récupérer des effets"
                  className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm" />
              </div>
              <div>
                <label className="block text-ink-muted text-xs font-semibold mb-1.5">Libellé EN</label>
                <input type="text" value={editing.label_en || ''}
                  onChange={e => setEditing({ ...editing, label_en: e.target.value })}
                  placeholder="Collect belongings"
                  className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-ink-muted text-xs font-semibold mb-1.5">Type *</label>
                <select value={editing.kind || 'visit'}
                  onChange={e => setEditing({ ...editing, kind: e.target.value })}
                  className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm">
                  <option value="visit">🪪 Visite</option>
                  <option value="call">📞 Appel</option>
                  <option value="both">🪪📞 Les deux</option>
                </select>
              </div>
              <div>
                <label className="block text-ink-muted text-xs font-semibold mb-1.5">Ordre</label>
                <input type="number" value={editing.sort_order ?? 100}
                  onChange={e => setEditing({ ...editing, sort_order: parseInt(e.target.value, 10) || 100 })}
                  className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-ink-muted text-xs font-semibold mb-1.5">Section (borne)</label>
                <input type="text" value={editing.section || ''}
                  onChange={e => setEditing({ ...editing, section: e.target.value })}
                  placeholder="Ex: Véhicule / Administratif"
                  className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm" />
              </div>
              <div>
                <label className="block text-ink-muted text-xs font-semibold mb-1.5">Couleur du bouton</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={editing.color || '#E11D2E'}
                    onChange={e => setEditing({ ...editing, color: e.target.value })}
                    className="w-10 h-9 rounded-lg border bg-surface-2 cursor-pointer p-0.5" />
                  <input type="text" value={editing.color || ''}
                    onChange={e => setEditing({ ...editing, color: e.target.value })}
                    placeholder="#E11D2E"
                    className="flex-1 min-w-0 bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm font-mono uppercase" />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-ink-muted text-xs font-semibold mb-1.5">Service (routage, optionnel)</label>
              <input type="text" value={editing.service || ''}
                onChange={e => setEditing({ ...editing, service: e.target.value })}
                placeholder="Ex: Fourrière / Rent a car / Administration"
                className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm" />
            </div>

            <label className="flex items-center gap-2 text-ink-secondary text-sm">
              <input type="checkbox" checked={!!editing.requires_vehicle}
                onChange={e => setEditing({ ...editing, requires_vehicle: e.target.checked })} />
              🚗 Véhicule / fiche requis
            </label>
            <label className="flex items-center gap-2 text-ink-secondary text-sm">
              <input type="checkbox" checked={!!editing.free_text}
                onChange={e => setEditing({ ...editing, free_text: e.target.checked })} />
              ✍️ Champ texte libre (ex. « Autre »)
            </label>
            <label className="flex items-center gap-2 text-ink-secondary text-sm">
              <input type="checkbox" checked={editing.active !== false}
                onChange={e => setEditing({ ...editing, active: e.target.checked })} />
              Actif
            </label>

            {error && <p className="text-critical text-xs">⚠ {error}</p>}

            <div className="flex gap-2">
              <button onClick={() => setEditing(null)} disabled={busy}
                className="flex-1 py-2.5 bg-surface-2 border text-ink-secondary rounded-xl text-sm">Annuler</button>
              <button onClick={save} disabled={busy || !editing.label}
                className="flex-1 py-2.5 bg-brand text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                {busy ? '⏳ ...' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
