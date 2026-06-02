'use client'

// CRUD garages partenaires. Une entree = 1 entite (un meme garage peut avoir
// plusieurs entites = plusieurs partner_id Odoo). Olivier 2026-06-02.

import { useState }   from 'react'
import { useRouter }  from 'next/navigation'
import Link           from 'next/link'

interface Tariffs {
  dsp_price: number | null
  rem_price: number | null
  dpr_price: number | null
  currency:  string
}

interface Partner {
  id:              string
  name:            string
  odoo_partner_id: number | null
  contact_email:   string | null
  contact_phone:   string | null
  address:         string | null
  notes:           string | null
  active:          boolean
  created_at:      string
  updated_at:      string
  tariffs:         Tariffs
}

const EMPTY: Partial<Partner> = {
  name: '', odoo_partner_id: null, contact_email: '', contact_phone: '',
  address: '', notes: '', active: true,
  tariffs: { dsp_price: null, rem_price: null, dpr_price: null, currency: 'EUR' },
}

function fmtEur(v: number | null): string {
  if (v == null) return '—'
  return v.toFixed(2) + ' €'
}

export default function AdminGaragePartnersClient({ initialPartners }: { initialPartners: Partner[] }) {
  const router = useRouter()
  const [partners, setPartners] = useState<Partner[]>(initialPartners)
  const [editing, setEditing]   = useState<Partial<Partner> | null>(null)
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)

  async function save() {
    if (!editing) return
    const isUpdate = !!editing.id
    setBusy(true); setError(null)
    try {
      const url = isUpdate ? `/api/admin/garage-partners?id=${editing.id}` : '/api/admin/garage-partners'
      const res = await fetch(url, {
        method:  isUpdate ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(editing),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      if (isUpdate) {
        setPartners(partners.map(p => p.id === editing.id ? data.partner : p))
      } else {
        setPartners([data.partner, ...partners])
      }
      setEditing(null)
      router.refresh()
    } catch (e: any) {
      setError(e.message)
    } finally { setBusy(false) }
  }

  async function softDelete(p: Partner) {
    if (!confirm(`Désactiver le garage "${p.name}" ?\nIl ne pourra plus se connecter à son espace mais l'historique des missions est conservé.`)) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/admin/garage-partners?id=${p.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      setPartners(partners.map(x => x.id === p.id ? { ...x, active: false } : x))
    } catch (e: any) {
      setError(e.message)
    } finally { setBusy(false) }
  }

  const visible = partners.filter(p => showInactive || p.active)

  return (
    <div className="min-h-screen bg-surface max-w-4xl mx-auto flex flex-col">
      <div className="bg-surface-2 border-b border px-5 pt-12 pb-4">
        <div className="flex items-center gap-3 mb-3">
          <Link href="/admin" className="w-10 h-10 flex items-center justify-center bg-surface-hover rounded-xl text-ink text-lg">←</Link>
          <div className="flex-1">
            <h1 className="text-ink font-bold text-lg">🏢 Garages partenaires</h1>
            <p className="text-ink-muted text-xs">Espace client garage : un partenaire = une entité (un même garage peut avoir plusieurs entités). Tarifs DSP / REM / DPR par garage.</p>
          </div>
        </div>
      </div>

      <div className="flex-1 px-5 py-6 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <label className="flex items-center gap-2 text-ink-secondary text-sm">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
            Afficher les désactivés
          </label>
          <button onClick={() => { setError(null); setEditing(JSON.parse(JSON.stringify(EMPTY))) }}
            className="px-4 py-2 bg-brand text-white rounded-xl text-sm font-semibold">
            + Nouveau garage
          </button>
        </div>

        {error && <p className="text-critical text-sm bg-critical-soft border border-critical rounded-xl px-3 py-2">⚠️ {error}</p>}

        {visible.length === 0 ? (
          <div className="bg-surface border rounded-2xl p-10 text-center text-ink-muted text-sm">
            Aucun garage. Crée le premier — pense à renseigner son <code>odoo_partner_id</code> après avoir créé le partner côté Odoo.
          </div>
        ) : (
          <ul className="space-y-2">
            {visible.map(p => (
              <li key={p.id} className={`bg-surface border rounded-2xl p-4 ${!p.active ? 'opacity-50' : ''}`}>
                <div className="flex items-start gap-3">
                  <div className="text-2xl flex-shrink-0 w-10 text-center">🏢</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-ink font-semibold text-sm">
                      {p.name}
                      {!p.active && <span className="ml-2 text-xs font-normal text-ink-faint">(désactivé)</span>}
                    </p>
                    <div className="text-ink-muted text-xs mt-0.5 space-y-0.5">
                      {p.odoo_partner_id != null
                        ? <p>📎 Odoo partner ID : <span className="font-mono">{p.odoo_partner_id}</span></p>
                        : <p className="text-amber-500">⚠️ Pas d&apos;Odoo partner ID — facturation impossible tant que pas renseigné</p>}
                      {p.contact_email && <p>📧 {p.contact_email}</p>}
                      {p.contact_phone && <p>📞 {p.contact_phone}</p>}
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
                      <div className="bg-surface-2 rounded-lg px-2 py-1.5 text-center">
                        <p className="text-ink-faint text-[10px] uppercase">DSP</p>
                        <p className="text-ink font-semibold">{fmtEur(p.tariffs.dsp_price)}</p>
                      </div>
                      <div className="bg-surface-2 rounded-lg px-2 py-1.5 text-center">
                        <p className="text-ink-faint text-[10px] uppercase">REM</p>
                        <p className="text-ink font-semibold">{fmtEur(p.tariffs.rem_price)}</p>
                      </div>
                      <div className="bg-surface-2 rounded-lg px-2 py-1.5 text-center">
                        <p className="text-ink-faint text-[10px] uppercase">DPR</p>
                        <p className="text-ink font-semibold">
                          {p.tariffs.dpr_price != null
                            ? fmtEur(p.tariffs.dpr_price)
                            : <span className="text-ink-faint italic text-[10px]">= DSP</span>}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 flex-shrink-0">
                    <button onClick={() => { setError(null); setEditing(JSON.parse(JSON.stringify(p))) }}
                      className="px-3 py-1.5 bg-surface-2 hover:bg-surface-hover border rounded-lg text-xs">Modifier</button>
                    {p.active && (
                      <button onClick={() => softDelete(p)}
                        className="px-3 py-1.5 bg-critical/10 hover:bg-critical/20 border border-critical/30 text-critical rounded-lg text-xs">Désactiver</button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 px-4 py-8 overflow-y-auto" onClick={() => !busy && setEditing(null)}>
          <div className="bg-surface w-full max-w-lg rounded-2xl border p-5 space-y-3 my-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-ink font-bold text-base">{editing.id ? '✏️ Modifier le garage' : '+ Nouveau garage'}</h3>

            <div>
              <label className="block text-ink-muted text-xs font-semibold mb-1.5">Nom de l&apos;entité *</label>
              <input type="text" value={editing.name || ''}
                onChange={e => setEditing({ ...editing, name: e.target.value })}
                placeholder="Ex: Garage Dupont — Liège Centre"
                className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm" />
            </div>

            <div>
              <label className="block text-ink-muted text-xs font-semibold mb-1.5">Odoo partner ID</label>
              <input type="number" value={editing.odoo_partner_id ?? ''}
                onChange={e => setEditing({ ...editing, odoo_partner_id: e.target.value === '' ? null : parseInt(e.target.value, 10) })}
                placeholder="Ex: 1234 (ID Odoo res.partner)"
                className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm font-mono" />
              <p className="text-ink-faint text-[10px] mt-1">Crée le partner côté Odoo d&apos;abord, puis copie son ID ici. Sans ça la facturation auto ne fonctionnera pas.</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-ink-muted text-xs font-semibold mb-1.5">Email contact</label>
                <input type="email" value={editing.contact_email || ''}
                  onChange={e => setEditing({ ...editing, contact_email: e.target.value })}
                  placeholder="info@garage.be"
                  className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm" />
              </div>
              <div>
                <label className="block text-ink-muted text-xs font-semibold mb-1.5">Téléphone</label>
                <input type="tel" value={editing.contact_phone || ''}
                  onChange={e => setEditing({ ...editing, contact_phone: e.target.value })}
                  placeholder="+32..."
                  className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm" />
              </div>
            </div>

            <div>
              <label className="block text-ink-muted text-xs font-semibold mb-1.5">Adresse</label>
              <input type="text" value={editing.address || ''}
                onChange={e => setEditing({ ...editing, address: e.target.value })}
                placeholder="Rue, code postal, ville"
                className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm" />
            </div>

            <div>
              <label className="block text-ink-muted text-xs font-semibold mb-1.5">Notes internes</label>
              <textarea value={editing.notes || ''}
                onChange={e => setEditing({ ...editing, notes: e.target.value })}
                placeholder="Visibles uniquement par admin / dispatch"
                rows={2}
                className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm" />
            </div>

            <div className="border-t pt-3 mt-3">
              <p className="text-ink-muted text-xs font-semibold uppercase mb-2">💰 Tarifs (TVAC)</p>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-ink-muted text-xs font-semibold mb-1.5">DSP</label>
                  <input type="number" step="0.01" value={editing.tariffs?.dsp_price ?? ''}
                    onChange={e => setEditing({ ...editing, tariffs: { ...(editing.tariffs || EMPTY.tariffs!), dsp_price: e.target.value === '' ? null : parseFloat(e.target.value) } })}
                    placeholder="125.00"
                    className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm" />
                </div>
                <div>
                  <label className="block text-ink-muted text-xs font-semibold mb-1.5">REM</label>
                  <input type="number" step="0.01" value={editing.tariffs?.rem_price ?? ''}
                    onChange={e => setEditing({ ...editing, tariffs: { ...(editing.tariffs || EMPTY.tariffs!), rem_price: e.target.value === '' ? null : parseFloat(e.target.value) } })}
                    placeholder="180.00"
                    className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm" />
                </div>
                <div>
                  <label className="block text-ink-muted text-xs font-semibold mb-1.5">DPR</label>
                  <input type="number" step="0.01" value={editing.tariffs?.dpr_price ?? ''}
                    onChange={e => setEditing({ ...editing, tariffs: { ...(editing.tariffs || EMPTY.tariffs!), dpr_price: e.target.value === '' ? null : parseFloat(e.target.value) } })}
                    placeholder="(vide = DSP)"
                    className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm" />
                </div>
              </div>
              <p className="text-ink-faint text-[10px] mt-1.5">DPR (déplacement pour rien) utilisé pour annulation post-acceptation. Si vide → fallback DSP.</p>
            </div>

            <label className="flex items-center gap-2 text-ink-secondary text-sm pt-2">
              <input type="checkbox" checked={editing.active !== false}
                onChange={e => setEditing({ ...editing, active: e.target.checked })} />
              Actif (le garage peut se connecter à son espace)
            </label>

            {error && <p className="text-critical text-xs">⚠ {error}</p>}

            <div className="flex gap-2 pt-2">
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
