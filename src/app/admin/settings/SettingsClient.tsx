'use client'

import { useState }  from 'react'
import { useRouter }  from 'next/navigation'
import { signOut, signIn } from 'next-auth/react'

const LIST_TYPES = [
  { key: 'motif',        label: 'Motifs d\'intervention' },
  { key: 'payment_mode', label: 'Modes de paiement' },
]

export default function SettingsClient({
  listItems,
  callShortcuts,
  appSettings,
}: {
  listItems:    any[]
  callShortcuts: any[]
  appSettings:  Record<string, string>
}) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'motif' | 'payment_mode' | 'calls' | 'params'>('motif')
  const [showAdd,      setShowAdd]      = useState(false)
  const [newLabel,     setNewLabel]     = useState('')
  const [newValue,     setNewValue]     = useState('')
  const [newPhone,     setNewPhone]     = useState('')
  const [newCategory,  setNewCategory]  = useState('assistance')
  const [saving,       setSaving]       = useState(false)

  // Paramètres app
  const [purchaseEmail,  setPurchaseEmail]  = useState(appSettings['odoo_purchase_email'] ?? '')
  const [savingParams,   setSavingParams]   = useState(false)
  const [paramsSaved,    setParamsSaved]    = useState(false)

  const items = listItems.filter(i => i.list_type === activeTab)

  const addItem = async () => {
    if (!newLabel) return
    setSaving(true)
    try {
      await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type:       'list_item',
          list_type:  activeTab,
          label:      newLabel,
          value:      newValue || newLabel.toLowerCase().replace(/\s+/g, '_'),
          sort_order: items.length + 1
        })
      })
      setNewLabel('')
      setNewValue('')
      setShowAdd(false)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  const addShortcut = async () => {
    if (!newLabel || !newPhone) return
    setSaving(true)
    try {
      await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type:       'call_shortcut',
          label:      newLabel,
          phone:      newPhone,
          category:   newCategory,
          sort_order: callShortcuts.length + 1
        })
      })
      setNewLabel('')
      setNewPhone('')
      setShowAdd(false)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (id: string, table: string, current: boolean) => {
    await fetch('/api/admin/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, table, active: !current })
    })
    router.refresh()
  }

  const deleteItem = async (id: string, table: string) => {
    await fetch('/api/admin/settings', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, table })
    })
    router.refresh()
  }

  const saveParams = async () => {
    setSavingParams(true)
    try {
      await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            odoo_purchase_email: purchaseEmail,
          }
        })
      })
      setParamsSaved(true)
      setTimeout(() => setParamsSaved(false), 2000)
    } finally {
      setSavingParams(false)
    }
  }

  return (
    <div className="px-4 py-5">
      {/* Tabs */}
      <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
        {LIST_TYPES.map(t => (
          <button
            key={t.key}
            onClick={() => { setActiveTab(t.key as any); setShowAdd(false) }}
            className={`px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
              activeTab === t.key ? 'bg-brand text-white' : 'bg-[#1e1e1e] text-zinc-400 border border-[#2a2a2a]'
            }`}
          >
            {t.label}
          </button>
        ))}
        <button
          onClick={() => { setActiveTab('calls' as any); setShowAdd(false) }}
          className={`px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
            activeTab === 'calls' ? 'bg-brand text-white' : 'bg-[#1e1e1e] text-zinc-400 border border-[#2a2a2a]'
          }`}
        >
          Raccourcis appel
        </button>
        <button
          onClick={() => { setActiveTab('params'); setShowAdd(false) }}
          className={`px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
            activeTab === 'params' ? 'bg-brand text-white' : 'bg-[#1e1e1e] text-zinc-400 border border-[#2a2a2a]'
          }`}
        >
          ⚙️ Paramètres
        </button>
      </div>

      {/* ── Onglet Paramètres ── */}
      {activeTab === 'params' && (
        <div className="flex flex-col gap-4">
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4">
            <p className="text-zinc-400 text-xs font-semibold uppercase tracking-widest mb-3">
              Odoo — Avance de fonds
            </p>
            <label className="block text-sm text-zinc-300 mb-1.5">
              Email boîte achat
            </label>
            <input
              type="email"
              placeholder="achats@verviersdepannage.be"
              value={purchaseEmail}
              onChange={e => setPurchaseEmail(e.target.value)}
              className="w-full bg-[#222] border border-[#333] rounded-xl px-4 py-2.5
                         text-white text-sm outline-none focus:border-brand"
            />
            <p className="text-zinc-600 text-xs mt-1.5">
              Les factures fournisseurs (avances de fonds) seront envoyées à cette adresse pour traitement OCR Odoo.
            </p>
          </div>

          <button
            onClick={saveParams}
            disabled={savingParams}
            className="w-full py-3 bg-brand text-white rounded-xl font-bold text-sm
                       disabled:opacity-50 transition-all"
          >
            {paramsSaved ? '✅ Enregistré' : savingParams ? 'Enregistrement...' : 'Enregistrer les paramètres'}
          </button>

          {/* Vider le cache session */}
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4 mt-2">
            <p className="text-zinc-400 text-xs font-semibold uppercase tracking-widest mb-2">
              Cache session
            </p>
            <p className="text-zinc-600 text-xs mb-3">
              Si les rôles ou modules d'un utilisateur ne se reflètent pas après modification,
              utilisez ce bouton pour forcer le renouvellement du token de session.
            </p>
            <button
              onClick={async () => {
                await signOut({ redirect: false })
                await signIn(undefined, { callbackUrl: '/admin/settings' })
              }}
              className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl
                         font-medium text-sm transition-all border border-zinc-700">
              🔄 Vider le cache et reconnecter
            </button>
          </div>
        </div>
      )}

      {/* ── Onglets listes / raccourcis ── */}
      {activeTab !== 'params' && (
        <>
          {/* Bouton ajouter */}
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="w-full bg-[#1e1e1e] border border-dashed border-[#333] text-zinc-400 rounded-xl py-3 text-sm mb-4 hover:border-brand hover:text-brand transition-colors"
          >
            + Ajouter un élément
          </button>

          {/* Formulaire ajout */}
          {showAdd && (
            <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4 mb-4">
              <input
                placeholder="Libellé *"
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                className="w-full bg-[#222] border border-[#333] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-brand mb-2"
              />
              {activeTab !== 'calls' && (
                <input
                  placeholder="Valeur technique (optionnel)"
                  value={newValue}
                  onChange={e => setNewValue(e.target.value)}
                  className="w-full bg-[#222] border border-[#333] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-brand mb-2"
                />
              )}
              {activeTab === 'calls' && (
                <>
                  <input
                    placeholder="Numéro de téléphone *"
                    value={newPhone}
                    onChange={e => setNewPhone(e.target.value)}
                    className="w-full bg-[#222] border border-[#333] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-brand mb-2"
                  />
                  <select
                    value={newCategory}
                    onChange={e => setNewCategory(e.target.value)}
                    className="w-full bg-[#222] border border-[#333] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-brand mb-2"
                  >
                    <option value="assistance">Assistance</option>
                    <option value="police">Police</option>
                    <option value="prive">Privé</option>
                    <option value="autre">Autre</option>
                  </select>
                </>
              )}
              <div className="flex gap-2">
                <button onClick={() => setShowAdd(false)} className="flex-1 bg-[#222] border border-[#333] text-zinc-400 rounded-xl py-2.5 text-sm">
                  Annuler
                </button>
                <button
                  onClick={activeTab === 'calls' ? addShortcut : addItem}
                  disabled={saving || !newLabel}
                  className="flex-1 bg-brand text-white rounded-xl py-2.5 text-sm font-bold disabled:opacity-50"
                >
                  {saving ? 'Ajout...' : 'Ajouter'}
                </button>
              </div>
            </div>
          )}

          {/* Liste */}
          <div className="flex flex-col gap-2">
            {(activeTab === 'calls' ? callShortcuts : items).map((item: any) => (
              <div
                key={item.id}
                className={`bg-[#1A1A1A] border rounded-xl p-3.5 flex items-center gap-3 ${item.active ? 'border-[#2a2a2a]' : 'border-[#1e1e1e] opacity-50'}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium">{item.label}</p>
                  <p className="text-zinc-600 text-xs mt-0.5">
                    {activeTab === 'calls' ? item.phone : item.value}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleActive(item.id, activeTab === 'calls' ? 'call_shortcuts' : 'list_items', item.active)}
                    className={`w-9 h-5 rounded-full transition-colors relative ${item.active ? 'bg-green-600' : 'bg-zinc-700'}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${item.active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                  <button
                    onClick={() => deleteItem(item.id, activeTab === 'calls' ? 'call_shortcuts' : 'list_items')}
                    className="text-zinc-600 hover:text-red-400 text-lg transition-colors"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}

            {(activeTab === 'calls' ? callShortcuts : items).length === 0 && (
              <div className="text-center py-8 text-zinc-600 text-sm">
                Aucun élément — clique sur + pour ajouter
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
