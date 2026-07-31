'use client'

// CRUD users garage (role='garage') avec lien many-to-many vers garage_partners.
// Olivier 2026-06-02. Cf [[project-espace-client-garages]].

import { useState }   from 'react'
import { useRouter }  from 'next/navigation'
import Link           from 'next/link'

interface PartnerLite {
  id:               string
  name:             string
  is_default?:      boolean
  last_selected_at?: string | null
  active?:          boolean
}

interface GarageUser {
  id:          string
  email:       string
  name:        string
  active:      boolean
  last_login:  string | null
  created_at:  string
  partners:    PartnerLite[]
}

interface AllPartner {
  id:     string
  name:   string
  active: boolean
}

const EMPTY: Partial<GarageUser & { partner_ids: string[]; sendWelcomeEmail: boolean }> = {
  email: '', name: '', active: true, partners: [], partner_ids: [], sendWelcomeEmail: true,
}

export default function AdminGarageUsersClient({
  initialUsers, allPartners,
}: {
  initialUsers: GarageUser[]
  allPartners:  AllPartner[]
}) {
  const router = useRouter()
  const [users, setUsers]           = useState<GarageUser[]>(initialUsers)
  const [editing, setEditing]       = useState<any | null>(null)
  const [busy, setBusy]             = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)

  async function save() {
    if (!editing) return
    const isUpdate = !!editing.id
    setBusy(true); setError(null)
    try {
      const url = isUpdate ? `/api/admin/garage-users?id=${editing.id}` : '/api/admin/garage-users'
      const body: any = { email: editing.email, name: editing.name, active: editing.active }
      if (Array.isArray(editing.partner_ids)) body.partner_ids = editing.partner_ids
      const res = await fetch(url, {
        method:  isUpdate ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')

      // Bonus : si nouveau user + envoyer email coche → call send-welcome
      if (!isUpdate && editing.sendWelcomeEmail && data.user?.id) {
        try {
          await fetch(`/api/admin/garage-users/${data.user.id}/send-welcome`, { method: 'POST' })
        } catch { /* silent */ }
      }

      setEditing(null)
      router.refresh()
    } catch (e: any) {
      setError(e.message)
    } finally { setBusy(false) }
  }

  async function softDelete(u: GarageUser) {
    if (!confirm(`Désactiver le compte "${u.email}" ?\nIl ne pourra plus se connecter à l'espace /garage.`)) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/admin/garage-users?id=${u.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      setUsers(users.map(x => x.id === u.id ? { ...x, active: false } : x))
    } catch (e: any) {
      setError(e.message)
    } finally { setBusy(false) }
  }

  async function sendWelcome(u: GarageUser) {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/admin/garage-users/${u.id}/send-welcome`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      alert(`📧 Email de bienvenue envoyé à ${u.email}`)
    } catch (e: any) {
      setError(e.message)
    } finally { setBusy(false) }
  }

  const visible = users.filter(u => showInactive || u.active)

  function togglePartner(pid: string) {
    if (!editing) return
    const list: string[] = Array.isArray(editing.partner_ids) ? editing.partner_ids : []
    const next = list.includes(pid) ? list.filter(x => x !== pid) : [...list, pid]
    setEditing({ ...editing, partner_ids: next })
  }

  function openNew() {
    setError(null)
    setEditing({ ...EMPTY, partner_ids: [] })
  }

  function openEdit(u: GarageUser) {
    setError(null)
    setEditing({
      id:           u.id,
      email:        u.email,
      name:         u.name,
      active:       u.active,
      partner_ids:  u.partners.map(p => p.id),
      sendWelcomeEmail: false,
    })
  }

  return (
    <div className="min-h-screen bg-surface max-w-4xl mx-auto flex flex-col">
      <div className="bg-surface-2 border-b border px-5 pt-12 pb-4">
        <div className="flex items-center gap-3 mb-3">
          <Link href="/admin" className="w-10 h-10 flex items-center justify-center bg-surface-hover rounded-xl text-ink text-lg">←</Link>
          <div className="flex-1">
            <h1 className="text-ink font-bold text-lg">👥 Comptes garages</h1>
            <p className="text-ink-muted text-xs">Users avec rôle <code>garage</code> et accès à l&apos;espace /garage. Un user peut être lié à plusieurs entités (même email).</p>
          </div>
        </div>
      </div>

      <div className="flex-1 px-5 py-6 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <label className="flex items-center gap-2 text-ink-secondary text-sm">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
            Afficher les désactivés
          </label>
          <button onClick={openNew}
            className="px-4 py-2 bg-brand text-white rounded-xl text-sm font-semibold">
            + Nouveau compte
          </button>
        </div>

        {error && <p className="text-critical text-sm bg-critical-soft border border-critical rounded-xl px-3 py-2">⚠️ {error}</p>}

        {allPartners.length === 0 && (
          <div className="bg-warning-soft border border-warning/40 rounded-xl p-4 text-sm">
            ⚠️ Aucun garage partenaire actif. Crée d&apos;abord un garage dans <Link className="font-semibold underline" href="/admin/garage-partners">Garages partenaires</Link>, puis reviens créer le compte user.
          </div>
        )}

        {visible.length === 0 ? (
          <div className="bg-surface border rounded-2xl p-10 text-center text-ink-muted text-sm">
            Aucun compte garage.
          </div>
        ) : (
          <ul className="space-y-2">
            {visible.map(u => (
              <li key={u.id} className={`bg-surface border rounded-2xl p-4 ${!u.active ? 'opacity-50' : ''}`}>
                <div className="flex items-start gap-3">
                  <div className="text-2xl flex-shrink-0 w-10 text-center">👤</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-ink font-semibold text-sm">
                      {u.name}
                      {!u.active && <span className="ml-2 text-xs font-normal text-ink-faint">(désactivé)</span>}
                    </p>
                    <p className="text-ink-muted text-xs">{u.email}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {u.partners.length === 0
                        ? <span className="text-amber-500 text-xs">⚠️ Aucune entité liée</span>
                        : u.partners.map(p => (
                            <span key={p.id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-brand/10 text-brand rounded-md text-xs">
                              🏢 {p.name}{p.is_default && ' ⭐'}
                            </span>
                          ))}
                    </div>
                    {u.last_login && (
                      <p className="text-ink-faint text-[10px] mt-2">
                        Dernière connexion : {new Date(u.last_login).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 flex-shrink-0">
                    <button onClick={() => openEdit(u)}
                      className="px-3 py-1.5 bg-surface-2 hover:bg-surface-hover border rounded-lg text-xs">Modifier</button>
                    {u.active && (
                      <>
                        <button onClick={() => sendWelcome(u)}
                          className="px-3 py-1.5 bg-info/10 hover:bg-info/20 border border-info/30 text-info rounded-lg text-xs">📧 Email bienvenue</button>
                        <button onClick={() => softDelete(u)}
                          className="px-3 py-1.5 bg-critical/10 hover:bg-critical/20 border border-critical/30 text-critical rounded-lg text-xs">Désactiver</button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 px-4 py-8 overflow-y-auto">
          <div className="bg-surface w-full max-w-lg rounded-2xl border p-5 space-y-3 my-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-ink font-bold text-base">{editing.id ? '✏️ Modifier le compte' : '+ Nouveau compte garage'}</h3>

            <div>
              <label className="block text-ink-muted text-xs font-semibold mb-1.5">Email *</label>
              <input type="email" value={editing.email || ''}
                onChange={e => setEditing({ ...editing, email: e.target.value })}
                disabled={!!editing.id}
                placeholder="contact@garage.be"
                className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm disabled:opacity-60" />
              {editing.id && <p className="text-ink-faint text-[10px] mt-1">L&apos;email ne peut pas être modifié après création.</p>}
            </div>

            <div>
              <label className="block text-ink-muted text-xs font-semibold mb-1.5">Nom du contact</label>
              <input type="text" value={editing.name || ''}
                onChange={e => setEditing({ ...editing, name: e.target.value })}
                placeholder="Nom Prénom"
                className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm" />
            </div>

            <div>
              <label className="block text-ink-muted text-xs font-semibold mb-1.5">Entités liées * <span className="text-ink-faint font-normal">(1+ garages partenaires)</span></label>
              {allPartners.length === 0 ? (
                <p className="text-ink-faint text-xs italic">Aucun garage actif. Crée d&apos;abord un garage dans /admin/garage-partners.</p>
              ) : (
                <div className="space-y-1 max-h-60 overflow-y-auto border rounded-xl p-2 bg-surface-2">
                  {allPartners.map(p => {
                    const checked = Array.isArray(editing.partner_ids) && editing.partner_ids.includes(p.id)
                    return (
                      <label key={p.id} className="flex items-center gap-2 cursor-pointer hover:bg-surface-hover rounded-lg px-2 py-1.5 text-sm">
                        <input type="checkbox" checked={checked} onChange={() => togglePartner(p.id)} />
                        <span className="text-ink">🏢 {p.name}</span>
                      </label>
                    )
                  })}
                </div>
              )}
              <p className="text-ink-faint text-[10px] mt-1">La 1ère entité cochée devient le défaut. Le user peut basculer entre entités depuis son espace.</p>
            </div>

            <label className="flex items-center gap-2 text-ink-secondary text-sm">
              <input type="checkbox" checked={editing.active !== false}
                onChange={e => setEditing({ ...editing, active: e.target.checked })} />
              Actif (peut se connecter)
            </label>

            {!editing.id && (
              <label className="flex items-center gap-2 text-ink-secondary text-sm">
                <input type="checkbox" checked={!!editing.sendWelcomeEmail}
                  onChange={e => setEditing({ ...editing, sendWelcomeEmail: e.target.checked })} />
                📧 Envoyer l&apos;email de bienvenue après création
              </label>
            )}

            {error && <p className="text-critical text-xs">⚠ {error}</p>}

            <div className="flex gap-2 pt-2">
              <button onClick={() => setEditing(null)} disabled={busy}
                className="flex-1 py-2.5 bg-surface-2 border text-ink-secondary rounded-xl text-sm">Annuler</button>
              <button onClick={save} disabled={busy || !editing.email || !editing.name || !Array.isArray(editing.partner_ids) || editing.partner_ids.length === 0}
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
