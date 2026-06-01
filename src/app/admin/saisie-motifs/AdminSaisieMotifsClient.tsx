'use client'

import { useState }   from 'react'
import { useRouter }  from 'next/navigation'
import Link           from 'next/link'

interface Motif {
  id:          string
  code:        string
  label:       string
  label_short: string | null
  icon:        string | null
  sort_order:  number
  active:      boolean
}

const EMPTY: Partial<Motif> = { code: '', label: '', label_short: '', icon: '', sort_order: 100, active: true }

export default function AdminSaisieMotifsClient({ initialMotifs }: { initialMotifs: Motif[] }) {
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
      const url = isUpdate ? `/api/admin/saisie-motifs?id=${editing.id}` : '/api/admin/saisie-motifs'
      const res = await fetch(url, {
        method:  isUpdate ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(editing),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      if (isUpdate) {
        setMotifs(motifs.map(m => m.id === editing.id ? data.motif : m))
      } else {
        setMotifs([...motifs, data.motif].sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label)))
      }
      setEditing(null)
      router.refresh()
    } catch (e: any) {
      setError(e.message)
    } finally { setBusy(false) }
  }

  async function softDelete(m: Motif) {
    if (!confirm(`Désactiver le motif "${m.label}" ?\nIl ne sera plus proposé aux chauffeurs mais l'historique des missions sera conservé.`)) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/admin/saisie-motifs?id=${m.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      setMotifs(motifs.map(x => x.id === m.id ? { ...x, active: false } : x))
    } catch (e: any) {
      setError(e.message)
    } finally { setBusy(false) }
  }

  const visible = motifs.filter(m => showInactive || m.active)

  return (
    <div className="min-h-screen bg-surface max-w-3xl mx-auto flex flex-col">
      <div className="bg-surface-2 border-b border px-5 pt-12 pb-4">
        <div className="flex items-center gap-3 mb-3">
          <Link href="/admin" className="w-10 h-10 flex items-center justify-center bg-surface-hover rounded-xl text-ink text-lg">←</Link>
          <div className="flex-1">
            <h1 className="text-ink font-bold text-lg">⚖️ Motifs de saisie Police</h1>
            <p className="text-ink-muted text-xs">Liste obligatoire à la création d'une mission Police-Saisie. Le motif apparait sur l'étiquette parc.</p>
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
            className="px-4 py-2 bg-brand text-white rounded-xl text-sm font-semibold">
            + Nouveau motif
          </button>
        </div>

        {error && <p className="text-critical text-sm bg-critical-soft border border-critical rounded-xl px-3 py-2">⚠️ {error}</p>}

        {visible.length === 0 ? (
          <div className="bg-surface border rounded-2xl p-10 text-center text-ink-muted text-sm">
            Aucun motif. Crée le premier (ex: "Défaut assurance", code DEFAUT_ASSURANCE).
          </div>
        ) : (
          <ul className="space-y-2">
            {visible.map(m => (
              <li key={m.id} className={`bg-surface border rounded-2xl p-4 flex items-center gap-3 ${!m.active ? 'opacity-50' : ''}`}>
                <div className="text-2xl flex-shrink-0 w-10 text-center">{m.icon || '⚖️'}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-ink font-semibold text-sm">{m.label} {!m.active && <span className="text-xs font-normal text-ink-faint">(désactivé)</span>}</p>
                  <p className="text-ink-muted text-xs font-mono">{m.code}{m.label_short ? ` · étiquette : "${m.label_short}"` : ''}</p>
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
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 px-4" onClick={() => !busy && setEditing(null)}>
          <div className="bg-surface w-full max-w-md rounded-2xl border p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="text-ink font-bold text-base">{editing.id ? '✏️ Modifier le motif' : '+ Nouveau motif'}</h3>

            <div>
              <label className="block text-ink-muted text-xs font-semibold mb-1.5">Label *</label>
              <input type="text" value={editing.label || ''}
                onChange={e => setEditing({ ...editing, label: e.target.value })}
                placeholder="Ex: Défaut assurance"
                className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm" />
            </div>

            <div>
              <label className="block text-ink-muted text-xs font-semibold mb-1.5">Code *</label>
              <input type="text" value={editing.code || ''}
                onChange={e => setEditing({ ...editing, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })}
                placeholder="Ex: DEFAUT_ASSURANCE (auto-formaté)"
                className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm font-mono uppercase" />
              <p className="text-ink-faint text-[10px] mt-1">Identifiant unique (lettres majuscules + underscores).</p>
            </div>

            <div>
              <label className="block text-ink-muted text-xs font-semibold mb-1.5">Label court (étiquette)</label>
              <input type="text" value={editing.label_short || ''}
                onChange={e => setEditing({ ...editing, label_short: e.target.value })}
                placeholder="Ex: DEF. ASSUR. (max 20 chars). Vide = label normal"
                maxLength={20}
                className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm font-mono uppercase" />
              <p className="text-ink-faint text-[10px] mt-1">Version courte pour l'étiquette parc imprimée. Si vide, le label sera utilisé.</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-ink-muted text-xs font-semibold mb-1.5">Icône (emoji)</label>
                <input type="text" value={editing.icon || ''}
                  onChange={e => setEditing({ ...editing, icon: e.target.value })}
                  placeholder="📄 / 🍺 / 🚓"
                  maxLength={2}
                  className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-2xl text-center" />
              </div>
              <div>
                <label className="block text-ink-muted text-xs font-semibold mb-1.5">Ordre</label>
                <input type="number" value={editing.sort_order ?? 100}
                  onChange={e => setEditing({ ...editing, sort_order: parseInt(e.target.value, 10) || 100 })}
                  className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm" />
              </div>
            </div>

            <label className="flex items-center gap-2 text-ink-secondary text-sm">
              <input type="checkbox" checked={editing.active !== false}
                onChange={e => setEditing({ ...editing, active: e.target.checked })} />
              Actif (visible dans la liste chauffeur)
            </label>

            {error && <p className="text-critical text-xs">⚠ {error}</p>}

            <div className="flex gap-2">
              <button onClick={() => setEditing(null)} disabled={busy}
                className="flex-1 py-2.5 bg-surface-2 border text-ink-secondary rounded-xl text-sm">Annuler</button>
              <button onClick={save} disabled={busy || !editing.code || !editing.label}
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
