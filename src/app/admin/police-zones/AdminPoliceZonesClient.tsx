'use client'

// Olivier 2026-06-02 : CRUD admin zones de police (pattern zero-hardcode).
// Une seule zone peut etre is_default (preselectionnee dans le form chauffeur).

import { useState }   from 'react'
import { useRouter }  from 'next/navigation'
import Link           from 'next/link'

interface Zone {
  id:         string
  name:       string
  sort_order: number
  is_default: boolean
  active:     boolean
  odoo_company_id: number | null
}

const EMPTY: Partial<Zone> = { name: '', sort_order: 100, is_default: false, active: true, odoo_company_id: null }

export default function AdminPoliceZonesClient({ initialZones }: { initialZones: Zone[] }) {
  const router = useRouter()
  const [zones, setZones]     = useState<Zone[]>(initialZones)
  const [editing, setEditing] = useState<Partial<Zone> | null>(null)
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)

  async function save() {
    if (!editing) return
    const isUpdate = !!editing.id
    setBusy(true); setError(null)
    try {
      const url = isUpdate ? `/api/admin/police-zones?id=${editing.id}` : '/api/admin/police-zones'
      const res = await fetch(url, {
        method:  isUpdate ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(editing),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      const updated = data.zone
      if (isUpdate) {
        setZones(zones.map(z => z.id === editing.id ? updated : (
          // Si on a bascule is_default=true sur celle-ci, retirer le defaut des autres
          updated.is_default && z.is_default ? { ...z, is_default: false } : z
        )))
      } else {
        setZones([
          ...zones.map(z => updated.is_default && z.is_default ? { ...z, is_default: false } : z),
          updated,
        ].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)))
      }
      setEditing(null)
      router.refresh()
    } catch (e: any) {
      setError(e.message)
    } finally { setBusy(false) }
  }

  async function softDelete(z: Zone) {
    if (!confirm(`Désactiver la zone "${z.name}" ?\nElle ne sera plus proposée aux chauffeurs mais l'historique des missions sera conservé.`)) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/admin/police-zones?id=${z.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      setZones(zones.map(x => x.id === z.id ? { ...x, active: false } : x))
    } catch (e: any) {
      setError(e.message)
    } finally { setBusy(false) }
  }

  const visible = zones.filter(z => showInactive || z.active)

  return (
    <div className="min-h-screen bg-surface max-w-3xl mx-auto flex flex-col">
      <div className="bg-surface-2 border-b border px-5 pt-12 pb-4">
        <div className="flex items-center gap-3 mb-3">
          <Link href="/admin" className="w-10 h-10 flex items-center justify-center bg-surface-hover rounded-xl text-ink text-lg">←</Link>
          <div className="flex-1">
            <h1 className="text-ink font-bold text-lg">🚓 Zones de police</h1>
            <p className="text-ink-muted text-xs">Liste des zones proposées au chauffeur lors de la création d'une mission Police. La zone par défaut est pré-sélectionnée.</p>
          </div>
        </div>
      </div>

      <div className="flex-1 px-5 py-6 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <label className="flex items-center gap-2 text-ink-secondary text-sm">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
            Afficher les désactivées
          </label>
          <button onClick={() => { setError(null); setEditing({ ...EMPTY }) }}
            className="px-4 py-2 bg-brand text-white rounded-xl text-sm font-semibold">
            + Nouvelle zone
          </button>
        </div>

        {error && <p className="text-critical text-sm bg-critical-soft border border-critical rounded-xl px-3 py-2">⚠️ {error}</p>}

        {visible.length === 0 ? (
          <div className="bg-surface border rounded-2xl p-10 text-center text-ink-muted text-sm">
            Aucune zone. Crée la première (ex: "Police Zone Vesdre").
          </div>
        ) : (
          <ul className="space-y-2">
            {visible.map(z => (
              <li key={z.id} className={`bg-surface border rounded-2xl p-4 flex items-center gap-3 ${!z.active ? 'opacity-50' : ''}`}>
                <div className="text-2xl flex-shrink-0 w-10 text-center">🚓</div>
                <div className="flex-1 min-w-0">
                  <p className="text-ink font-semibold text-sm">
                    {z.name}
                    {z.is_default && <span className="ml-2 text-xs text-success font-normal">⭐ par défaut</span>}
                    {!z.active && <span className="ml-2 text-xs font-normal text-ink-faint">(désactivée)</span>}
                  </p>
                  <p className="text-ink-muted text-xs">
                    Ordre : {z.sort_order}
                    {z.odoo_company_id ? ` · Société Odoo #${z.odoo_company_id}` : ' · pas de société Odoo'}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => { setError(null); setEditing({ ...z }) }}
                    className="px-3 py-1.5 bg-surface-2 hover:bg-surface-hover border rounded-lg text-xs">Modifier</button>
                  {z.active && (
                    <button onClick={() => softDelete(z)}
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
            <h3 className="text-ink font-bold text-base">{editing.id ? '✏️ Modifier la zone' : '+ Nouvelle zone'}</h3>

            <div>
              <label className="block text-ink-muted text-xs font-semibold mb-1.5">Nom *</label>
              <input type="text" value={editing.name || ''}
                onChange={e => setEditing({ ...editing, name: e.target.value })}
                placeholder="Ex: Police Zone Vesdre"
                className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm" />
            </div>

            <div>
              <label className="block text-ink-muted text-xs font-semibold mb-1.5">Ordre</label>
              <input type="number" value={editing.sort_order ?? 100}
                onChange={e => setEditing({ ...editing, sort_order: parseInt(e.target.value, 10) || 100 })}
                className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm" />
              <p className="text-ink-faint text-[10px] mt-1">Plus petit = plus haut dans la liste affichée au chauffeur.</p>
            </div>

            <div>
              <label className="block text-ink-muted text-xs font-semibold mb-1.5">ID société Odoo</label>
              <input type="number" value={editing.odoo_company_id ?? ''}
                onChange={e => setEditing({ ...editing, odoo_company_id: e.target.value === '' ? null : (parseInt(e.target.value, 10) || null) })}
                placeholder="Ex: 1234"
                className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm" />
              <p className="text-ink-faint text-[10px] mt-1">ID de la fiche Société Odoo de la zone. Ses contacts seront proposés comme agents au chauffeur (autocomplete).</p>
            </div>

            <label className="flex items-center gap-2 text-ink-secondary text-sm">
              <input type="checkbox" checked={!!editing.is_default}
                onChange={e => setEditing({ ...editing, is_default: e.target.checked })} />
              ⭐ Zone par défaut (pré-sélectionnée dans le form chauffeur)
            </label>

            <label className="flex items-center gap-2 text-ink-secondary text-sm">
              <input type="checkbox" checked={editing.active !== false}
                onChange={e => setEditing({ ...editing, active: e.target.checked })} />
              Active (visible dans la liste chauffeur)
            </label>

            {error && <p className="text-critical text-xs">⚠ {error}</p>}

            <div className="flex gap-2">
              <button onClick={() => setEditing(null)} disabled={busy}
                className="flex-1 py-2.5 bg-surface-2 border text-ink-secondary rounded-xl text-sm">Annuler</button>
              <button onClick={save} disabled={busy || !editing.name}
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
